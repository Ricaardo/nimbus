#!/usr/bin/env bash
# nimbus-daemon-weixin.sh — tmux idempotent supervisor for the WeChat/DeepSeek
# nimbus instance (PROVIDER=deepseek).  Runs ALONGSIDE Cici's nimbus-daemon.sh.
#
# Why a separate script (Cici's nimbus-daemon.sh is deliberately left untouched):
#   • Cici's script `unset ANTHROPIC_API_KEY` — but this instance AUTHENTICATES
#     with that var (set to the DeepSeek key), so it must survive.
#   • Cici's script forces Cici's owner IDs; this instance must not.  All config
#     comes from the launchd plist EnvironmentVariables instead.
#   • Distinct tmux session name so the two supervisors never collide.
#
# Behaviour mirrors nimbus-daemon.sh:
#   • If the tmux session 'nimbus-weixin' exists → supervise only (wait loop).
#   • Else → create it and start 'bun run src/main.ts' with the plist env.
#   • Outer while-loop lets launchd restart after the session is killed.
#
# Usage: called by launchd (ai.nimbus.weixin-deepseek.plist); do not run two copies.
#
# ⚠️ Single-consumer rule: before loading the plist, stop Hermes
#    (launchctl bootout gui/$(id -u) com.hermes.daemon) — both consume wechat-io.

# NOTE: unlike Cici's daemon we do NOT unset ANTHROPIC_API_KEY — for this
# instance it holds the DeepSeek key and the Agent SDK needs it to authenticate
# against ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic.

# Ensure bun + the futu-capable python (miniforge) are on PATH.
export PATH="$HOME/miniforge3/bin:$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

NIMBUS_DIR="$HOME/nimbus-os/nimbus"
LOG_DIR="$NIMBUS_DIR/logs"
SESSION="nimbus-weixin"

mkdir -p "$LOG_DIR"

# Restart backoff state (5 → 30 → 120, cap 300 s); a long-lived run resets it.
FAST_FAIL_SECS=30
backoff=5
fail_count=0

while true; do
  if tmux has-session -t "$SESSION" 2>/dev/null; then
    start_ts=$(date +%s)
    while tmux has-session -t "$SESSION" 2>/dev/null; do
      sleep 5
    done
    end_ts=$(date +%s)
    lived=$(( end_ts - start_ts ))
    echo "$(date -u +%FT%TZ) nimbus-weixin: tmux session ended after ${lived}s, will restart" >> "$LOG_DIR/weixin-deepseek.daemon.log"

    if [ "$lived" -lt "$FAST_FAIL_SECS" ]; then
      fail_count=$(( fail_count + 1 ))
      case $fail_count in
        1) backoff=5  ;;
        2) backoff=30 ;;
        3) backoff=120;;
        *) backoff=300;;
      esac
      echo "$(date -u +%FT%TZ) nimbus-weixin: fast-fail #${fail_count}, backing off ${backoff}s" >> "$LOG_DIR/weixin-deepseek.daemon.log"
      sleep "$backoff"
    else
      fail_count=0
      backoff=5
      sleep 10
    fi
  else
    echo "$(date -u +%FT%TZ) nimbus-weixin: starting tmux session '$SESSION'" >> "$LOG_DIR/weixin-deepseek.daemon.log"
    # Forward the DeepSeek/微信 env explicitly so it survives any stale tmux
    # server environment.  Values originate from the launchd plist.
    tmux new-session -d -s "$SESSION" -c "$NIMBUS_DIR" \
      "exec env \
PROVIDER='${PROVIDER:-deepseek}' \
ANTHROPIC_BASE_URL='$ANTHROPIC_BASE_URL' \
ANTHROPIC_API_KEY='$ANTHROPIC_API_KEY' \
NIMBUS_DISCORD_ENABLED='${NIMBUS_DISCORD_ENABLED:-0}' \
NIMBUS_API_ENABLED='${NIMBUS_API_ENABLED:-0}' \
WEIXIN_INBOUND='${WEIXIN_INBOUND:-1}' \
WEIXIN_INBOUND_PORT='${WEIXIN_INBOUND_PORT:-8770}' \
WEIXIN_INBOUND_TOKEN='$WEIXIN_INBOUND_TOKEN' \
NIMBUS_DB_PATH='$NIMBUS_DB_PATH' \
NIMBUS_OUTBOX_DIR='$NIMBUS_OUTBOX_DIR' \
NIMBUS_OWNER_IDS='$NIMBUS_OWNER_IDS' \
bun run src/main.ts >> '$LOG_DIR/weixin-deepseek.stdout.log' 2>> '$LOG_DIR/weixin-deepseek.stderr.log'"
    sleep 2
  fi
done
