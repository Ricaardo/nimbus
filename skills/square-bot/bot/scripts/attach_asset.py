#!/usr/bin/env python3
"""Attach a generated asset path to a queued draft."""

from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path

from botlib import load_config, upsert_queue_file, validate_draft


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--draft", required=True)
    parser.add_argument("--asset", required=True)
    parser.add_argument("--approve", action="store_true", help="Mark draft approved after attaching the asset.")
    args = parser.parse_args()

    draft_path = Path(args.draft)
    asset_path = Path(args.asset)
    if not draft_path.exists():
        print(f"draft not found: {draft_path}")
        return 1
    if not asset_path.exists():
        print(f"asset not found: {asset_path}")
        return 1

    draft = json.loads(draft_path.read_text(encoding="utf-8"))
    media_paths = draft.get("media_paths") or []
    if str(asset_path) not in media_paths:
        media_paths.append(str(asset_path))
    draft["media_paths"] = media_paths
    draft["post_type"] = "image" if draft.get("post_type") == "text" else draft.get("post_type", "image")
    if args.approve:
        draft["status"] = "approved"
        draft["approval"] = {
            "source": "human",
            "approved_by": "cli-user",
            "approved_at": datetime.now().isoformat(timespec="seconds"),
        }
    else:
        draft["status"] = "draft"
    draft_path.write_text(json.dumps(draft, ensure_ascii=False, indent=2), encoding="utf-8")

    config = load_config()
    result = validate_draft(draft_path, config)
    if not result.ok:
        print(f"updated draft is invalid: {draft_path}")
        for err in result.errors:
            print(f"  - {err}")
        return 1
    upsert_queue_file(draft_path, draft, config)
    print(draft_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
