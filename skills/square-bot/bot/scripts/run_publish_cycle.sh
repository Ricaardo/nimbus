#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON="${PYTHON:-python3}"
MODE="${1:-dry-run}"

cd "$ROOT"
"$PYTHON" scripts/init_db.py
if [[ "$MODE" == "publish" ]]; then
  "$PYTHON" scripts/publish_due_posts.py --publish
else
  "$PYTHON" scripts/publish_due_posts.py
fi
"$PYTHON" scripts/collect_metrics.py report
