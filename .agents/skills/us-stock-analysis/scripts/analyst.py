#!/usr/bin/env python3
"""分析师评级共识 — 经 data-access facade /ratings（后端 Finnhub recommendation）。
用法: analyst.py NVDA
输出: 当前共识(strongBuy/buy/hold/sell/strongSell 家数 + 看多占比) + 最近 4 月趋势 + 环比方向。
无需本地 API key（FINNHUB_API_KEY 只在 datagw plist,见 docs/ARCHITECTURE.md §5)。
"""
import argparse, os, sys


def _sdk():
    pkg = os.environ.get("DATA_ACCESS_PKG", os.path.expanduser("~/nimbus-os/services/data-access"))
    if pkg not in sys.path:
        sys.path.insert(0, pkg)
    import data_access  # noqa: PLC0415
    return data_access


def _pct(label, n, total):
    p = round(n / total * 100) if total else 0
    bar = "█" * (p // 10) + "░" * (10 - p // 10)
    return f"  {label}: {n:>3} ({p:>2}%) {bar}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("symbol", help="美股 ticker, 如 NVDA")
    a = ap.parse_args()
    sym = a.symbol.upper()

    d = _sdk().ratings(sym)
    if not d:
        print(f"📊 {sym} 分析师评级: 当前无数据或数据面不可达 (Finnhub·非投资建议)")
        return

    latest = d[0]
    bs = latest.get("buy", 0) + latest.get("strongBuy", 0)
    ss = latest.get("sell", 0) + latest.get("strongSell", 0)
    h = latest.get("hold", 0)
    total = bs + ss + h or 1
    bull_pct = round(bs / total * 100)

    print(f"📊 {sym} 分析师评级共识（Finnhub·{latest.get('period','?')}·非投资建议）")
    print(_pct("🟢看多", bs, total))
    print(_pct("⚪中性", h, total))
    print(_pct("🔴看空", ss, total))
    print(f"  {bs} 买 / {h} 持 / {ss} 卖 → 看多占比 {bull_pct}%")

    # 近 4 月趋势
    recent = d[:4]
    if len(recent) >= 2:
        prev = recent[-1]
        p_bs = prev.get("buy", 0) + prev.get("strongBuy", 0)
        p_ss = prev.get("sell", 0) + prev.get("strongSell", 0)
        p_total = p_bs + p_ss + prev.get("hold", 0) or 1
        prev_bull = round(p_bs / p_total * 100)
        delta = bull_pct - prev_bull
        trend = "↑上调" if delta > 5 else ("↓下调" if delta < -5 else "→持平")
        print(f"\n  近 4 月趋势: {prev_bull}% → {bull_pct}% {trend} ({delta:+d}pp)")
        if trend == "↑上调":
            print("  ⚡ 评级环比改善——分析师情绪在转暖")
        elif trend == "↓下调":
            print("  ⚠ 评级环比下降——分析师情绪在转冷")

    print("\n  ⚠ 只有评级家数分布,不含目标价(Finnhub 目标价付费);评级是滞后/羊群指标,趋势变化比绝对值更有信息量。")


if __name__ == "__main__":
    main()
