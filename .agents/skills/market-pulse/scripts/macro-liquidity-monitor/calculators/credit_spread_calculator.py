"""组件 4: 信用条件 (权重 15%) — BAMLH0A0HYM2 (HY OAS)"""

import logging
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)


def calculate(fred_client, lookback_days=365):
    start = (datetime.now() - timedelta(days=lookback_days)).strftime("%Y-%m-%d")

    try:
        series = fred_client.get_series("BAMLH0A0HYM2", start=start)
    except Exception as e:
        logger.error("HY OAS 获取失败: %s", e)
        return _empty("数据获取失败")

    if not series:
        return _empty("HY OAS 数据不可用")

    current = series[-1]["value"]  # basis points
    prev_4w = series[-5]["value"] if len(series) >= 5 else series[0]["value"]
    direction = "tightening" if current < prev_4w else "widening"

    # Scoring: <300bp = very loose, >700bp = crisis
    if current < 300:
        base = 90
    elif current < 400:
        base = 75
    elif current < 500:
        base = 55
    elif current < 600:
        base = 35
    elif current < 700:
        base = 20
    else:
        base = 5

    # Direction adjustment
    direction_adj = 5 if direction == "tightening" else -5
    score = max(0, min(100, base + direction_adj))

    signal = "easing" if score >= 60 else "tightening" if score < 40 else "neutral"

    return {
        "name": "信用条件",
        "weight": 0.15,
        "score": score,
        "signal": signal,
        "data_available": True,
        "data": {
            "hy_oas_bp": current,
            "change_4w_bp": round(current - prev_4w, 1),
            "direction": direction,
            "as_of": series[-1]["date"],
        },
        "reasoning": f"HY OAS 利差 {current:.0f}bp，{direction}",
    }


def _empty(reason):
    return {
        "name": "信用条件",
        "weight": 0.15,
        "score": 50,
        "signal": "neutral",
        "data_available": False,
        "data": {},
        "reasoning": reason,
    }
