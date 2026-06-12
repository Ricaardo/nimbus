#!/usr/bin/env python3
"""Show live operations status for the Binance Square bot."""

from __future__ import annotations

import argparse
import json
import os
import re
# Status only calls the fixed launchctl binary.
import subprocess  # nosec B404
from datetime import datetime
from pathlib import Path
from typing import Any

from botlib import load_config, queue_files, slot_allows_autopublish, validate_draft
from publish_due_posts import is_context_stale, is_due, is_stale


LABELS = [
    "com.local.binance-square-bot.generate",
    "com.local.binance-square-bot.publish-live",
    "com.local.binance-square-bot.publish-dryrun",
]


def launchd_status(label: str) -> dict[str, Any]:
    domain_label = f"gui/{os.getuid()}/{label}"
    completed = subprocess.run(
        ["/bin/launchctl", "print", domain_label],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )  # nosec B603
    if completed.returncode != 0:
        return {"label": label, "loaded": False, "note": completed.stdout.strip()}

    output = completed.stdout
    state = re.search(r"state = ([^\n]+)", output)
    runs = re.search(r"runs = ([^\n]+)", output)
    last_exit = re.search(r"last exit code = ([^\n]+)", output)
    return {
        "label": label,
        "loaded": True,
        "state": state.group(1).strip() if state else "unknown",
        "runs": runs.group(1).strip() if runs else "unknown",
        "last_exit_code": last_exit.group(1).strip() if last_exit else "unknown",
    }


def draft_publish_state(draft: dict[str, Any], ok: bool, errors: list[str], config: dict[str, Any]) -> str:
    if not ok:
        return "invalid"
    status = draft.get("status")
    if status in {"skip", "needs_asset", "needs_review", "published"}:
        return str(status)
    if status not in {"draft", "approved"}:
        return f"blocked:{status}"
    if not slot_allows_autopublish(draft, config) and status != "approved":
        return "not-autopublishable"
    if not is_due(draft):
        return "scheduled"
    if is_context_stale(draft, config):
        return "stale-context"
    if is_stale(draft, config):
        return "stale"
    return "publishable-now"


def queue_status(config: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for path in queue_files(config):
        result = validate_draft(path, config)
        draft = result.draft
        slot_time = draft.get("slot_time")
        due = False
        if result.ok:
            due = is_due(draft)
        rows.append(
            {
                "file": path.name,
                "slot": draft.get("slot"),
                "slot_time": slot_time,
                "status": draft.get("status"),
                "risk_level": draft.get("risk_level"),
                "due": due,
                "state": draft_publish_state(draft, result.ok, result.errors, config),
                "errors": result.errors,
            }
        )
    return rows


def print_text(report: dict[str, Any]) -> None:
    print(f"now: {report['now']}")
    print("\nlaunchd:")
    for item in report["launchd"]:
        if item["loaded"]:
            print(f"- {item['label']}: loaded, state={item['state']}, runs={item['runs']}, last_exit={item['last_exit_code']}")
        else:
            print(f"- {item['label']}: not loaded")

    print("\nqueue:")
    if not report["queue"]:
        print("- empty")
        return
    for item in report["queue"]:
        line = (
            f"- {item['file']}: slot={item['slot']} slot_time={item['slot_time']} "
            f"status={item['status']} risk={item['risk_level']} state={item['state']}"
        )
        print(line)
        for error in item["errors"]:
            print(f"  error: {error}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true", help="Print machine-readable status.")
    args = parser.parse_args()

    config = load_config()
    report = {
        "now": datetime.now().isoformat(timespec="seconds"),
        "root": str(Path(__file__).resolve().parents[1]),
        "launchd": [launchd_status(label) for label in LABELS],
        "queue": queue_status(config),
    }

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print_text(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
