#!/usr/bin/env python3
"""Publish queue drafts whose slot_time is due."""

from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path

from botlib import init_db, load_config, queue_files, slot_allows_autopublish, slot_for, upsert_queue_file, validate_draft
from square_bot import publish_draft


def is_due(draft: dict) -> bool:
    slot_time = draft.get("slot_time")
    if not slot_time:
        return True
    try:
        return datetime.fromisoformat(slot_time) <= datetime.now()
    except ValueError:
        return False


def is_stale(draft: dict, config: dict) -> bool:
    slot_time = draft.get("slot_time")
    if not slot_time:
        return False
    try:
        due_at = datetime.fromisoformat(slot_time)
    except ValueError:
        return False
    slot = slot_for(config, draft.get("slot", ""))
    max_delay = int((slot or {}).get("max_publish_delay_minutes", 60))
    return (datetime.now() - due_at).total_seconds() > max_delay * 60


def mark_stale_skip(path: Path, draft: dict, config: dict, reason: str = "stale_publish_window") -> None:
    draft["status"] = "skip"
    draft["skip_reason"] = reason
    draft["skipped_at"] = datetime.now().isoformat(timespec="seconds")
    path.write_text(json.dumps(draft, ensure_ascii=False, indent=2), encoding="utf-8")
    upsert_queue_file(path, draft, config)


def can_mark_stale_skip(draft: dict, config: dict) -> bool:
    status = draft.get("status")
    if status == "approved":
        return True
    return status == "draft" and slot_allows_autopublish(draft, config)


def is_context_stale(draft: dict, config: dict) -> bool:
    generated_at = draft.get("generated_at")
    if not generated_at:
        return True
    try:
        generated = datetime.fromisoformat(generated_at)
    except ValueError:
        return True
    slot = slot_for(config, draft.get("slot", ""))
    max_age = int((slot or {}).get("max_context_age_minutes", 60))
    return (datetime.now() - generated).total_seconds() > max_age * 60


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--publish", action="store_true", help="Actually publish due eligible drafts.")
    parser.add_argument("--all", action="store_true", help="Ignore slot_time and process all eligible drafts.")
    args = parser.parse_args()

    config = load_config()
    init_db(config)
    exit_code = 0
    for path in queue_files(config):
        result = validate_draft(Path(path), config)
        if result.ok:
            upsert_queue_file(path, result.draft, config)
        if result.ok and not args.all and not is_due(result.draft):
            print(f"SKIP {path.name}: not due until {result.draft.get('slot_time')}")
            continue
        can_auto_skip = result.ok and not args.all and can_mark_stale_skip(result.draft, config)
        if can_auto_skip and is_context_stale(result.draft, config):
            mark_stale_skip(path, result.draft, config, reason="stale_market_context")
            print(f"SKIP {path.name}: stale market context")
            continue
        if can_auto_skip and is_stale(result.draft, config):
            mark_stale_skip(path, result.draft, config)
            print(f"SKIP {path.name}: stale publish window")
            continue
        rc = publish_draft(result, config, do_publish=args.publish)
        if rc != 0:
            exit_code = rc
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
