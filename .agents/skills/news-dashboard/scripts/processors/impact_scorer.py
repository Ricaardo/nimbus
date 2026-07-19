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
    """SPY 近期日收益率 — 经 data-access facade(Tier-1，warehouse 缺 ETF 时回退
    market-data futu K线），Tier-2 不直连数据源。返回 {YYYY-MM-DD: 涨跌%}。"""
    try:
        import sys
        from datetime import date, timedelta
        sys.path.insert(0, "/Users/x/nimbus-os/services/data-access")
        import data_access as data  # noqa: PLC0415
        bars = data.history("US:SPY", from_=(date.today() - timedelta(days=12)).isoformat())
        if bars and len(bars) >= 2:
            bars = sorted(bars, key=lambda b: b.get("trade_date", ""))
            returns = {}
            for i in range(1, len(bars)):
                prev, cur = bars[i - 1].get("close"), bars[i].get("close")
                if prev and cur:
                    returns[bars[i]["trade_date"]] = round((float(cur) / float(prev) - 1) * 100, 2)
            return returns
    except Exception as e:  # noqa: BLE001
        logger.debug("SPY 收益率获取失败: %s", e)
    return {}
