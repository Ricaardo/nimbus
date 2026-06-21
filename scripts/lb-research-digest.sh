#!/usr/bin/env bash
# lb-research-digest.sh — 每日盘前：longbridge MCP 机构评级 / 一致预期摘要 → discord webhook
#
# 背景：longbridge 的 institution_rating / consensus 等研报端点只存在于 longbridge
# MCP（HTTP，https://openapi.longbridge.com/mcp），不在 longport SDK 里，cron 程序
# 无法直接调。这里用 headless `claude -p`（继承全局 MCP 配置）拉数据并生成中文摘要，
# 再 POST 到 discord webhook（复用 news 的普通文本频道 webhook）。
#
# 由 launchd com.local.lb-research-digest 触发（每交易日盘前）。手动测试：
#   ~/nimbus-os/nimbus/scripts/lb-research-digest.sh
# 仅生成不推送（看效果）：DRY_RUN=1 ~/nimbus-os/nimbus/scripts/lb-research-digest.sh
set -uo pipefail

ROOT="$HOME/nimbus-os"
LOG="$ROOT/nimbus/logs/lb-research-digest.log"
mkdir -p "$(dirname "$LOG")"

log() { echo "$(date -u +%FT%TZ) $*" >> "$LOG"; }

# claude / python 需在 PATH 上（launchd 给的 PATH 很精简）
export PATH="$HOME/.local/bin:$HOME/miniforge3/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
# 不携带计费 API key，走订阅鉴权
unset ANTHROPIC_API_KEY

# 盯哪些标的（与 finnhub 个股一致；ETF 无分析师评级故不含）
SYMBOLS="NVDA.US、AAPL.US、MSFT.US"

PROMPT="你是盘前研报助手。用 longbridge MCP 工具，为 ${SYMBOLS} 这几只股票，各调用一次 institution_rating 和一次 consensus。
然后只输出一段简洁中文 markdown（不要任何过程说明，不要用代码块包裹），格式：
第一行：📊 盘前机构观点 + 今天日期
每只股票一小节（含股票名）：
· 共识评级（中文，如 强烈买入/买入/持有）+ 目标价 + 相对现价上行/下行空间%
· 分析师分布：买/持/卖 家数
· 最近一季 EPS：实际 vs 预期（超预期/不及预期）；下一季 EPS 预期
整体控制在 1600 字符以内，专业克制，不要免责声明。"

log "start digest for ${SYMBOLS}"
DIGEST=$(cd "$ROOT/nimbus" && timeout 300 claude -p "$PROMPT" \
  --allowedTools "mcp__longbridge__institution_rating,mcp__longbridge__consensus" 2>>"$LOG")

if [ -z "${DIGEST// }" ]; then
  log "ERROR empty digest, abort"
  exit 1
fi

# discord content 上限 2000 字符，保险截断到 1900
DIGEST="$(printf '%s' "$DIGEST" | cut -c1-1900)"

if [ "${DRY_RUN:-0}" = "1" ]; then
  printf '%s\n' "$DIGEST"
  log "DRY_RUN ok (not posted)"
  exit 0
fi

# ── 也接进 news-feed（news→nimbus 数据桥）──
FEED="$ROOT/nimbus/workspace/feed/breaking.jsonl"
V2_FEED="$ROOT/nimbus/workspace/feed/breaking.v2.jsonl"
if [ -d "$(dirname "$FEED")" ]; then
  if printf '%s' "$DIGEST" | "$ROOT/nimbus/scripts/news-feed-write.py" \
      --feed "$FEED" \
      --v2-feed "$V2_FEED" \
      --source "机构观点" \
      --tickers "NVDA,AAPL,MSFT"; then
    log "appended to news-feed"
  else
    log "WARN news-feed append failed"
  fi
fi

# ── 推 discord（SKIP_DISCORD=1 可跳过，仅写 feed，便于测试）──
if [ "${SKIP_DISCORD:-0}" = "1" ]; then
  log "SKIP_DISCORD ok (feed only)"
  exit 0
fi

# 复用 news 的 discord webhook（普通文本频道）
WEBHOOK="$(grep -E '^DISCORD_WEBHOOK_1=' "$ROOT/news/.env" | cut -d= -f2-)"
if [ -z "$WEBHOOK" ]; then
  log "ERROR no DISCORD_WEBHOOK_1 in news/.env"
  exit 1
fi

PAYLOAD="$(python3 -c 'import json,sys; print(json.dumps({"content": sys.stdin.read()}))' <<<"$DIGEST")"
HTTP=$(curl -s -o /dev/null -w '%{http_code}' -H "Content-Type: application/json" -d "$PAYLOAD" "$WEBHOOK")
log "posted to discord http=$HTTP"
[ "$HTTP" = "204" ] || { log "ERROR discord post failed http=$HTTP"; exit 1; }
log "done"
