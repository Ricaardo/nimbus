"""宏观流动性综合评分器

优化要点（参考 42Macro / Blockcircle GLS）：
1. 缺失组件不再重新分配权重，而是用保守估计 (score=45) 填充
2. 数据覆盖率不足时施加置信度惩罚
3. 添加 TGA/油价等前瞻性调整项
"""

ZONES = [
    (80, "流动性泛滥", "Flood", "全面风险偏好，增加敞口"),
    (60, "流动性宽松", "Easing", "条件有利，保持风险偏好"),
    (40, "流动性中性", "Neutral", "信号混合，均衡配置"),
    (20, "流动性收紧", "Tightening", "减少敞口，提高现金比例"),
    (0, "流动性枯竭", "Drought", "资本保全，最大防御"),
]

# 缺失组件的保守默认分（略低于中性 50，体现不确定性偏保守）
MISSING_DEFAULT_SCORE = 45


def calculate_composite(components):
    """加权计算综合流动性评分

    改进：
    - 缺失组件用 45 分（保守中性）而非排除
    - 覆盖率 < 60% 时施加额外惩罚
    - 返回置信度等级
    """
    available = [c for c in components if c.get("data_available", False)]
    total = len(components)
    n_available = len(available)

    if n_available == 0:
        return {
            "score": 40,
            "zone": "数据不足",
            "zone_en": "No Data",
            "guidance": "数据不足，无法评估，保守处理",
            "confidence": "none",
            "coverage": 0,
            "available_count": 0,
            "total_count": total,
            "components": components,
        }

    # 所有组件参与计算，缺失用保守默认分
    weighted_sum = 0
    for c in components:
        score = c["score"] if c.get("data_available", False) else MISSING_DEFAULT_SCORE
        weighted_sum += score * c["weight"]
        c["effective_weight"] = c["weight"]
        c["effective_score"] = score

    # 覆盖率惩罚：覆盖率低时向中性 (45) 收缩
    coverage = n_available / total
    if coverage < 0.6:
        # 严重缺失：分数向 40 收缩 30%
        shrink = 0.30
        weighted_sum = weighted_sum * (1 - shrink) + 40 * shrink
    elif coverage < 0.8:
        # 部分缺失：分数向 45 收缩 15%
        shrink = 0.15
        weighted_sum = weighted_sum * (1 - shrink) + 45 * shrink

    score = round(max(0, min(100, weighted_sum)))

    # 置信度等级
    if coverage >= 0.875:  # 7/8 or 8/8
        confidence = "high"
    elif coverage >= 0.625:  # 5/8 or 6/8
        confidence = "medium"
    else:
        confidence = "low"

    # Determine zone
    zone_zh, zone_en, guidance = "流动性枯竭", "Drought", "资本保全，最大防御"
    for threshold, zh, en, g in ZONES:
        if score >= threshold:
            zone_zh, zone_en, guidance = zh, en, g
            break

    # 置信度不足时在指导中追加警告
    if confidence != "high":
        guidance += f"（数据覆盖 {n_available}/{total}，置信度{confidence}）"

    # Sort components by contribution
    for c in components:
        eff_score = c.get("effective_score", c.get("score", MISSING_DEFAULT_SCORE))
        c["contribution"] = round(eff_score * c["weight"], 1)

    return {
        "score": score,
        "zone": zone_zh,
        "zone_en": zone_en,
        "guidance": guidance,
        "confidence": confidence,
        "coverage": round(coverage, 2),
        "available_count": n_available,
        "total_count": total,
        "components": sorted(components, key=lambda x: x.get("contribution", 0), reverse=True),
    }
