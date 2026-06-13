#!/usr/bin/env python3
"""内部人交易 — Finnhub 免费 /stock/insider-transactions（SEC Form 4）。
读环境 FINNHUB_API_KEY（nimbus 已配）。
用法: insider.py NVDA [--months 6] [--top 15]
"""
import argparse, os, sys, time, urllib.request, urllib.parse, json
from datetime import date, timedelta

KEY = os.environ.get("FINNHUB_API_KEY", "")
BASE = "https://finnhub.io/api/v1/stock/insider-transactions"


def fetch(symbol, frm):
    q = urllib.parse.urlencode({"symbol": symbol, "from": frm, "token": KEY})
    for i in range(3):
        try:
            with urllib.request.urlopen(f"{BASE}?{q}", timeout=15) as r:
                return json.load(r).get("data", [])
        except Exception as e:
            if i == 2: raise
            time.sleep(1)
    return []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("symbol")
    ap.add_argument("--months", type=int, default=6)
    ap.add_argument("--top", type=int, default=15)
    a = ap.parse_args()
    if not KEY:
        print("FINNHUB_API_KEY 未设", file=sys.stderr); sys.exit(1)

    sym = a.symbol.upper()
    frm = (date.today() - timedelta(days=30 * a.months)).isoformat()
    try:
        rows = fetch(sym, frm)
    except Exception as e:
        print(f"获取失败: {e}", file=sys.stderr); sys.exit(1)
    if not rows:
        print(f"🧑‍💼 {sym} 内部人交易：近 {a.months} 月无披露"); return

    # 净增减持汇总（change>0 增持, <0 减持）
    buy = sum(r.get("change", 0) for r in rows if r.get("change", 0) > 0)
    sell = sum(-r.get("change", 0) for r in rows if r.get("change", 0) < 0)
    net = buy - sell
    rows = sorted(rows, key=lambda r: r.get("filingDate", ""), reverse=True)[: a.top]

    print(f"🧑‍💼 {sym} 内部人交易（Finnhub·近{a.months}月·SEC Form4·非投资建议）")
    print(f"净{'增持' if net>=0 else '减持'} {abs(net):,} 股（买 {buy:,} / 卖 {sell:,}）\n")
    for r in rows:
        ch = r.get("change", 0)
        emo = "🟢增" if ch > 0 else ("🔴减" if ch < 0 else "—")
        print(f"  {r.get('filingDate','?')} {r.get('name','?')[:24]} {emo} {abs(ch):,} 股 @ {r.get('transactionPrice','?')}")


if __name__ == "__main__":
    main()
