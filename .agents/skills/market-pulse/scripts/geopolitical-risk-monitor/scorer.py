"""地缘政治风险综合评分器"""

ZONES = [
    (80, "危机", "Crisis", "最大防御配置，增加对冲"),
    (60, "高度紧张", "Elevated", "对冲 + 减仓"),
    (40, "紧张", "Heightened", "密切监控 + 开始对冲"),
    (20, "关注", "Watch", "正常但保持警惕"),
    (0, "平静", "Calm", "风险偏好环境"),
]


def calculate_composite(components):
    """加权计算综合地缘政治风险评分"""
    available = [c for c in components if c.get("data_available", False)]
    if not available:
        return {
            "score": 25,
            "zone": "数据不足",
            "zone_en": "No Data",
            "guidance": "数据不足，无法评估",
            "components": components,
        }

    total_weight = sum(c["weight"] for c in available)
    weighted_sum = 0
    for c in available:
        effective_weight = c["weight"] / total_weight
        weighted_sum += c["score"] * effective_weight
        c["effective_weight"] = round(effective_weight, 4)

    score = round(max(0, min(100, weighted_sum)))

    zone_zh, zone_en, guidance = "平静", "Calm", "风险偏好环境"
    for threshold, zh, en, g in ZONES:
        if score >= threshold:
            zone_zh, zone_en, guidance = zh, en, g
            break

    for c in components:
        c["contribution"] = round(c.get("score", 25) * c.get("effective_weight", c["weight"]), 1)

    return {
        "score": score,
        "zone": zone_zh,
        "zone_en": zone_en,
        "guidance": guidance,
        "available_count": len(available),
        "total_count": len(components),
        "components": sorted(components, key=lambda x: x.get("contribution", 0), reverse=True),
    }
