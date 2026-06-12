#!/usr/bin/env python3
"""
add_draft.py — Claude→队列桥（替代已删的 run_codex_cycle.sh）

把 Claude Code 生成的内容包 JSON 校验(风控/合规)并写入广场队列。
Claude 现在是"聪明内容大脑"——用 research/market-pulse/news + writing-styles 写草稿，
经此脚本进 bot 队列；bot 的风控/调度/发布(经官方 binance-square skill)不变。

用法：
  python3 scripts/add_draft.py path/to/draft.json
  cat draft.json | python3 scripts/add_draft.py -

草稿 JSON 必需字段见 SKILL.md / botlib.validate_draft。只读校验+入队，不发布。
"""
import argparse
import json
import sys
from pathlib import Path

import botlib


def main() -> int:
    ap = argparse.ArgumentParser(description="把 Claude 生成的草稿写入广场队列(校验风控/合规)")
    ap.add_argument("draft_json", help="内容包 JSON 路径；'-' 读 stdin")
    ap.add_argument("--prefix", default="claude", help="队列文件名前缀(默认 claude)")
    args = ap.parse_args()

    config = botlib.load_config()
    raw = sys.stdin.read() if args.draft_json == "-" else \
        Path(args.draft_json).read_text(encoding="utf-8")
    try:
        draft = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"❌ JSON 解析失败: {e}", file=sys.stderr)
        return 2

    # 自动补运营字段：Claude 只管写内容，状态/时间由桥填
    draft.setdefault("status", "needs_review")   # 新草稿默认需人工审；合规通过后可改 approved
    draft.setdefault("media_paths", [])
    draft.setdefault("image_prompt", "")
    if not draft.get("slot_time") and draft.get("slot"):
        draft["slot_time"] = botlib.next_slot_time(config, draft["slot"])

    path = botlib.write_queue_draft(draft, config, args.prefix)
    res = botlib.validate_draft(path, config)
    botlib.init_db(config)
    botlib.sync_queue_to_db(config)

    print(f"已入队: {path}")
    print(f"风控/合规校验: {'✅ 通过' if res.ok else '❌ 不通过'}")
    for err in (res.errors or []):
        print(f"  - {err}")
    print("下一步：dry-run 预览 → bash scripts/run_publish_cycle.sh dry-run；"
          "确认后 publish。AI 不直接发，发布经官方 binance-square skill。")
    return 0 if res.ok else 1


if __name__ == "__main__":
    sys.exit(main())
