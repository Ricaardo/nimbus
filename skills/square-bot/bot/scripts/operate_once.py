#!/usr/bin/env python3
"""Run one full bot maintenance cycle."""

from __future__ import annotations

import argparse
# Commands are fixed local bot steps.
import subprocess  # nosec B404
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def run_step(command: list[str], keep_going: bool = False) -> int:
    printable = " ".join(command)
    print(f"\n$ {printable}")
    # Command list is built from fixed local steps.
    completed = subprocess.run(command, cwd=ROOT, text=True, check=False)  # nosec B603
    if completed.returncode != 0 and not keep_going:
        return completed.returncode
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--publish", action="store_true", help="Actually publish due eligible drafts.")
    parser.add_argument("--with-image", action="store_true", help="Generate image-ready drafts and image tasks.")
    parser.add_argument("--offline", action="store_true", help="Use offline market context fallback.")
    parser.add_argument(
        "--slot",
        default="all",
        choices=["morning_map", "midday_map", "hot_event", "us_open_map", "deep_recap", "all"],
    )
    args = parser.parse_args()

    python = sys.executable
    steps = [
        [python, "scripts/init_db.py"],
        [python, "scripts/collect_market_context.py"] + (["--offline"] if args.offline else []),
        [python, "scripts/generate_daily_posts.py", "--slot", args.slot] + (["--with-image"] if args.with_image else []),
        [python, "scripts/prepare_image_tasks.py"],
        [python, "scripts/publish_due_posts.py"] + (["--publish"] if args.publish else []),
        [python, "scripts/collect_metrics.py", "report"],
    ]
    for command in steps:
        rc = run_step(command, keep_going=command[-1] == "report")
        if rc != 0:
            return rc
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
