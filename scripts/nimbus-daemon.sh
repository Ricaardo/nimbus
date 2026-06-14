#!/usr/bin/env bash
# nimbus-daemon.sh — tmux idempotent supervisor for Nimbus bot.
#
# Behaviour:
#   • If the tmux session 'nimbus' already exists → supervise only (wait loop).
#   • If the session does not exist → create it and start 'bun run src/main.ts'.
#   • Outer while-loop ensures launchd can restart after 'tmux kill-session -t nimbus'.
#
# Usage: called by launchd (com.nimbus.daemon.plist); do not run two copies.
#
# ⚠️ Single-consumer rule: before loading the plist, confirm:
#   1. No 'claude --channels' daemon is running.
#   2. The interactive Claude session has plugin:discord:discord inactive.

# Safety: never carry a billed API key into the bot process.
unset ANTHROPIC_API_KEY

# Ensure bun + the futu-capable python (miniforge) are on PATH.
# miniforge first so `python3` in agent Bash calls resolves to the interpreter
# that has the `futu` package (homebrew python3 lacks it → quote scripts fail).
export PATH="$HOME/miniforge3/bin:$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

NIMBUS_DIR="$HOME/nimbus-stack/nimbus"
LOG_DIR="$NIMBUS_DIR/logs"
SESSION="nimbus"

mkdir -p "$LOG_DIR"

# Restart backoff state.
# If the process lives < FAST_FAIL_SECS seconds it is a fast-fail;
# we back off exponentially (5 → 30 → 120, cap 300 s).
# A long-lived run resets the counter.
FAST_FAIL_SECS=30
backoff=5
fail_count=0

while true; do
  if tmux has-session -t "$SESSION" 2>/dev/null; then
    # Session already running — record start time and wait for it to exit.
    start_ts=$(date +%s)
    while tmux has-session -t "$SESSION" 2>/dev/null; do
      sleep 5
    done
    end_ts=$(date +%s)
    lived=$(( end_ts - start_ts ))
    echo "$(date -u +%FT%TZ) nimbus: tmux session ended after ${lived}s, will restart" >> "$LOG_DIR/daemon.out.log"

    if [ "$lived" -lt "$FAST_FAIL_SECS" ]; then
      fail_count=$(( fail_count + 1 ))
      # Exponential backoff: 5 → 30 → 120, capped at 300 s.
      case $fail_count in
        1) backoff=5  ;;
        2) backoff=30 ;;
        3) backoff=120;;
        *) backoff=300;;
      esac
      echo "$(date -u +%FT%TZ) nimbus: fast-fail #${fail_count}, backing off ${backoff}s" >> "$LOG_DIR/daemon.out.log"
      sleep "$backoff"
    else
      # Long-lived run — reset backoff.
      fail_count=0
      backoff=5
      # Brief pause before restart even on clean exits.
      sleep 10
    fi
  else
    echo "$(date -u +%FT%TZ) nimbus: starting tmux session '$SESSION'" >> "$LOG_DIR/daemon.out.log"
    tmux new-session -d -s "$SESSION" -c "$NIMBUS_DIR" \
      "exec bun run src/main.ts >> '$LOG_DIR/nimbus.stdout.log' 2>> '$LOG_DIR/nimbus.stderr.log'"
    # Wait for the session to come up.
    sleep 2
  fi
done
