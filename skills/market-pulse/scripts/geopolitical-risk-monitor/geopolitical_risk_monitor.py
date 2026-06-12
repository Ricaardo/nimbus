#!/usr/bin/env python3
"""
Geopolitical Risk Monitor — 地缘政治风险监控

5 组件加权评分系统，结合新闻语义 + 避险资产 + 市场反应。
"""

import argparse
import json
import logging
import os
import sys

shared_dir = os.path.join(os.path.dirname(__file__), "..", "..", "shared")
if shared_dir not in sys.path:
    sys.path.insert(0, shared_dir)

from calculators import (
    news_signal_calculator,
    safe_haven_calculator,
    oil_disruption_calculator,
    volatility_credit_calculator,
    cross_asset_calculator,
)
import scorer
import report_generator

logger = logging.getLogger(__name__)


def _collect_search_hints(components):
    """收集所有需要 Web Search 补全的指标"""
    hints = []
    for c in components:
        if not c.get("data_available") and c.get("search_hint"):
            hints.append({
                "component": c["name"],
                "hint": c["search_hint"],
            })
    return hints


def main():
    parser = argparse.ArgumentParser(description="Geopolitical Risk Monitor — 地缘政治风险监控")
    parser.add_argument("--finnhub-key", default=os.environ.get("FINNHUB_API_KEY", ""))
    parser.add_argument("--fred-key", default=os.environ.get("FRED_API_KEY", ""))
    parser.add_argument("--output-dir", default=None)
    parser.add_argument("--lookback-days", type=int, default=7)
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
    fred = FREDClient(api_key=args.fred_key)

    # Twelve Data（可选，有 key 才启用）
    twelvedata = None
    try:
        from twelvedata_client import TwelveDataClient
        td = TwelveDataClient()
        if td._api_key:
            twelvedata = td
            logger.info("TwelveData 客户端已启用")
    except Exception:
        pass

    components = []
    top_articles = []

    # 1. News Signal (Finnhub)
    logger.info("分析新闻地缘信号...")
    news_result = news_signal_calculator.calculate(finnhub, args.lookback_days)
    components.append(news_result)
    top_articles = news_result.get("top_articles", [])

    # 2. Safe Haven Flows (Finnhub → TwelveData → yfinance + FRED)
    logger.info("分析避险资金流...")
    components.append(safe_haven_calculator.calculate(
        fred, finnhub_client=finnhub, twelvedata_client=twelvedata))

    # 3. Oil Disruption (Finnhub → TwelveData → yfinance)
    logger.info("分析石油供应中断...")
    components.append(oil_disruption_calculator.calculate(
        finnhub_client=finnhub, twelvedata_client=twelvedata))

    # 4. Volatility & Credit (Finnhub → TwelveData → yfinance + FRED)
    logger.info("分析波动率 & 信用...")
    components.append(volatility_credit_calculator.calculate(
        fred, finnhub_client=finnhub, twelvedata_client=twelvedata))

    # 5. Cross-Asset (Finnhub → TwelveData → yfinance)
    logger.info("分析跨资产确认...")
    components.append(cross_asset_calculator.calculate(
        finnhub_client=finnhub, twelvedata_client=twelvedata))

    # Composite
    composite = scorer.calculate_composite(components)

    # Output
    md = report_generator.generate_markdown(composite, top_articles, lang=args.lang)
    print(md)

    # Web Search hints
    search_hints = _collect_search_hints(components)
    if search_hints:
        print("\n---SEARCH_NEEDED---")
        for h in search_hints:
            print(f"component: {h['component']}")
            print(f"search: {h['hint']}")
            print("---")

    if args.output_dir:
        paths = report_generator.save_reports(composite, top_articles, args.output_dir)
        logger.info("报告已保存: %s", paths)

    print("\n---JSON_START---")
    print(json.dumps(report_generator.generate_json(composite, top_articles), ensure_ascii=False, indent=2))
    print("---JSON_END---")


if __name__ == "__main__":
    main()
