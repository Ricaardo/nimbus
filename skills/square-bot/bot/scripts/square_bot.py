#!/usr/bin/env python3
"""Binance Square operations bot.

The bot owns queue validation and publishing orchestration. It does not generate
market facts by itself; AI/Codex writes JSON drafts into queue/.
"""

from __future__ import annotations

import argparse
import json
import shutil
# Publisher runs fixed local skill scripts with argument lists.
import subprocess  # nosec B404
import sys
from datetime import datetime
from pathlib import Path

from botlib import (
    body_hash,
    connect_db,
    init_db,
    load_config,
    now_stamp,
    queue_files,
    slugify,
    slot_allows_autopublish,
    upsert_queue_file,
    validate_draft,
)


ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "config.json"
NODE_CANDIDATES = [
    "/usr/local/bin/node",
    "/opt/homebrew/bin/node",
    "/usr/bin/node",
]


def node_executable(config: dict[str, Any]) -> str | None:
    configured = config.get("node_path")
    candidates = [configured] if configured else []
    which_node = shutil.which("node")
    if which_node:
        candidates.append(which_node)
    candidates.extend(NODE_CANDIDATES)
    for candidate in candidates:
        if candidate and Path(str(candidate)).exists():
            return str(candidate)
    return None


def build_publish_command(draft: dict[str, Any], config: dict[str, Any]) -> list[str]:
    skill_dir = Path(config["square_skill_dir"])
    node = node_executable(config)
    if not node:
        raise FileNotFoundError("node executable not found; set node_path in config.json")
    post_type = draft["post_type"]
    body = draft["body"]
    title = draft.get("title") or ""
    media_paths = [str(Path(p)) for p in draft.get("media_paths", [])]

    if post_type == "text":
        return [node, "scripts/post-text.mjs", "--text", body]

    if post_type == "article":
        if media_paths:
            return [node, "scripts/post-image.mjs", "--text", body, "--title", title, "--cover", media_paths[0]]
        return [node, "scripts/post-text.mjs", "--text", body, "--title", title]

    if post_type == "image":
        return [node, "scripts/post-image.mjs", "--text", body, "--images", ",".join(media_paths[:4])]

    if post_type == "video":
        return [
            node,
            "scripts/post-video.mjs",
            "--video",
            media_paths[0],
            "--duration",
            str(draft["duration_seconds"]),
            "--text",
            body,
        ]

    raise ValueError(f"unsupported post_type: {post_type}")


