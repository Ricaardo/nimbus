#!/usr/bin/env bash
# masters-study-digest.sh — 每日「大师研习」推送(纯学习,不绑持仓)
#
# 形态:取相关大师的【深度档】(skills/*/references/<master>/dna-and-cases.md,已入 kb-server)
#   + 今日聚合 news(news-feed breaking.jsonl)→ 内联进 prompt → headless `claude -p` 合成
#   一条中文学习短文 → 推个人微信(weixin-hub /send, 8787)+ 追加 news-feed(给 Cici)。
#
# 三槽(launchd 传 MODE,或按当前小时推断):
#   ah     (~08:00) A股/港股 → 段永平 视角
#   us     (~21:30) 美股      → Buffett + Howard Marks 视角
#   review (~22:30) 跨市场复盘 → 按星期轮换一位大师 + 思想沉淀
#
# 用法:   ~/nimbus-os/nimbus/scripts/masters-study-digest.sh ah
# 只看不推: DRY_RUN=1 ~/nimbus-os/nimbus/scripts/masters-study-digest.sh ah
set -uo pipefail

ROOT="$HOME/nimbus-os"
NIMBUS="$ROOT/nimbus"
REFS="$NIMBUS/skills"
LOG="$NIMBUS/logs/masters-study-digest.log"
FEED="$NIMBUS/workspace/feed/breaking.jsonl"
HUB_URL="http://127.0.0.1:8787"
HUB_TOKEN_FILE="$HOME/.weixin-hub/api_token.txt"
mkdir -p "$(dirname "$LOG")"
log() { echo "$(date -u +%FT%TZ) $*" >> "$LOG"; }

# claude / python 需在 PATH(launchd 给的 PATH 很精简);不携带计费 key,走订阅鉴权
export PATH="$HOME/.local/bin:$HOME/miniforge3/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
unset ANTHROPIC_API_KEY
CLAUDE_BIN="${CLAUDE_BIN:-claude}"

# ── 选槽 ──
MODE="${1:-}"
if [ -z "$MODE" ]; then
  H=$(date +%H)
  if   [ "$H" -ge 6 ] && [ "$H" -lt 12 ]; then MODE="ah"
  elif [ "$H" -ge 20 ] && [ "$H" -lt 22 ]; then MODE="us"
  else MODE="review"; fi
fi

VP="$REFS/value-perspective/references"
MP="$REFS/macro-perspective/references"
case "$MODE" in
  ah)  MASTERS=("$VP/duan-yongping/dna-and-cases.md"); MKT="A股/港股";;
  us)  MASTERS=("$VP/warren-buffett/dna-and-cases.md" "$MP/howard-marks/dna-and-cases.md"); MKT="美股";;
  review)
    ROT=("$VP/charlie-munger/dna-and-cases.md" "$VP/seth-klarman/dna-and-cases.md" \
         "$VP/peter-lynch/dna-and-cases.md" "$MP/ray-dalio/dna-and-cases.md" \
         "$VP/duan-yongping/dna-and-cases.md")
    IDX=$(( $(date +%u) % ${#ROT[@]} )); MASTERS=("${ROT[$IDX]}"); MKT="跨市场";;
  *) log "unknown MODE=$MODE"; exit 1;;
esac

# 大师显示名取各档首行 H1(如 "# Warren Buffett — ..." → "Warren Buffett")
WHO=""; MASTER_TEXT=""
for f in "${MASTERS[@]}"; do
  [ -f "$f" ] || { log "WARN missing $f"; continue; }
  name="$(head -1 "$f" | sed -E 's/^#[[:space:]]*//; s/[[:space:]]*[—-].*$//' | tr -d '\r')"
  WHO="${WHO:+$WHO / }$name"
  MASTER_TEXT+="$(cat "$f")"$'\n\n---\n\n'
  src_dir="$(dirname "$f")/sources"
  if [ -d "$src_dir" ]; then
    while IFS= read -r sf; do
      MASTER_TEXT+="$(cat "$sf")"$'\n\n---\n\n'
    done < <(find "$src_dir" -type f -name '*.md' | sort)
  fi
done
if [ -z "${MASTER_TEXT// }" ]; then log "ERROR no master docs (MODE=$MODE)"; exit 1; fi

# ── 今日 news(news-feed 最近条目,内联)──
NEWS_TEXT=""
if [ -f "$FEED" ]; then
  NEWS_TEXT="$(tail -n 60 "$FEED" 2>/dev/null | python3 -c '
import sys, json
out=[]
for line in sys.stdin:
    line=line.strip()
    if not line: continue
    try: r=json.loads(line)
    except Exception: continue
    source=(r.get("source") or "").strip()
    t=(r.get("title") or r.get("zh") or "").strip().replace("\n"," ")
    if source in {"大师研习", "masters-study"} or t.startswith("大师研习") or t.startswith("📚 大师研习"):
        continue
    if t: out.append("· "+t[:90])
print("\n".join(out[-28:]))' 2>/dev/null)"
fi
[ -z "${NEWS_TEXT// }" ] && NEWS_TEXT="(今日暂无聚合新闻 — 可基于大师框架做纯思想研习)"

DATE_CN="$(date +%Y-%m-%d)"
PROMPT="你是我的私人投资导师。每天给我一条【纯学习】短文,目的是让我学到东西、内化大师的思维 —— 不要点评我的持仓,不要给买卖建议。

今日聚焦市场:${MKT}。今天的学习对象:${WHO}。

下面是该大师的深度档(表达DNA / 核心框架 / 案例 / 常见误用),请吃透它再写:
<大师深度档>
${MASTER_TEXT}
</大师深度档>

这是今日聚合的市场/宏观/新闻(供你结合当下,含噪音,自行挑相关的):
<今日新闻>
${NEWS_TEXT}
</今日新闻>

只输出一段中文 markdown(不要任何过程说明、不要代码块包裹、不要免责声明),结构:
第一行:📚 大师研习 · ${WHO} · ${DATE_CN}
1) **一个核心思想**:提炼该大师今天最值得学的 1 个理念,引用其一句原话/短句锚点(用「」括起；只有资料明确可追溯时才称"原话")
2) **结合当下**:从今日新闻里挑一个标的或主题,用该大师的视角完整拆解一遍(看生意/护城河/周期/价格/能力圈 —— 视该大师而定),讲清楚\"他会怎么想、为什么\"
3) **今日一问**:留一个我能自己思考练习的问题
全文 800-1500 字,口吻像一位犀利但耐心的导师,讲人话、少堆术语、可落地。"

