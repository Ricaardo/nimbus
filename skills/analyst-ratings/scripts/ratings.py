#!/usr/bin/env python3
"""分析师评级共识与趋势 — Finnhub recommendation(免费,无价格目标)。
数据经 data-access facade(Tier-1),不可用时回退 data-gateway。Tier-2 不直连数据源。
用法: ratings.py NVDA [--legacy]
"""
import argparse, sys, subprocess, json
from pathlib import Path

DATA_GATEWAY = Path("/Users/x/nimbus-os/services/data-gateway/bin/data-gateway")


def fetch_via_facade(sym):
    """Recommendation rows via the data-access facade (Tier-1), or None."""
    try:
        sys.path.insert(0, "/Users/x/nimbus-os/services/data-access")
        import data_access as data  # noqa: PLC0415
        rows = data.ratings(f"US:{sym}", limit=8)
        return rows if isinstance(rows, list) and rows else None
    except Exception:
        return None


def fetch_via_gateway(sym):
    """Finnhub recommendation rows via data-gateway, or None if unavailable."""
    if not DATA_GATEWAY.exists():
        return None
    try:
        proc = subprocess.run(
            [str(DATA_GATEWAY), "fetch", "finnhub-ratings", "--symbol", f"US:{sym}", "--limit", "8"],
            capture_output=True, text=True, timeout=60,
        )
        if proc.returncode != 0:
            return None
        data = json.loads(proc.stdout).get("data")
        return data if isinstance(data, list) else None
    except Exception:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("symbol")
    ap.add_argument("--legacy", action="store_true", help="跳过 facade,直接走 data-gateway")
    a = ap.parse_args()
    sym = a.symbol.upper()
    data = fetch_via_gateway(sym) if a.legacy else (fetch_via_facade(sym) or fetch_via_gateway(sym))
    if data is None:
        print(f"获取失败: facade/data-gateway 均不可用", file=sys.stderr); sys.exit(1)
    if not data:
        print(f"📋 {sym}：无分析师评级数据"); return
    data = sorted(data, key=lambda x: x.get("period", ""), reverse=True)[:4]
    cur = data[0]
    tot = sum(cur.get(k, 0) for k in ("strongBuy", "buy", "hold", "sell", "strongSell")) or 1
    bull = cur.get("strongBuy", 0) + cur.get("buy", 0)
    bear = cur.get("sell", 0) + cur.get("strongSell", 0)
    score = bull / tot * 100
    tag = "强烈看多" if score >= 80 else "看多" if score >= 60 else "中性" if score >= 40 else "看空"
    print(f"📋 {sym} 分析师评级（Finnhub·{cur.get('period','?')}·{tot} 家·非投资建议）")
    print(f"共识 {tag}（{bull} 买 / {cur.get('hold',0)} 持 / {bear} 卖，看多占比 {score:.0f}%）\n")
    print("  近 4 月趋势（强买/买/持/卖/强卖）:")
    for d in data:
        print(f"    {d.get('period','?')[:7]}: {d.get('strongBuy',0)}/{d.get('buy',0)}/{d.get('hold',0)}/{d.get('sell',0)}/{d.get('strongSell',0)}")
    # 趋势判断
    if len(data) >= 2:
        prev = data[1]
        pb = prev.get("strongBuy", 0) + prev.get("buy", 0)
        if bull > pb: print("\n  📈 看多家数环比上升")
        elif bull < pb: print("\n  📉 看多家数环比下降")


if __name__ == "__main__":
    main()
