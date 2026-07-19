"""组件 6: 隔夜利率 (权重 5%) — SOFR vs 目标利率"""

import logging
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)


def calculate(fred_client, lookback_days=90):
    start = (datetime.now() - timedelta(days=lookback_days)).strftime("%Y-%m-%d")

    try:
        sofr = fred_client.get_series("SOFR", start=start)
        fedfunds = fred_client.get_series("FEDFUNDS", start=start)
    except Exception as e:
        logger.error("隔夜利率数据获取失败: %s", e)
        return _empty("数据获取失败")

    if not sofr or not fedfunds:
        return _empty("SOFR/FEDFUNDS 数据不可用")

    current_sofr = sofr[-1]["value"]
    target = fedfunds[-1]["value"]
    deviation = abs(current_sofr - target)

    # SOFR volatility (std of last 20 observations)
    recent_sofr = [obs["value"] for obs in sofr[-20:]]
    if len(recent_sofr) >= 5:
        mean = sum(recent_sofr) / len(recent_sofr)
        variance = sum((x - mean) ** 2 for x in recent_sofr) / len(recent_sofr)
        vol = variance ** 0.5
    else:
        vol = 0

    # Scoring: small deviation + low volatility = healthy
    if deviation < 0.05 and vol < 0.03:
        score = 85
    elif deviation < 0.10 and vol < 0.05:
        score = 70
    elif deviation < 0.20:
        score = 50
    elif deviation < 0.50:
        score = 30
    else:
        score = 10

    signal = "easing" if score >= 60 else "tightening" if score < 40 else "neutral"

    return {
        "name": "隔夜利率",
        "weight": 0.05,
        "score": score,
        "signal": signal,
        "data_available": True,
        "data": {
            "sofr": current_sofr,
            "fed_funds_target": target,
            "deviation": round(deviation, 4),
            "sofr_vol_20d": round(vol, 4),
            "as_of": sofr[-1]["date"],
        },
        "reasoning": f"SOFR {current_sofr:.2f}% vs 目标 {target:.2f}%，偏差 {deviation:.2f}%",
    }


def _empty(reason):
    return {
        "name": "隔夜利率",
        "weight": 0.05,
        "score": 50,
        "signal": "neutral",
        "data_available": False,
        "data": {},
        "reasoning": reason,
    }
