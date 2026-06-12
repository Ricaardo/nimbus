"""央行新闻过滤器 — 从已收集新闻中筛选央行相关"""

import logging

logger = logging.getLogger(__name__)

FED_KEYWORDS = [
    "federal reserve", "fed ", "fomc", "powell", "waller", "bowman",
    "ecb", "lagarde", "european central bank",
    "boj", "bank of japan", "ueda",
    "pboc", "people's bank", "china central bank",
    "bank of england", "boe", "bailey",
    "rate cut", "rate hike", "monetary policy", "quantitative",
    "tightening", "easing", "hawkish", "dovish",
    "interest rate decision", "rate decision",
]


def collect(all_news):
    """从已收集的新闻中筛选央行相关文章"""
    fed_articles = []

    for article in all_news:
        text = (article.get("headline", "") + " " + article.get("summary", "")).lower()
        matched_keywords = [kw for kw in FED_KEYWORDS if kw in text]
        if matched_keywords:
            article["fed_keywords"] = matched_keywords
            fed_articles.append(article)

    logger.info("央行相关新闻: %d/%d 篇", len(fed_articles), len(all_news))
    return fed_articles
