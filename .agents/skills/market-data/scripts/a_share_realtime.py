#!/usr/bin/env python3
"""
A股实时行情 fallback — 直连 sina / 腾讯 API。

Why: stock-data MCP 的 stock_realtime A股市场坏了（上游东财全市场行情 cluster 返回 empty），
本脚本直连 sina/qq 单股 API 拿到实时报价，是最稳定的 A股 realtime 路径。

Usage:
  python3 a_share_realtime.py 600519           # default sh
  python3 a_share_realtime.py 600519 --json
  python3 a_share_realtime.py 600519 000858 000001
"""
import argparse
import json
import sys
from urllib.request import Request, urlopen


def detect_market(code: str) -> str:
    if code.startswith(("60", "688", "510", "511", "513", "159")):
        return "sh"
    if code.startswith(("00", "30", "159", "150")):
        return "sz"
    return "sh"


def fetch_sina(code: str, market: str) -> dict | None:
    url = f"https://hq.sinajs.cn/list={market}{code}"
    req = Request(url, headers={"Referer": "https://finance.sina.com.cn"})
    try:
        body = urlopen(req, timeout=5).read().decode("gbk", errors="ignore")
    except Exception:
        return None
    if "=" not in body:
        return None
    raw = body.split('"', 2)[1] if '"' in body else ""
    parts = raw.split(",")
    if len(parts) < 32:
        return None
    try:
        prev = float(parts[2])
        last = float(parts[3])
        return {
            "symbol": f"{market.upper()}.{code}",
            "name": parts[0],
            "open": float(parts[1]),
            "prev_close": prev,
            "last": last,
            "high": float(parts[4]),
            "low": float(parts[5]),
            "volume": int(float(parts[8])),
            "amount": float(parts[9]),
            "change": round(last - prev, 4),
            "change_pct": round((last - prev) / prev * 100, 2) if prev else 0,
            "date": parts[30],
            "time": parts[31],
            "source": "sina",
        }
    except Exception:
        return None


def fetch_qq(code: str, market: str) -> dict | None:
    url = f"https://qt.gtimg.cn/q={market}{code}"
    try:
        body = urlopen(url, timeout=5).read().decode("gbk", errors="ignore")
    except Exception:
        return None
    if '="' not in body:
        return None
    raw = body.split('="', 1)[1].rstrip(';\n";')
    parts = raw.split("~")
    if len(parts) < 47:
        return None
    try:
        return {
            "symbol": f"{market.upper()}.{code}",
            "name": parts[1],
            "open": float(parts[5]),
            "prev_close": float(parts[4]),
            "last": float(parts[3]),
            "high": float(parts[33]),
            "low": float(parts[34]),
            "volume": int(parts[6]),
            "amount": float(parts[37]) * 10000 if parts[37] else 0,
            "change": float(parts[31]),
            "change_pct": float(parts[32]),
            "pe": float(parts[39]) if parts[39] else None,
            "pb": float(parts[46]) if parts[46] else None,
            "market_cap": float(parts[45]) * 1e8 if parts[45] else None,
            "source": "qq",
        }
    except Exception:
        return None


def quote_via_facade(code: str) -> dict | None:
    import os
    if os.environ.get("MARKET_DATA_LEGACY") == "1":
        return None
    import sys
    sys.path.insert(0, os.path.dirname(__file__))
    try:
        from _dataclient import to_canonical  # noqa: PLC0415
        import data_access as data  # noqa: PLC0415
        rows = data.quote(to_canonical(code))
        if not rows:
            return None
        q = rows[0]
        last = float(q["last"]) if q.get("last") is not None else None
        prev = float(q["prev_close"]) if q.get("prev_close") is not None else None
        chg = (last - prev) if (last is not None and prev) else 0.0
        return {
            "symbol": q.get("futu_symbol") or f"A.{code}", "name": "",
            "last": last or 0.0, "change": chg,
            "change_pct": (chg / prev * 100) if prev else 0.0,
            "volume": int(q.get("volume") or 0), "source": "facade",
        }
    except Exception:  # noqa: BLE001
        return None


def quote(code: str) -> dict:
    out = quote_via_facade(code)
    if out is not None:
        return out
    market = detect_market(code)
    for fn in (fetch_sina, fetch_qq):
        out = fn(code, market)
        if out is not None:
            return out
    return {"symbol": f"{market.upper()}.{code}", "error": "all upstreams failed"}


def main() -> int:
    ap = argparse.ArgumentParser(description="A股实时行情 (sina/qq 直连 fallback)")
    ap.add_argument("symbols", nargs="+", help="6位股票代码，如 600519")
    ap.add_argument("--json", action="store_true", help="JSON 输出")
    args = ap.parse_args()

    results = [quote(s) for s in args.symbols]

    if args.json:
        print(json.dumps(results, ensure_ascii=False, indent=2))
        return 0

    print(f"{'代码':<14}{'名称':<10}{'最新':>10}{'涨跌':>9}{'涨跌幅':>9}{'成交量':>14}  来源")
    for r in results:
        if "error" in r:
            print(f"{r['symbol']:<14}  {r['error']}")
            continue
        print(
            f"{r['symbol']:<14}{r['name']:<10}{r['last']:>10.2f}"
            f"{r['change']:>+9.2f}{r['change_pct']:>+8.2f}%"
            f"{r['volume']:>14,}  {r['source']}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
