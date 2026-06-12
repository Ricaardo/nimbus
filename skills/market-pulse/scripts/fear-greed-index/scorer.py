"""多市场贪恐指数综合评分器

评分方向: 0 = 极度恐惧, 100 = 极度贪婪
支持单市场评分和全市场加权合成
"""

ZONES = [
    (80, "极度贪婪", "Extreme Greed", "警惕回调，考虑减仓或对冲"),
    (60, "贪婪", "Greed", "保持仓位，设好止损"),
    (40, "中性", "Neutral", "信号混合，可择机建仓"),
    (20, "恐惧", "Fear", "关注优质标的，分批建仓"),
    (0, "极度恐惧", "Extreme Fear", "逆向布局，长期机会"),
]

MISSING_DEFAULT_SCORE = 45

# 全市场合成权重
MARKET_WEIGHTS = {
    "US": 0.45,
    "A-Share": 0.25,
    "HK": 0.15,
    "Crypto": 0.15,
}


def _get_zone(score):
    for threshold, zh, en, guidance in ZONES:
        if score >= threshold:
            return zh, en, guidance
    return "极度恐惧", "Extreme Fear", "逆向布局，长期机会"


def calculate_market_score(market_result):
    """计算单个市场的贪恐指数"""
    components = market_result["components"]
    available = [c for c in components if c.get("data_available", False)]
    total = len(components)
    n_available = len(available)

    if n_available == 0:
        return {
            "market": market_result["market"],
            "market_en": market_result["market_en"],
            "score": 50,
            "zone": "数据不足",
            "zone_en": "No Data",
            "guidance": "数据不足，保守处理",
            "confidence": "none",
            "coverage": 0,
            "components": components,
        }

    weighted_sum = 0
    for c in components:
        score = c["score"] if c.get("data_available", False) else MISSING_DEFAULT_SCORE
        weighted_sum += score * c["weight"]
        c["effective_score"] = score
        c["contribution"] = round(score * c["weight"], 1)

    coverage = n_available / total
    if coverage < 0.6:
        weighted_sum = weighted_sum * 0.70 + 50 * 0.30
    elif coverage < 0.8:
        weighted_sum = weighted_sum * 0.85 + 50 * 0.15

    score = round(max(0, min(100, weighted_sum)))

    if coverage >= 0.875:
        confidence = "high"
    elif coverage >= 0.625:
        confidence = "medium"
    else:
        confidence = "low"

    zone_zh, zone_en, guidance = _get_zone(score)
    if confidence != "high":
        guidance += f"（数据覆盖 {n_available}/{total}，置信度{confidence}）"

    return {
        "market": market_result["market"],
        "market_en": market_result["market_en"],
        "score": score,
        "zone": zone_zh,
        "zone_en": zone_en,
        "guidance": guidance,
        "confidence": confidence,
        "coverage": round(coverage, 2),
        "components": sorted(components, key=lambda x: x.get("contribution", 0), reverse=True),
    }


def calculate_global_score(market_scores):
    """合成全球贪恐指数"""
    if not market_scores:
        return {"score": 50, "zone": "数据不足", "zone_en": "No Data", "guidance": "无市场数据"}

    weighted_sum = 0
    total_weight = 0

    for ms in market_scores:
        market_en = ms["market_en"]
        w = MARKET_WEIGHTS.get(market_en, 0.10)
        if ms.get("confidence") == "none":
            continue
        weighted_sum += ms["score"] * w
        total_weight += w

    if total_weight == 0:
        return {"score": 50, "zone": "数据不足", "zone_en": "No Data", "guidance": "无有效市场数据"}

    score = round(weighted_sum / total_weight)
    score = max(0, min(100, score))
    zone_zh, zone_en, guidance = _get_zone(score)

    return {
        "score": score,
        "zone": zone_zh,
        "zone_en": zone_en,
        "guidance": guidance,
        "markets": market_scores,
    }
