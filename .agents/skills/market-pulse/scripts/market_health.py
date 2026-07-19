#!/usr/bin/env python3
"""
market_health.py — MHS 量化近似（供 briefing 自动填充"市场温度"）

按 market-pulse 的 7 维加权公式，从可脚本化指标自动算 MHS 0-100 → 仓位%建议。
  MHS = 流动性×.25 + 周期×.20 + 情绪×.15 + 宽度×.10 + 地缘×.10 + 债券×.10 + 外汇×.10

⚠ 这是**量化近似**：流动性/周期/情绪/宽度/债券/外汇 由行情指标打分；
  地缘默认中性(可 --geo 覆盖)。完整定性深度仍走 market-pulse skill。
数据：yfinance 批量(SPY/QQQ/SMH/VIX/DXY/10Y/3M/HYG/IEF/RSP)，退避重试。
情绪用 VIX 代理(CNN F&G 端点已封)。

用法：python3 market_health.py [--geo 50] [--json]
只读，不下单。
"""
import argparse
import json
import sys
import time

TICKERS = ["SPY", "QQQ", "SMH", "^VIX", "DX-Y.NYB", "^TNX", "^IRX", "HYG", "IEF", "RSP"]


def clamp(x, lo=0.0, hi=100.0):
    return max(lo, min(hi, x))


CORE = ["SPY", "^VIX", "^TNX"]      # 缺这些则判定拉取失败


def fetch(retries=2):
    """收盘序列经 data-access facade(Tier-1: ETF→Futu, 指数→yahoo)。核心 ticker
    齐全才算成功，否则 None。返回 DataFrame(列=ticker 名，与下游 _last/_chg 兼容)。"""
    import os
    sys.path.insert(0, os.path.dirname(__file__))
    from _dataplatform import closes  # noqa: PLC0415
    import pandas as pd

    def canon(t):
        # ETF → US:; 指数/期货/外汇(^/=/含-)→ native passthrough。
        return t if (t.startswith("^") or "=" in t or "-" in t) else f"US:{t}"

    for i in range(retries):
        cols = {}
        for t in TICKERS:
            try:
                c = closes(canon(t), 320)
                if c:
                    cols[t] = pd.Series(c, dtype="float64")
            except Exception:  # noqa: BLE001
                pass
        if cols:
            df = pd.DataFrame(cols)
            if all(c in df.columns and df[c].dropna().shape[0] > 200 for c in CORE):
                return df
        if i < retries - 1:
            time.sleep(2 * (i + 1))
    return None


def _last(s):
    if s is None:
        return None
    d = s.dropna()
    return float(d.iloc[-1]) if len(d) else None


def _chg(s, n):
    """近 n 交易日百分比变化；数据不足返回 None。"""
    if s is None:
        return None
    d = s.dropna()
    if len(d) <= n:
        return None
    return (d.iloc[-1] / d.iloc[-n - 1] - 1) * 100


def _ma(s, n):
    if s is None:
        return None
    d = s.dropna()
    return float(d.tail(n).mean()) if len(d) else None


