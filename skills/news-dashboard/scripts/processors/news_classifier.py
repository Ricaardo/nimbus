"""新闻分类器 — 按主题分类: monetary/earnings/geopolitical/economic/market/crypto"""

import logging

logger = logging.getLogger(__name__)

CATEGORY_KEYWORDS = {
    "monetary": [
        "fed", "fomc", "rate cut", "rate hike", "monetary policy", "central bank",
        "inflation target", "quantitative", "tightening", "easing", "hawkish", "dovish",
        "ecb", "boj", "pboc", "interest rate", "treasury yield",
    ],
    "earnings": [
        "earnings", "revenue", "profit", "eps", "guidance", "beat", "miss",
        "quarterly results", "annual report", "forecast", "outlook",
    ],
    "geopolitical": [
        "war", "sanctions", "tariff", "conflict", "military", "nato",
        "missile", "invasion", "embargo", "trade war", "geopolitical",
        "nuclear", "coup", "election crisis",
    ],
    "economic": [
        "gdp", "jobs", "unemployment", "cpi", "ppi", "pmi", "ism",
        "retail sales", "housing", "consumer confidence", "payroll",
        "trade balance", "industrial production",
    ],
    "market": [
        "rally", "selloff", "bull", "bear", "correction", "volatility",
        "all-time high", "crash", "margin call", "short squeeze",
        "ipo", "buyback", "merger", "acquisition",
    ],
    "crypto": [
        "bitcoin", "crypto", "blockchain", "defi", "ethereum", "stablecoin",
        "nft", "web3", "mining", "halving", "sec crypto", "binance", "coinbase",
    ],
}


def classify(article):
    """对单篇文章进行分类，返回最匹配的类别"""
    text = (article.get("headline", "") + " " + article.get("summary", "")).lower()

    scores = {}
    for category, keywords in CATEGORY_KEYWORDS.items():
        score = sum(1 for kw in keywords if kw in text)
        if score > 0:
            scores[category] = score

    if not scores:
        return "other"

    return max(scores, key=scores.get)


def classify_batch(articles):
    """批量分类文章"""
    for article in articles:
        article["topic_category"] = classify(article)

    # 统计
    counts = {}
    for article in articles:
        cat = article["topic_category"]
        counts[cat] = counts.get(cat, 0) + 1

    logger.info("新闻分类: %s", counts)
    return articles, counts
