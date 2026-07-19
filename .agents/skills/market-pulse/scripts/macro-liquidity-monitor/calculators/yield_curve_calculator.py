"""组件 3: 收益率曲线 (权重 15%) — GS2, GS10"""

import logging
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)


def calculate(fred_client, lookback_days=365):
    start = (datetime.now() - timedelta(days=lookback_days)).strftime("%Y-%m-%d")

    try:
        gs2 = fred_client.get_series("GS2", start=start)
        gs10 = fred_client.get_series("GS10", start=start)
    except Exception as e:
        logger.error("收益率数据获取失败: %s", e)
        return _empty("数据获取失败")

    if not gs2 or not gs10:
        return _empty("GS2/GS10 数据不可用")

    current_2y = gs2[-1]["value"]
    current_10y = gs10[-1]["value"]
    spread_2s10s = round(current_10y - current_2y, 4)

    # Direction: compare to 4 weeks ago
    prev_2y = gs2[-5]["value"] if len(gs2) >= 5 else gs2[0]["value"]
    prev_10y = gs10[-5]["value"] if len(gs10) >= 5 else gs10[0]["value"]
    prev_spread = prev_10y - prev_2y
    spread_change = round(spread_2s10s - prev_spread, 4)

    steepening = spread_change > 0

    # Scoring:
    # Normal steep (>0) + steepening = highest score (bullish liquidity)
    # Inverted (<0) + steepening = moderate (healing)
    # Inverted + flattening = low score (worsening)
    if spread_2s10s > 0.5:
        base = 80
    elif spread_2s10s > 0:
        base = 65
    elif spread_2s10s > -0.5:
        base = 40
    elif spread_2s10s > -1.0:
        base = 25
    else:
        base = 10

    direction_adj = 10 if steepening else -10
    score = max(0, min(100, base + direction_adj))

    signal = "easing" if score >= 60 else "tightening" if score < 40 else "neutral"

    return {
        "name": "收益率曲线",
        "weight": 0.15,
        "score": score,
        "signal": signal,
        "data_available": True,
        "data": {
            "gs2": current_2y,
            "gs10": current_10y,
            "spread_2s10s": spread_2s10s,
            "spread_change_4w": spread_change,
            "steepening": steepening,
            "as_of": gs10[-1]["date"],
        },
        "reasoning": f"2s10s 利差 {spread_2s10s:+.2f}%，{'变陡' if steepening else '趋平'}",
    }


def _empty(reason):
    return {
        "name": "收益率曲线",
        "weight": 0.15,
        "score": 50,
        "signal": "neutral",
        "data_available": False,
        "data": {},
        "reasoning": reason,
    }
