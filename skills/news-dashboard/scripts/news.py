#!/usr/bin/env python3
"""Stock news via yfinance. Returns headlines, publishers, dates, links."""
import argparse
import json
import sys
from datetime import datetime, timezone


def get_news(symbol: str, limit: int = 10) -> dict:
    try:
        import yfinance as yf
    except ImportError:
        return {"error": "yfinance not installed. Run: pip install yfinance"}

    try:
        t = yf.Ticker(symbol)
        raw = t.news or []
    except Exception as e:
        return {"error": f"fetch failed: {e}"}

    articles = []
    for item in raw[:limit]:
        # yfinance returns a nested 'content' structure in newer versions
        c = item.get("content", item)
        pub = c.get("pubDate") or c.get("providerPublishTime")
        if isinstance(pub, (int, float)):
            pub = datetime.fromtimestamp(pub, tz=timezone.utc).isoformat()
        link_obj = c.get("canonicalUrl") or c.get("clickThroughUrl") or {}
        link = link_obj.get("url") if isinstance(link_obj, dict) else (c.get("link") or "")
        articles.append({
            "title": c.get("title", ""),
            "publisher": (c.get("provider") or {}).get("displayName") if isinstance(c.get("provider"), dict) else c.get("publisher", ""),
            "published": pub,
            "link": link,
            "summary": c.get("summary", "")[:300],
        })
    return {"symbol": symbol, "count": len(articles), "articles": articles}


def main():
    p = argparse.ArgumentParser(description="Fetch stock news via yfinance")
    p.add_argument("symbol")
    p.add_argument("--limit", type=int, default=10)
    args = p.parse_args()
    result = get_news(args.symbol.upper(), args.limit)
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
