#!/usr/bin/env python3
"""做空占比 — FINRA 每日 short volume(免费,无key)。
注：这是每日"做空成交占比"(ShortVol/TotalVol)，反映做空压力/拥挤度；
不是双月 short interest(未平仓空头)。当天/周末文件未发布会回退到最近交易日。
用法: short_vol.py NVDA [--days 5] [--legacy]

数据经 data-access facade(Tier-1),不可用时回退 datagw /short(同一 FINRA 聚合,复用每日文件缓存)。
Tier-2 不直连数据源。
"""
import argparse, json, os, sys
import urllib.request

DATAGW_URL = os.environ.get("DATAGW_URL", "http://127.0.0.1:8821")


def fetch_via_facade(sym, days):
    """Daily short-volume rows via the data-access facade (Tier-1), or None."""
    try:
        sys.path.insert(0, "/Users/x/nimbus-os/services/data-access")
        import data_access as data  # noqa: PLC0415
        daily = (data.short(f"US:{sym}", days=days) or {}).get("daily") or []
        rows = []
        for r in daily:
            tv = r.get("total_vol") or 0
            sv = r.get("short_vol") or 0
            rows.append({"date": r["date"], "short": sv, "total": tv, "ratio": (sv / tv * 100) if tv else 0})
        return rows or None
    except Exception:
        return None


def fetch_via_gateway(sym, days):
    """Returns list of {date, short, total, ratio%} via datagw /short, or None."""
    try:
        with urllib.request.urlopen(f"{DATAGW_URL}/short?symbol=US:{sym}&days={days}", timeout=90) as r:  # noqa: S310
            data = json.loads(r.read()).get("data", {})
        daily = data.get("daily") or []
        rows = []
        for r in daily:
            tv = r.get("total_vol") or 0
            sv = r.get("short_vol") or 0
            rows.append({"date": r["date"], "short": sv, "total": tv, "ratio": (sv / tv * 100) if tv else 0})
        return rows or None
    except Exception:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("symbol")
    ap.add_argument("--days", type=int, default=5)
    ap.add_argument("--legacy", action="store_true", help="跳过 facade,直接走 datagw")
    a = ap.parse_args()
    sym = a.symbol.upper()

    rows = fetch_via_gateway(sym, a.days) if a.legacy else (fetch_via_facade(sym, a.days) or fetch_via_gateway(sym, a.days))
    if not rows:
        print(f"🩳 {sym}：未取到 FINRA 做空数据（近期文件未发布或代码无成交）"); return

    avg = sum(r["ratio"] for r in rows) / len(rows)
    print(f"🩳 {sym} 做空占比（FINRA 每日 ShortVol/TotalVol·非未平仓空头·非投资建议）")
    print(f"近 {len(rows)} 日均 {avg:.1f}%\n")
    for r in rows:
        bar = "█" * int(r["ratio"] / 5)
        print(f"  {r['date']}: {r['ratio']:.1f}% {bar}  (空 {r['short']/1e6:.1f}M / 总 {r['total']/1e6:.1f}M)")


if __name__ == "__main__":
    main()
