#!/usr/bin/env python3
"""Record and summarize Binance Square post metrics.

Binance Square OpenAPI publishing does not expose a read/analytics endpoint in
the local official skill, so this script supports manual metric entry and local
reporting from `posts.db`.
"""

from __future__ import annotations

import argparse
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime

from botlib import connect_db, init_db, load_config


METRIC_PATTERNS = {
    "views": [r'"(?:viewCount|views|readCount)"\s*:\s*"?([0-9]+)"?'],
    "likes": [r'"(?:likeCount|likes)"\s*:\s*"?([0-9]+)"?'],
    "comments": [r'"(?:commentCount|comments)"\s*:\s*"?([0-9]+)"?'],
    "shares": [r'"(?:shareCount|shares)"\s*:\s*"?([0-9]+)"?'],
}


def fetch_text(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https":
        raise ValueError(f"unsupported URL scheme: {parsed.scheme}")
    request = urllib.request.Request(url, headers={"User-Agent": "binance-square-bot/1.0"})
    # URL scheme is restricted to https above.
    with urllib.request.urlopen(request, timeout=15) as response:  # nosec B310
        return response.read().decode("utf-8", errors="replace")


def parse_public_metrics(html: str) -> dict[str, int]:
    result = {"views": 0, "likes": 0, "comments": 0, "shares": 0, "followers_delta": 0}
    for key, patterns in METRIC_PATTERNS.items():
        for pattern in patterns:
            match = re.search(pattern, html)
            if match:
                result[key] = int(match.group(1))
                break
    return result


def insert_metrics(conn, post_id: int, metrics: dict[str, int]) -> None:
    conn.execute(
        """
        INSERT INTO post_metrics
          (post_id, collected_at, views, likes, comments, shares, followers_delta, raw_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            post_id,
            datetime.now().isoformat(timespec="seconds"),
            metrics.get("views", 0),
            metrics.get("likes", 0),
            metrics.get("comments", 0),
            metrics.get("shares", 0),
            metrics.get("followers_delta", 0),
            json.dumps(metrics, ensure_ascii=False),
        ),
    )
    conn.execute("UPDATE posts SET metrics_json = ? WHERE id = ?", (json.dumps(metrics), post_id))


def record_metrics(args: argparse.Namespace) -> int:
    config = load_config()
    init_db(config)
    conn = connect_db(config)
    try:
        row = conn.execute(
            "SELECT id FROM posts WHERE square_id = ? OR link = ? ORDER BY published_at DESC LIMIT 1",
            (args.post, args.post),
        ).fetchone()
        if not row:
            print(f"post not found: {args.post}")
            return 1
        raw = {
            "views": args.views,
            "likes": args.likes,
            "comments": args.comments,
            "shares": args.shares,
            "followers_delta": args.followers_delta,
        }
        insert_metrics(conn, row["id"], raw)
        conn.commit()
        print(f"metrics recorded for {args.post}")
        return 0
    finally:
        conn.close()


def fetch_metrics(args: argparse.Namespace) -> int:
    config = load_config()
    init_db(config)
    conn = connect_db(config)
    try:
        if args.post:
            rows = conn.execute(
                "SELECT id, square_id, link FROM posts WHERE square_id = ? OR link = ?",
                (args.post, args.post),
            ).fetchall()
        else:
            rows = conn.execute("SELECT id, square_id, link FROM posts WHERE link IS NOT NULL ORDER BY published_at DESC").fetchall()
        if not rows:
            print("no posts with public links to fetch")
            return 0
        failures = 0
        for row in rows:
            link = row["link"]
            if not link:
                continue
            try:
                html = fetch_text(link)
                metrics = parse_public_metrics(html)
            except (urllib.error.URLError, TimeoutError) as exc:
                print(f"fetch failed for {link}: {exc}")
                failures += 1
                continue
            insert_metrics(conn, row["id"], metrics)
            print(f"fetched metrics for {row['square_id'] or link}: {metrics}")
        conn.commit()
        return 1 if failures else 0
    finally:
        conn.close()


def report(_: argparse.Namespace) -> int:
    config = load_config()
    init_db(config)
    conn = connect_db(config)
    try:
        rows = conn.execute(
            """
            SELECT p.square_id, p.link, p.published_at, p.body_hash,
                   m.views, m.likes, m.comments, m.shares, m.followers_delta, m.collected_at
            FROM posts p
            LEFT JOIN (
              SELECT post_id, MAX(id) AS max_metric_id
              FROM post_metrics
              GROUP BY post_id
            ) latest ON latest.post_id = p.id
            LEFT JOIN post_metrics m ON m.id = latest.max_metric_id
            ORDER BY p.published_at DESC
            LIMIT 30
            """
        ).fetchall()
        for row in rows:
            views = row["views"] or 0
            interactions = (row["likes"] or 0) + (row["comments"] or 0) + (row["shares"] or 0)
            engagement = interactions / views if views else 0
            print(
                f"{row['published_at']} id={row['square_id']} views={views} "
                f"engagement={engagement:.2%} followers_delta={row['followers_delta'] or 0} link={row['link']}"
            )
        return 0
    finally:
        conn.close()


def main() -> int:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(required=True)

    set_parser = subparsers.add_parser("set")
    set_parser.add_argument("post", help="Square post ID or link")
    set_parser.add_argument("--views", type=int, default=0)
    set_parser.add_argument("--likes", type=int, default=0)
    set_parser.add_argument("--comments", type=int, default=0)
    set_parser.add_argument("--shares", type=int, default=0)
    set_parser.add_argument("--followers-delta", type=int, default=0)
    set_parser.set_defaults(func=record_metrics)

    fetch_parser = subparsers.add_parser("fetch")
    fetch_parser.add_argument("--post", help="Optional Square post ID or link")
    fetch_parser.set_defaults(func=fetch_metrics)

    report_parser = subparsers.add_parser("report")
    report_parser.set_defaults(func=report)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
