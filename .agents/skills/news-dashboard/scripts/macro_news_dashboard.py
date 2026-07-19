#!/usr/bin/env python3
"""
Macro News Dashboard — 宏观新闻仪表盘

系统化新闻聚合 + 分类 + 聚类 + 影响力评分 + 经济日历
"""

import argparse
import json
import logging
import os
import sys

shared_dir = os.path.join(os.path.dirname(__file__), "..", "shared")
if shared_dir not in sys.path:
    sys.path.insert(0, shared_dir)

from collectors import market_news_collector, sector_news_collector
from collectors import calendar_collector, fed_news_collector
from processors import news_classifier, news_clusterer, impact_scorer
import report_generator

logger = logging.getLogger(__name__)

DEFAULT_WATCHLIST = ["SPY", "QQQ", "AAPL", "NVDA", "JPM", "XLE"]


def main():
    parser = argparse.ArgumentParser(description="Macro News Dashboard — 宏观新闻仪表盘")
    parser.add_argument("--finnhub-key", default=os.environ.get("FINNHUB_API_KEY", ""),
                        help="Finnhub API Key")
    parser.add_argument("--output-dir", default=None)
    parser.add_argument("--lookback-days", type=int, default=3)
    parser.add_argument("--calendar-days", type=int, default=14)
    parser.add_argument("--watchlist", default=",".join(DEFAULT_WATCHLIST),
                        help="逗号分隔的 ticker 列表")
    parser.add_argument("--lang", default="zh", choices=["zh", "en"])
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    from finnhub_client import FinnhubClient
    from fred_client import FREDClient
    finnhub = FinnhubClient(api_key=args.finnhub_key)
    fred = FREDClient()

    watchlist = [t.strip() for t in args.watchlist.split(",") if t.strip()]

    # Step 1: Collect
    logger.info("收集市场新闻...")
    all_news = market_news_collector.collect(finnhub)

    logger.info("收集板块新闻...")
    sector_news = sector_news_collector.collect(finnhub, watchlist, args.lookback_days)

    logger.info("收集经济日历...")
    calendar = calendar_collector.collect(finnhub, args.calendar_days, fred_client=fred)

    # Step 2: Process
    logger.info("分类新闻...")
    classified_news, category_counts = news_classifier.classify_batch(all_news)

    logger.info("过滤央行新闻...")
    fed_news = fed_news_collector.collect(all_news)

    logger.info("评估影响力...")
    scored_news = impact_scorer.score(classified_news)

    logger.info("聚类话题...")
    clusters = news_clusterer.cluster(scored_news)

    # Step 3: Report
    data = {
        "clusters": clusters,
        "fed_news": fed_news,
        "calendar": calendar,
        "sector_news": sector_news,
        "category_counts": category_counts,
        "total_articles": len(all_news),
    }

    md = report_generator.generate_markdown(data, lang=args.lang)
    print(md)

    if args.output_dir:
        paths = report_generator.save_reports(data, args.output_dir)
        logger.info("报告已保存: %s", paths)

    stats = finnhub.get_api_stats()
    logger.info("Finnhub API 调用次数: %d", stats["call_count"])

    print("\n---JSON_START---")
    print(json.dumps(report_generator.generate_json(data), ensure_ascii=False, indent=2))
    print("---JSON_END---")


if __name__ == "__main__":
    main()
