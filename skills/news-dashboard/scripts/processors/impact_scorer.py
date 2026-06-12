"""影响力评分器 — 结合 SPY 日收益率评估新闻影响力"""

import logging

logger = logging.getLogger(__name__)

# 高影响力来源权重
HIGH_IMPACT_SOURCES = {
    "reuters", "bloomberg", "cnbc", "wall street journal", "wsj",
    "financial times", "ft", "associated press", "ap",
}

HIGH_IMPACT_KEYWORDS = [
    "breaking", "urgent", "emergency", "crash", "surge", "plunge",
    "record", "historic", "crisis", "war", "invasion", "default",
    "rate cut", "rate hike", "recession", "collapse",
]


def score(articles):
    """为文章列表评估影响力分数 (high/medium/low)"""
    # 尝试获取 SPY 近期日收益率
    spy_returns = _get_spy_returns()

    for article in articles:
        headline = article.get("headline", "").lower()
        source = article.get("source", "").lower()
        timestamp = article.get("timestamp")

        # 基础分
        base_score = 0

        # 来源权重
        if any(s in source for s in HIGH_IMPACT_SOURCES):
            base_score += 2

        # 关键词权重
        keyword_hits = sum(1 for kw in HIGH_IMPACT_KEYWORDS if kw in headline)
        base_score += min(keyword_hits * 1.5, 4)

        # SPY 收益率关联（如果有数据）
        if spy_returns and timestamp:
            date_key = article.get("datetime", "")[:10]
            spy_move = spy_returns.get(date_key)
            if spy_move is not None and abs(spy_move) > 1.0:
                base_score += 2  # 当天 SPY 大幅波动

        # 分级
        if base_score >= 4:
            article["impact"] = "high"
            article["impact_score"] = min(round(base_score, 1), 10)
        elif base_score >= 2:
            article["impact"] = "medium"
            article["impact_score"] = round(base_score, 1)
        else:
            article["impact"] = "low"
            article["impact_score"] = round(base_score, 1)

    # 按影响力排序
    articles.sort(key=lambda x: x.get("impact_score", 0), reverse=True)
    return articles


def _get_spy_returns():
    """获取 SPY 近期日收益率"""
    try:
        import yfinance as yf
        df = yf.download("SPY", period="5d", progress=False)
        if df is not None and len(df) >= 2:
            returns = {}
            close = df["Close"].values.flatten()
            dates = df.index
            for i in range(1, len(close)):
                ret = (float(close[i]) / float(close[i - 1]) - 1) * 100
                returns[dates[i].strftime("%Y-%m-%d")] = round(ret, 2)
            return returns
    except Exception as e:
        logger.debug("SPY 收益率获取失败: %s", e)
    return {}
