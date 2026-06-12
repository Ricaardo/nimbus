"""Unified real-time price fetcher via futu. Handles ticker mapping automatically.

Output: JSON array with one object per ticker, standardized fields.
Fields: input, futu_code, name, price, prev_close, change, change_pct,
        volume, turnover, high, low, open, market_cap (if available).

Unsupported tickers (crypto/commodities/US indices with no ETF proxy) return
  {"input": ..., "error": "unsupported", "hint": "..."}.

Usage:
    python3 get_price.py AAPL 600519.SH 00700.HK ^HSI
"""
import sys
import os
import json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ticker_mapper import to_futu, detect_market

try:
    from futu import OpenQuoteContext, RET_OK
except ImportError:
    print(json.dumps({"error": "futu-api not installed. Run: pip install futu-api"}))
    sys.exit(1)


def fetch(tickers: list[str], host: str = "127.0.0.1", port: int = 11111) -> list[dict]:
    # Map all tickers
    mapping = []
    for t in tickers:
        futu = to_futu(t)
        mapping.append({"input": t, "futu": futu, "market": detect_market(t)})

    codes = [m["futu"] for m in mapping if m["futu"]]
    snapshot = {}
    if codes:
        q = OpenQuoteContext(host=host, port=port)
        try:
            # snapshot supports up to 400 per call
            for i in range(0, len(codes), 400):
                ret, data = q.get_market_snapshot(codes[i:i+400])
                if ret == RET_OK:
                    for _, row in data.iterrows():
                        snapshot[row["code"]] = row
        finally:
            q.close()

    results = []
    for m in mapping:
        if not m["futu"]:
            results.append({
                "input": m["input"],
                "error": "unsupported",
                "hint": "crypto/commodity/US-index — use CoinGecko or yfinance fallback",
            })
            continue
        row = snapshot.get(m["futu"])
        if row is None:
            results.append({
                "input": m["input"],
                "futu_code": m["futu"],
                "error": "no_data",
            })
            continue
        last = float(row.get("last_price", 0) or 0)
        prev = float(row.get("prev_close_price", 0) or 0)
        change = last - prev if prev else 0
        change_pct = (change / prev * 100) if prev else 0
        results.append({
            "input": m["input"],
            "futu_code": m["futu"],
            "name": row.get("name", ""),
            "price": last,
            "prev_close": prev,
            "change": round(change, 4),
            "change_pct": round(change_pct, 3),
            "open": float(row.get("open_price", 0) or 0),
            "high": float(row.get("high_price", 0) or 0),
            "low": float(row.get("low_price", 0) or 0),
            "volume": int(row.get("volume", 0) or 0),
            "turnover": float(row.get("turnover", 0) or 0),
            "market_cap": float(row.get("total_market_val", 0) or 0),
            "pe": float(row.get("pe_ratio", 0) or 0) if row.get("pe_ratio") not in (None, "N/A") else None,
        })
    return results


if __name__ == "__main__":
    tickers = sys.argv[1:]
    if not tickers:
        print("Usage: python3 get_price.py SYMBOL [SYMBOL ...]")
        sys.exit(1)
    print(json.dumps(fetch(tickers), ensure_ascii=False, indent=2, default=str))
