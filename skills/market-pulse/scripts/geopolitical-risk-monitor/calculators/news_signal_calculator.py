"""组件 1: 新闻地缘信号 (权重 30%) — Finnhub + keyword_classifier"""

import logging
import os
import sys

logger = logging.getLogger(__name__)

shared_dir = os.path.join(os.path.dirname(__file__), "..", "..", "..", "shared")
if shared_dir not in sys.path:
    sys.path.insert(0, shared_dir)

scripts_dir = os.path.join(os.path.dirname(__file__), "..")
if scripts_dir not in sys.path:
    sys.path.insert(0, scripts_dir)


def calculate(finnhub_client, lookback_days=7):
    try:
        from keyword_classifier import classify_batch
    except ImportError:
        logger.error("keyword_classifier 导入失败")
        return _empty("模块导入失败")

    try:
        articles = finnhub_client.get_market_news("general")
    except Exception as e:
        logger.error("Finnhub 新闻获取失败: %s", e)
        return _empty("新闻获取失败")

    if not articles:
        return _empty("无新闻数据")

    result = classify_batch(articles)
    geo_count = result["geo_articles"]
    total = result["total_articles"]
    geo_ratio = result["geo_ratio"]
    avg_severity = result["avg_severity"]

    # Scoring: high geo article ratio + high severity = high risk
    ratio_score = min(geo_ratio * 200, 50)  # 0-50 from ratio
    severity_score = avg_severity * 50  # 0-50 from severity

    score = round(min(100, ratio_score + severity_score))
    signal = "crisis" if score >= 60 else "elevated" if score >= 40 else "calm"

    # Top categories
    top_cats = sorted(result["category_counts"].items(), key=lambda x: x[1], reverse=True)

    return {
        "name": "新闻地缘信号",
        "weight": 0.30,
        "score": score,
        "signal": signal,
        "data_available": True,
        "data": {
            "total_articles": total,
            "geo_articles": geo_count,
            "geo_ratio": geo_ratio,
            "avg_severity": avg_severity,
            "top_categories": dict(top_cats[:3]),
            "top_regions": result["region_counts"],
        },
        "top_articles": result["top_articles"][:5],
        "reasoning": f"地缘文章 {geo_count}/{total}，占比 {geo_ratio*100:.1f}%，平均严重性 {avg_severity:.2f}",
    }


def _empty(reason):
    return {
        "name": "新闻地缘信号",
        "weight": 0.30,
        "score": 25,
        "signal": "calm",
        "data_available": False,
        "data": {},
        "reasoning": reason,
    }
