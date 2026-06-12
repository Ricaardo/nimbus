"""板块新闻收集器 — 按 watchlist ticker 获取公司新闻"""

import logging
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)


def collect(finnhub_client, watchlist, lookback_days=3):
    """获取 watchlist 中每个 ticker 的公司新闻"""
    results = {}
    to_date = datetime.now().strftime("%Y-%m-%d")
    from_date = (datetime.now() - timedelta(days=lookback_days)).strftime("%Y-%m-%d")

    for ticker in watchlist:
        ticker = ticker.strip().upper()
        try:
            articles = finnhub_client.get_company_news(ticker, from_date, to_date)
            if articles:
                results[ticker] = articles[:10]  # 每个 ticker 最多 10 篇
                logger.info("%s: %d 篇新闻", ticker, len(articles))
            else:
                results[ticker] = []
        except Exception as e:
            logger.warning("%s 新闻获取失败: %s", ticker, e)
            results[ticker] = []

    return results
