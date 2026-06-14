#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON="${PYTHON:-python3}"
SLOT="${1:-all}"

cd "$ROOT"
"$PYTHON" scripts/init_db.py
"$PYTHON" scripts/collect_market_context.py
"$PYTHON" scripts/generate_daily_posts.py --slot "$SLOT" --refresh-autodrafts
"$PYTHON" scripts/prepare_image_tasks.py
"$PYTHON" scripts/square_bot.py validate