def publish_draft(result: DraftResult, config: dict[str, Any], do_publish: bool) -> int:
    draft = result.draft
    if not result.ok:
        print(f"SKIP {result.path.name}: invalid draft")
        for err in result.errors:
            print(f"  - {err}")
        return 1

    if draft.get("status") == "skip":
        print(f"SKIP {result.path.name}: status=skip")
        return 0

    if draft.get("status") == "needs_asset":
        print(f"SKIP {result.path.name}: status=needs_asset")
        return 0

    if draft.get("status") not in {"approved", "draft"}:
        print(f"SKIP {result.path.name}: status={draft.get('status')} requires review")
        return 0

    if not slot_allows_autopublish(draft, config) and draft.get("status") != "approved":
        print(f"SKIP {result.path.name}: slot/risk not eligible for autopublish")
        return 0

    command = build_publish_command(draft, config)
    skill_dir = Path(config["square_skill_dir"])
    printable = " ".join(command[:3] + ["..."])

    if not do_publish:
        print(f"DRY-RUN {result.path.name}: {printable}")
        return 0

    completed = subprocess.run(
        command,
        cwd=skill_dir,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )  # nosec B603
    print(completed.stdout)
    if completed.returncode != 0:
        return completed.returncode

    square_id = None
    link = None
    for line in completed.stdout.splitlines():
        if line.startswith("ID: "):
            square_id = line.removeprefix("ID: ").strip()
        if line.startswith("Link: "):
            link = line.removeprefix("Link: ").strip()

    published_dir = Path(config["published_dir"])
    published_dir.mkdir(parents=True, exist_ok=True)
    record = {
        "draft_file": str(result.path),
        "published_at": datetime.now().isoformat(timespec="seconds"),
        "command": command,
        "output": completed.stdout,
        "draft": draft,
    }
    record_name = f"{now_stamp()}-{slugify(result.path.stem)}.json"
    (published_dir / record_name).write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")

    init_db(config)
    conn = connect_db(config)
    try:
        queue_row = conn.execute(
            "SELECT id FROM content_queue WHERE queue_file = ?",
            (str(result.path),),
        ).fetchone()
        queue_id = queue_row["id"] if queue_row else None
        conn.execute(
            """
            INSERT INTO posts
              (queue_id, queue_file, square_id, link, body_hash, published_at, metrics_json, raw_output)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                queue_id,
                str(result.path),
                square_id,
                link,
                body_hash(draft.get("body", "")),
                datetime.now().isoformat(timespec="seconds"),
                "{}",
                completed.stdout,
            ),
        )
        if queue_id:
            conn.execute(
                "UPDATE content_queue SET status = 'published', updated_at = ? WHERE id = ?",
                (datetime.now().isoformat(timespec="seconds"), queue_id),
            )
        conn.commit()
    finally:
        conn.close()

    result.path.unlink()
    return 0


def cmd_doctor(_: argparse.Namespace) -> int:
    config = load_config()
    skill_dir = Path(config["square_skill_dir"])
    checks = {
        "config": CONFIG_PATH.exists(),
        "skill_dir": skill_dir.exists(),
        "post_text": (skill_dir / "scripts/post-text.mjs").exists(),
        "post_image": (skill_dir / "scripts/post-image.mjs").exists(),
        "post_video": (skill_dir / "scripts/post-video.mjs").exists(),
        "node": node_executable(config) is not None,
        "key_file": Path.home().joinpath(".config/binance-square/openapi-key").exists(),
    }
    for name, ok in checks.items():
        print(f"{name}: {'ok' if ok else 'missing'}")
    return 0 if all(checks.values()) else 1


def cmd_sample(args: argparse.Namespace) -> int:
    config = load_config()
    queue_dir = Path(config["queue_dir"])
    queue_dir.mkdir(parents=True, exist_ok=True)
    body = (
        "BTC 早盘观察：$BTC 现在重点不是猜方向，而是看区间是否被有效打破。\n"
        "1. 上方先看昨日日内高点是否能重新站回。\n"
        "2. 下方关注低点附近是否出现放量失守。\n"
        "3. 如果仍在区间内，风险是把震荡误判成趋势。\n"
        "失效条件：价格放量突破并连续站稳关键位。\n"
        "你今天更担心假突破，还是踏空？#BTC #BTCUSDT #BinanceSquare"
    )
    draft = {
        "status": "draft",
        "risk_level": "S1",
        "slot": args.slot,
        "post_type": "text",
        "title": "",
        "body": body,
        "cashtags": ["$BTC"],
        "hashtags": ["#BTC", "#BTCUSDT", "#BinanceSquare"],
        "image_prompt": (
            "16:9 editorial crypto market image, abstract candlestick chart structure, "
            "calm analytical mood, dark neutral background, subtle orange and teal accents, "
            "no exchange logo, no price prediction text"
        ),
        "media_paths": [],
        "source_notes": ["Sample draft generated locally; refresh market data before public use."],
        "publish_reason": "Daily morning map format test.",
        "invalidation": "价格放量突破并连续站稳关键位。",
        "compliance_notes": ["No trade instruction.", "Uses observation and risk framing."],
    }
    path = queue_dir / f"{now_stamp()}-{args.slot}.json"
    path.write_text(json.dumps(draft, ensure_ascii=False, indent=2), encoding="utf-8")
    print(path)
    return 0


def cmd_validate(_: argparse.Namespace) -> int:
    config = load_config()
    init_db(config)
    exit_code = 0
    for path in queue_files(config):
        result = validate_draft(path, config)
        print(f"{path.name}: {'ok' if result.ok else 'invalid'}")
        for err in result.errors:
            print(f"  - {err}")
        if not result.ok:
            exit_code = 1
        else:
            upsert_queue_file(path, result.draft, config)
    return exit_code


def cmd_publish(args: argparse.Namespace) -> int:
    config = load_config()
    init_db(config)
    exit_code = 0
    for path in queue_files(config):
        result = validate_draft(path, config)
        if result.ok:
            upsert_queue_file(path, result.draft, config)
        rc = publish_draft(result, config, do_publish=args.publish)
        if rc != 0:
            exit_code = rc
    return exit_code


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Binance Square operations bot")
    subparsers = parser.add_subparsers(required=True)

    doctor = subparsers.add_parser("doctor")
    doctor.set_defaults(func=cmd_doctor)

    sample = subparsers.add_parser("sample")
    sample.add_argument("--slot", default="morning_map")
    sample.set_defaults(func=cmd_sample)

    validate = subparsers.add_parser("validate")
    validate.set_defaults(func=cmd_validate)

    publish = subparsers.add_parser("publish")
    publish.add_argument("--publish", action="store_true", help="Actually publish eligible drafts")
    publish.set_defaults(func=cmd_publish)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
