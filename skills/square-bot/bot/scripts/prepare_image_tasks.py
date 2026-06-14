#!/usr/bin/env python3
"""Create Codex image-generation task files for queued drafts."""

from __future__ import annotations

import json
from pathlib import Path

from botlib import load_config, queue_files, validate_draft


def main() -> int:
    config = load_config()
    assets_dir = Path(config["assets_dir"])
    tasks_dir = assets_dir / "tasks"
    tasks_dir.mkdir(parents=True, exist_ok=True)
    count = 0
    for path in queue_files(config):
        result = validate_draft(path, config)
        draft = result.draft
        if draft.get("status") != "needs_asset":
            continue
        prompt = draft.get("image_prompt")
        if not prompt:
            continue
        target = assets_dir / f"{path.stem}.png"
        task_path = tasks_dir / f"{path.stem}.md"
        task_path.write_text(
            "\n".join(
                [
                    "# Codex Image Task",
                    "",
                    f"Draft: `{path}`",
                    f"Target asset path: `{target}`",
                    "",
                    "Generate a single Binance Square-safe image for this prompt:",
                    "",
                    "```text",
                    prompt,
                    "```",
                    "",
                    "After generating, save the image to the target path and run:",
                    "",
                    "```bash",
                    f"python3 {Path(__file__).resolve().parent}/attach_asset.py --draft {path} --asset {target}",
                    "```",
                ]
            ),
            encoding="utf-8",
        )
        print(task_path)
        count += 1
    print(f"image_tasks: {count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
