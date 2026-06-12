"""组件 1: Fed 资产负债表 & 储备 (权重 15%)

增强:
- WALCL 4w/13w 动量
- SOMA (TREAST + WSHOMCB) QT 速度追踪
- WRESBAL 银行储备金水平
- RRPONTSYD 枯竭风险检测
"""

import logging
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

# 储备金危险阈值（万亿）— 低于此值流动性风险显著上升
RESERVES_WARNING_T = 2.8
RESERVES_DANGER_T = 2.5

# RRP 枯竭阈值（十亿美元）— 低于此值意味着缓冲耗尽
RRP_DEPLETED_B = 50  # $50B 以下视为枯竭


def calculate(fred_client, lookback_days=365):
    start = (datetime.now() - timedelta(days=lookback_days)).strftime("%Y-%m-%d")

    # 获取所有相关 series
    raw = {}
    for sid in ["WALCL", "TREAST", "WSHOMCB", "WRESBAL", "RRPONTSYD"]:
        try:
            raw[sid] = fred_client.get_series(sid, start=start)
        except Exception as e:
            logger.debug("%s 获取失败: %s", sid, e)
            raw[sid] = []

    series = raw.get("WALCL", [])
    if not series or len(series) < 5:
        return _empty("WALCL 数据不足")

    current = series[-1]["value"]
    w4_ago = series[-5]["value"] if len(series) >= 5 else series[0]["value"]
    w13_ago = series[-14]["value"] if len(series) >= 14 else series[0]["value"]

    change_4w = current - w4_ago
    change_13w = current - w13_ago
    pct_4w = (change_4w / w4_ago * 100) if w4_ago else 0
    pct_13w = (change_13w / w13_ago * 100) if w13_ago else 0

    # === 基础评分: WALCL 动量 ===
    if change_4w > 0 and change_13w > 0:
        if pct_4w > pct_13w / 3.25:
            score = min(90, 75 + abs(pct_4w) * 8)
        else:
            score = min(75, 62 + abs(pct_4w) * 4)
    elif change_4w > 0:
        score = 55
    elif change_13w > 0:
        score = 42
    else:
        if abs(pct_4w) > abs(pct_13w) / 3.25:
            score = max(5, 20 - abs(pct_4w) * 8)
        else:
            score = 28

    # === SOMA QT 速度 ===
    soma_data = {}
    for sid, label in [("TREAST", "国债"), ("WSHOMCB", "MBS")]:
        s = raw.get(sid, [])
        if s and len(s) >= 5:
            curr_v = s[-1]["value"]
            w4_v = s[-5]["value"] if len(s) >= 5 else s[0]["value"]
            w13_v = s[-14]["value"] if len(s) >= 14 else s[0]["value"]
            soma_data[sid] = {
                "current_trillions": round(curr_v / 1_000_000, 3),
                "change_4w_billions": round((curr_v - w4_v) / 1000, 1),
                "change_13w_billions": round((curr_v - w13_v) / 1000, 1),
            }

    # === 银行储备金水平 ===
    reserves_t = None
    reserves_risk = ""
    wresbal = raw.get("WRESBAL", [])
    if wresbal:
        reserves_t = wresbal[-1]["value"] / 1_000_000
        if reserves_t < RESERVES_DANGER_T:
            score -= 10
            reserves_risk = f"🔴 储备金 {reserves_t:.2f}T 低于危险线 {RESERVES_DANGER_T}T"
        elif reserves_t < RESERVES_WARNING_T:
            score -= 5
            reserves_risk = f"🟡 储备金 {reserves_t:.2f}T 接近警戒线"
        else:
            reserves_risk = f"✅ 储备金 {reserves_t:.2f}T 充足"

    # === RRP 枯竭检测 ===
    rrp_b = None
    rrp_risk = ""
    rrp_series = raw.get("RRPONTSYD", [])
    if rrp_series:
        rrp_b = rrp_series[-1]["value"]  # FRED 单位: billions
        if rrp_b < RRP_DEPLETED_B:
            # RRP 基本枯竭 — 流动性缓冲消失，系统更脆弱
            score -= 8
            rrp_risk = f"🔴 RRP ${rrp_b:.1f}B 已枯竭，流动性缓冲消失"
            logger.warning("RRP 枯竭: $%.1fB，系统对 TGA 波动更敏感", rrp_b)

    score = max(0, min(100, round(score)))
    signal = "easing" if score >= 60 else "tightening" if score < 40 else "neutral"

    # 构建 data 输出
    data = {
        "current_trillions": round(current / 1_000_000, 3),
        "change_4w_billions": round(change_4w / 1000, 1),
        "change_13w_billions": round(change_13w / 1000, 1),
        "pct_4w": round(pct_4w, 3),
        "pct_13w": round(pct_13w, 3),
        "as_of": series[-1]["date"],
    }
    if soma_data:
        data["soma"] = soma_data
    if reserves_t is not None:
        data["reserves_trillions"] = round(reserves_t, 3)
        data["reserves_risk"] = reserves_risk
    if rrp_b is not None:
        data["rrp_billions"] = round(rrp_b, 2)
        data["rrp_risk"] = rrp_risk

    reasoning_parts = [
        f"Fed 总资产 {current/1_000_000:.3f}T，4w {change_4w/1000:+.1f}B / 13w {change_13w/1000:+.1f}B"
    ]
    if reserves_risk:
        reasoning_parts.append(reserves_risk)
    if rrp_risk:
        reasoning_parts.append(rrp_risk)

    return {
        "name": "Fed 资产负债表",
        "weight": 0.15,
        "score": score,
        "signal": signal,
        "data_available": True,
        "data": data,
        "reasoning": "；".join(reasoning_parts),
    }


def _empty(reason):
    return {
        "name": "Fed 资产负债表",
        "weight": 0.15,
        "score": 50,
        "signal": "neutral",
        "data_available": False,
        "data": {},
        "reasoning": reason,
    }