log "start MODE=$MODE WHO=$WHO masters=${#MASTERS[@]} news=$([ -n "${NEWS_TEXT// }" ] && echo y || echo n)"
CLAUDE_STATUS=0
if command -v timeout >/dev/null 2>&1; then
  DIGEST=$(cd "$NIMBUS" && timeout 240 "$CLAUDE_BIN" -p "$PROMPT" < /dev/null 2>>"$LOG") || CLAUDE_STATUS=$?
elif command -v gtimeout >/dev/null 2>&1; then
  DIGEST=$(cd "$NIMBUS" && gtimeout 240 "$CLAUDE_BIN" -p "$PROMPT" < /dev/null 2>>"$LOG") || CLAUDE_STATUS=$?
else
  log "WARN timeout command missing; running claude without hard timeout"
  DIGEST=$(cd "$NIMBUS" && "$CLAUDE_BIN" -p "$PROMPT" < /dev/null 2>>"$LOG") || CLAUDE_STATUS=$?
fi
if [ "$CLAUDE_STATUS" -ne 0 ]; then
  log "ERROR claude failed status=$CLAUDE_STATUS"
  exit 1
fi
if [ -z "${DIGEST// }" ]; then log "ERROR empty digest, abort"; exit 1; fi
case "$DIGEST" in
  *"Not logged in"*|*"Please run /login"*|*"Authentication"*|*"API key"*)
    log "ERROR claude auth/error output, abort"
    exit 1
    ;;
esac
FIRST_LINE="$(printf '%s\n' "$DIGEST" | awk 'NF {print; exit}')"
case "$FIRST_LINE" in
  "📚 大师研习 · "*) ;;
  *) log "ERROR unexpected digest first line: $FIRST_LINE"; exit 1;;
esac
DIGEST="$(printf '%s' "$DIGEST" | cut -c1-1900)"   # 微信分块上游会再处理;此处保险截断

if [ "${DRY_RUN:-0}" = "1" ]; then
  printf '%s\n' "$DIGEST"; log "DRY_RUN ok (not pushed)"; exit 0
fi

# ── 推 weixin-hub (/send, 8787) ──
TOKEN="$(tr -d '[:space:]' < "$HUB_TOKEN_FILE" 2>/dev/null || true)"
PAYLOAD="$(python3 -c 'import json,sys; print(json.dumps({"text": sys.stdin.read(), "priority":"now", "title":"大师研习", "source":"masters-study"}))' <<<"$DIGEST")"
CURL_ARGS=(-s -o /dev/null -w '%{http_code}' --max-time 20 -X POST "$HUB_URL/send" -H "Content-Type: application/json" -d "$PAYLOAD")
[ -n "$TOKEN" ] && CURL_ARGS+=(-H "Authorization: Bearer $TOKEN")
HTTP=$(curl "${CURL_ARGS[@]}" || echo "000")
log "weixin-hub /send http=$HTTP"
case "$HTTP" in
  2*) ;;
  *) log "ERROR weixin-hub failed http=$HTTP"; exit 1;;
esac

# ── 追加 news-feed(给 nimbus / Cici 当资料)──
if [ -d "$(dirname "$FEED")" ]; then
  printf '%s' "$DIGEST" | "$NIMBUS/scripts/news-feed-write.py" \
    --feed "$FEED" \
    --v2-feed "$NIMBUS/workspace/feed/breaking.v2.jsonl" \
    --source "大师研习" \
  && log "appended news-feed" || log "WARN news-feed append failed"
fi

# ── 入知识库(弱依赖;失败不影响推送)──
if printf '%s' "$DIGEST" | bun run "$NIMBUS/scripts/kb-ingest.ts" \
    --kind framework \
    --title "$FIRST_LINE" \
    --tags "masters-study,${MODE}" \
    --source-id "masters-study:${MODE}:${DATE_CN}" \
    --source-path "masters-study:${MODE}:${DATE_CN}" >/dev/null 2>>"$LOG"; then
  log "kb-ingest ok source=masters-study:${MODE}:${DATE_CN}"
else
  log "WARN kb-ingest failed source=masters-study:${MODE}:${DATE_CN}"
fi
log "done MODE=$MODE http=$HTTP"
