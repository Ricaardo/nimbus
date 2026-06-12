"""市场新闻收集器 — Finnhub general/forex/crypto/merger"""

import logging

logger = logging.getLogger(__name__)

DEFAULT_CATEGORIES = ["general", "forex", "crypto", "merger"]


def collect(finnhub_client, categories=None):
    """收集多类别市场新闻，去重后返回统一列表"""
    if categories is None:
        categories = DEFAULT_CATEGORIES

    all_articles = []
    seen_headlines = set()

    for cat in categories:
        try:
            articles = finnhub_client.get_market_news(category=cat)
            for article in articles:
                headline = article.get("headline", "").strip()
                if not headline:
                    continue
                # 简单去重：标题前 60 字符
                key = headline[:60].lower()
                if key in seen_headlines:
                    continue
                seen_headlines.add(key)
                article["news_category"] = cat
                all_articles.append(article)
        except Exception as e:
            logger.warning("获取 %s 新闻失败: %s", cat, e)

    logger.info("收集到 %d 篇市场新闻（%s）", len(all_articles), ", ".join(categories))
    return all_articles
