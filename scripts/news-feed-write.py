#!/usr/bin/env python3
"""Append legacy v1 and optional NewsEvent v2 records to the news feed."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path


def clean_title(text: str) -> str:
    first = next((line.strip() for line in text.splitlines() if line.strip()), "")
    title = first or "news-feed"
    for token in ("**", "📊", "📚"):
        title = title.replace(token, "")
    return title.strip()[:120] or "news-feed"


def split_tickers(raw: str) -> list[str]:
    return [item.strip() for item in raw.split(",") if item.strip()]


def canonicalize_symbol(symbol: str) -> str:
    symbol = symbol.strip().upper()
    if not symbol:
        return ""
    if ":" in symbol:
        return symbol
    if symbol.endswith(".HK"):
        return f"HK:{symbol[:-3].zfill(5)}"
    if symbol.endswith(".US"):
        return f"US:{symbol[:-3]}"
    if symbol.isdigit() and len(symbol) == 5:
        return f"HK:{symbol}"
    if symbol.isdigit() and len(symbol) == 6:
        return f"CN:{symbol}"
    return f"US:{symbol}"


def event_id(source: str, source_id: str, title: str, ts: str) -> str:
    key = "|".join([source, source_id, title, ts])
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]
    source_part = "".join(
        ch if ch.isascii() and ch.isalnum() else "-" for ch in source.lower()
    ).strip("-") or "source"
    return f"news:{source_part}:{digest}"


def append_jsonl(path: str, record: dict) -> None:
    expanded = Path(os.path.expanduser(path))
    expanded.parent.mkdir(parents=True, exist_ok=True)
    with expanded.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Append a digest to Nimbus news feed JSONL.")
    parser.add_argument("--feed", required=True, help="legacy v1 JSONL path")
    parser.add_argument("--v2-feed", default="", help="optional NewsEvent v2 JSONL shadow path")
    parser.add_argument("--source", required=True)
    parser.add_argument("--title", default="")
    parser.add_argument("--tickers", default="", help="comma-separated tickers")
    parser.add_argument("--impact", default="")
    parser.add_argument("--link", default="")
    parser.add_argument("--source-id", default="")
    args = parser.parse_args(argv)

    body = sys.stdin.read().strip()
    if not body:
        print("news-feed-write: empty stdin", file=sys.stderr)
        return 1

    now = datetime.now(timezone.utc)
    ts = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    epoch = int(time.time())
    title = (args.title.strip() or clean_title(body))[:120]
    tickers = split_tickers(args.tickers)

    legacy = {
        "ts": ts,
        "epoch": epoch,
        "source": args.source,
        "title": title[:80],
        "zh": body,
        "tickers": tickers,
    }
    if args.impact:
        legacy["impact"] = args.impact
    if args.link:
        legacy["link"] = args.link
    append_jsonl(args.feed, legacy)

    if args.v2_feed:
        source_id = args.source_id or args.link or f"digest:{hashlib.sha256(body.encode('utf-8')).hexdigest()[:16]}"
        v2 = {
            "version": 2,
            "event_id": event_id(args.source, source_id, title, ts),
            "ts": ts,
            "epoch": epoch,
            "source": args.source,
            "source_id": source_id,
            "title": title,
            "summary_zh": body,
            "symbols": [s for s in (canonicalize_symbol(t) for t in tickers) if s],
            "impact": args.impact,
            "link": args.link,
            "provenance": {
                "retrieved_at": ts,
            },
            "metadata": {
                "writer": "nimbus/scripts/news-feed-write.py",
            },
        }
        append_jsonl(args.v2_feed, v2)

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
