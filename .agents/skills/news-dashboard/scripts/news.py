#!/usr/bin/env python3
"""Per-symbol stock news via the data-access facade (Finnhub company-news).
Returns headlines, publishers, dates, links."""
import argparse
import json
import os
import sys
from datetime import datetime, timezone


def get_news(symbol: str, limit: int = 10) -> dict:
    pkg = os.environ.get("DATA_ACCESS_PKG", os.path.expanduser("~/nimbus-os/services/data-access"))
    if pkg not in sys.path:
        sys.path.insert(0, pkg)
    try:
        import data_access as data
    except Exception as e:  # noqa: BLE001
        return {"error": f"data-access facade unavailable: {e}"}

    try:
        raw = data.company_news(symbol, limit=limit) or []
    except Exception as e:  # noqa: BLE001
        return {"error": f"fetch failed: {e}"}

    articles = []
    for c in raw[:limit]:
        pub = c.get("datetime")
        if isinstance(pub, (int, float)):
            pub = datetime.fromtimestamp(pub, tz=timezone.utc).isoformat()
        articles.append({
            "title": c.get("headline", ""),
            "publisher": c.get("source", ""),
            "published": pub,
            "link": c.get("url", ""),
            "summary": (c.get("summary", "") or "")[:300],
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
