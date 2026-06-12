#!/usr/bin/env python3
"""Mark a draft as human-approved for publishing."""

from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path

from botlib import load_config, upsert_queue_file, validate_draft


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("draft")
    parser.add_argument("--approved-by", default="cli-user")
    args = parser.parse_args()

    draft_path = Path(args.draft)
    if not draft_path.exists():
        print(f"draft not found: {draft_path}")
        return 1

    draft = json.loads(draft_path.read_text(encoding="utf-8"))
    draft["status"] = "approved"
    draft["approval"] = {
        "source": "human",
        "approved_by": args.approved_by,
        "approved_at": datetime.now().isoformat(timespec="seconds"),
    }
    draft_path.write_text(json.dumps(draft, ensure_ascii=False, indent=2), encoding="utf-8")

    config = load_config()
    result = validate_draft(draft_path, config)
    if not result.ok:
        print(f"approved draft is invalid: {draft_path}")
        for err in result.errors:
            print(f"  - {err}")
        return 1
    upsert_queue_file(draft_path, draft, config)
    print(draft_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
