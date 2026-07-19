#!/usr/bin/env bash
# nimbus-daemon-cici-deepseek.sh — tmux supervisor for Cici on DeepSeek V4 Pro.
#
# 与 nimbus-daemon.sh (Cici on Claude) 结构一致，差异：
#   • 不 unset ANTHROPIC_API_KEY（DeepSeek 用它认证）
#   • tmux session 名 = nimbus-cici-ds（和 Claude 的 nimbus / 微信的 nimbus-weixin 都不冲突）
#   • 转发 DEEPSEEK_MODEL（强制 pro）和 DeepSeek 认证变量
#   • -u 剥离微信专属环境变量，防止 plist 间交叉污染
#
# Usage: called by launchd (com.nimbus.cici-deepseek.plist).

export PATH="$HOME/miniforge3/bin:$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

NIMBUS_DIR="$HOME/nimbus-os/nimbus"
LOG_DIR="$NIMBUS_DIR/logs"
SESSION="nimbus-cici-ds"

mkdir -p "$LOG_DIR"

FAST_FAIL_SECS=30
backoff=5
fail_count=0

while true; do
  if tmux has-session -t "=$SESSION" 2>/dev/null; then
    start_ts=$(date +%s)
    while tmux has-session -t "=$SESSION" 2>/dev/null; do
      sleep 5
    done
    end_ts=$(date +%s)
    lived=$(( end_ts - start_ts ))
    echo "$(date -u +%FT%TZ) cici-deepseek: session ended after ${lived}s, restarting" >> "$LOG_DIR/cici-deepseek.daemon.log"

    if [ "$lived" -lt "$FAST_FAIL_SECS" ]; then
      fail_count=$(( fail_count + 1 ))
      case $fail_count in
        1) backoff=5  ;;
        2) backoff=30 ;;
        3) backoff=120;;
        *) backoff=300;;
      esac
      echo "$(date -u +%FT%TZ) cici-deepseek: fast-fail #${fail_count}, backing off ${backoff}s" >> "$LOG_DIR/cici-deepseek.daemon.log"
      sleep "$backoff"
    else
      fail_count=0
      backoff=5
      sleep 10
    fi
  else
    echo "$(date -u +%FT%TZ) cici-deepseek: starting tmux session '$SESSION'" >> "$LOG_DIR/cici-deepseek.daemon.log"
    tmux new-session -d -s "$SESSION" -c "$NIMBUS_DIR" \
      "exec env \
PROVIDER='${PROVIDER:-deepseek}' \
ANTHROPIC_BASE_URL='$ANTHROPIC_BASE_URL' \
ANTHROPIC_API_KEY='$ANTHROPIC_API_KEY' \
DEEPSEEK_MODEL='${DEEPSEEK_MODEL:-deepseek-v4-pro}' \
NIMBUS_DISCORD_ENABLED='${NIMBUS_DISCORD_ENABLED:-1}' \
NIMBUS_API_ENABLED='${NIMBUS_API_ENABLED:-1}' \
NIMBUS_DB_PATH='$NIMBUS_DB_PATH' \
NIMBUS_OWNER_IDS='$NIMBUS_OWNER_IDS' \
-u WEIXIN_INBOUND \
-u WEIXIN_INBOUND_PORT \
-u WEIXIN_INBOUND_TOKEN \
-u NIMBUS_OUTBOX_DIR \
bun run src/main.ts >> '$LOG_DIR/cici-deepseek.stdout.log' 2>> '$LOG_DIR/cici-deepseek.stderr.log'"
    sleep 2
  fi
done