def score(df, geo):
    def col(name):
        return df[name] if name in df.columns else None

    def num(v, default=0.0):
        return default if v is None else v

    SPY = col("SPY")
    spy = _last(SPY)
    spy50, spy200 = _ma(SPY, 50), _ma(SPY, 200)
    vix = _last(col("^VIX"))
    dxy_1m = num(_chg(col("DX-Y.NYB"), 21))            # 缺→0(中性)
    tnx_1m = num(_chg(col("^TNX"), 21))
    tnx, irx = _last(col("^TNX")), _last(col("^IRX"))
    curve = (tnx - irx) if (tnx is not None and irx is not None) else 0.5  # 缺 3M→中性正
    hyg_ief_1m = num(_chg(col("HYG"), 21)) - num(_chg(col("IEF"), 21))
    rsp_spy_1m = num(_chg(col("RSP"), 21)) - num(_chg(col("SPY"), 21))

    comp = {}
    # 1 流动性: 弱美元+信用走强+长端不飙 → 宽松
    comp["流动性"] = clamp(50 - dxy_1m * 6 + hyg_ief_1m * 4 - tnx_1m * 1.5)
    # 2 周期: 站上均线 + 曲线正 + 宽度参与
    cyc = 50 + (12 if spy > spy200 else -12) + (8 if spy > spy50 else -8)
    cyc += clamp(curve * 6, -10, 10) + clamp(rsp_spy_1m * 3, -8, 8)
    comp["周期"] = clamp(cyc)
    # 3 情绪(VIX 代理, 帐篷型: 14-20 最健康, 过低=自满, 过高=恐慌)
    if vix < 12:
        sent = 55                       # 自满, 折扣
    elif vix <= 20:
        sent = 90 - (vix - 14) * 2      # 14→90, 20→78
    elif vix <= 28:
        sent = 78 - (vix - 20) * 5      # 20→78, 28→38
    else:
        sent = clamp(38 - (vix - 28) * 2, 10, 38)
    comp["情绪"] = clamp(sent)
    # 4 宽度
    comp["宽度"] = clamp(50 + (15 if spy > spy50 else -15) + clamp(rsp_spy_1m * 4, -15, 15))
    # 5 地缘(默认中性, 可覆盖)
    comp["地缘"] = clamp(geo)
    # 6 债券: 曲线正常 + 长端温和
    comp["债券"] = clamp(50 + clamp(curve * 8, -15, 15) - clamp(tnx_1m * 2, -10, 15))
    # 7 外汇: 弱美元利好风险
    comp["外汇"] = clamp(50 - dxy_1m * 7)

    W = {"流动性": .25, "周期": .20, "情绪": .15, "宽度": .10,
         "地缘": .10, "债券": .10, "外汇": .10}
    mhs = sum(comp[k] * W[k] for k in W)
    facts = {"spy_vs_200ma": round((spy / spy200 - 1) * 100, 1),
             "vix": round(vix, 1), "dxy_1m_chg": round(dxy_1m, 1),
             "curve_10y_3m": round(curve, 2), "tnx_1m_chg": round(tnx_1m, 1),
             "smh_1m": round(num(_chg(col("SMH"), 21)), 1)}
    return round(mhs, 1), comp, facts


def position_guide(mhs):
    if mhs >= 80: return "🔥 Risk-On", "80-90%", "进攻"
    if mhs >= 65: return "🟢 Bullish", "65-80%", "趋势跟踪"
    if mhs >= 50: return "🟡 Neutral", "50-65%", "只买最强 setup"
    if mhs >= 35: return "🟠 Cautious", "30-50%", "防御/收紧止损/少新开"
    if mhs >= 20: return "🔴 Defensive", "20-30%", "仅股息/对冲/减仓"
    return "⚫ Crash", "0-20%", "现金为王, 等 FTD"


def build(geo=50):
    df = fetch()
    if df is None:
        return None
    mhs, comp, facts = score(df, geo)
    state, pos, style = position_guide(mhs)
    return {"mhs": mhs, "state": state, "position": pos, "style": style,
            "components": {k: round(v, 0) for k, v in comp.items()},
            "facts": facts, "geo_override": geo}


def render(r):
    if r is None:
        return "市场温度：MHS 数据拉取失败（yf 限频？）→ 跑 market-pulse 手动"
    c = r["components"]
    cs = " ".join(f"{k}{int(v)}" for k, v in c.items())
    f = r["facts"]
    return (f"市场温度 **MHS {r['mhs']}** {r['state']} → 建议仓位 {r['position']}（{r['style']}）\n"
            f"  · 分项: {cs}\n"
            f"  · SPY vs 200MA {f['spy_vs_200ma']:+}% · VIX {f['vix']} · "
            f"10Y-3M {f['curve_10y_3m']} · DXY 1m {f['dxy_1m_chg']:+}% · SMH 1m {f['smh_1m']:+}%\n"
            f"  · ⚠量化近似，地缘默认{r['geo_override']}；完整定性走 market-pulse")


def main():
    ap = argparse.ArgumentParser(description="MHS 量化近似")
    ap.add_argument("--geo", type=float, default=50, help="地缘风险分(0差-100好)，默认中性50")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    r = build(args.geo)
    if args.json:
        print(json.dumps(r, ensure_ascii=False, indent=2))
    else:
        print(render(r))


if __name__ == "__main__":
    main()
