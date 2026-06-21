#!/usr/bin/env python3
"""做空占比 — FINRA 每日 short volume(免费,无key)。
注：这是每日"做空成交占比"(ShortVol/TotalVol)，反映做空压力/拥挤度；
不是双月 short interest(未平仓空头)。当天/周末文件未发布会回退到最近交易日。
用法: short_vol.py NVDA [--days 5] [--legacy]

数据源优先走 data-gateway(finra-shortvol)以复用每日文件缓存(raw 只抓一次);
gateway 不可用时回退到本脚本内置的直连 FINRA 抓取。
"""
import argparse, json, subprocess, sys, urllib.request
from datetime import date, timedelta
from pathlib import Path

UA = "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120"
BASE = "https://cdn.finra.org/equity/regsho/daily/CNMSshvol{}.txt"
DATA_GATEWAY = Path("/Users/x/nimbus-os/services/data-gateway/bin/data-gateway")


def fetch_via_gateway(sym, days):
    """Returns list of {date, short, total, ratio%} via data-gateway, or None."""
    if not DATA_GATEWAY.exists():
        return None
    try:
        proc = subprocess.run(
            [str(DATA_GATEWAY), "fetch", "finra-shortvol", "--symbol", f"US:{sym}", "--days", str(days)],
            capture_output=True, text=True, timeout=90,
        )
        if proc.returncode != 0:
            return None
        data = json.loads(proc.stdout).get("data", {})
        daily = data.get("daily") or []
        rows = []
        for r in daily:
            tv = r.get("total_vol") or 0
            sv = r.get("short_vol") or 0
            rows.append({"date": r["date"], "short": sv, "total": tv, "ratio": (sv / tv * 100) if tv else 0})
        return rows or None
    except Exception:
        return None


def fetch_day(d):
    try:
        req = urllib.request.Request(BASE.format(d.strftime("%Y%m%d")), headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=15) as r:
            if r.status != 200: return None
            return r.read().decode("utf-8", "ignore")
    except Exception:
        return None


def parse(txt, sym):
    for line in txt.splitlines():
        p = line.split("|")
        if len(p) >= 5 and p[1].upper() == sym:
            try:
                sv, tv = float(p[2]), float(p[4])
                return {"date": p[0], "short": sv, "total": tv, "ratio": (sv / tv * 100) if tv else 0}
            except ValueError:
                return None
    return None


def fetch_legacy(sym, days):
    rows, d, tries = [], date.today(), 0
    while len(rows) < days and tries < days + 8:
        txt = fetch_day(d)
        if txt:
            r = parse(txt, sym)
            if r: rows.append(r)
        d -= timedelta(days=1); tries += 1
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("symbol")
    ap.add_argument("--days", type=int, default=5)
    ap.add_argument("--legacy", action="store_true", help="跳过 data-gateway,直连 FINRA")
    a = ap.parse_args()
    sym = a.symbol.upper()

    rows = None if a.legacy else fetch_via_gateway(sym, a.days)
    if not rows:
        rows = fetch_legacy(sym, a.days)
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
