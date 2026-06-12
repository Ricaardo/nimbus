#!/usr/bin/env python3
"""
Fear & Greed Index — 多市场贪恐指数

四市场加权评分系统（美股/A股/港股/加密），衡量投资者情绪。
0 = 极度恐惧, 100 = 极度贪婪
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
    us_market_calculator,
    a_share_calculator,
    hk_market_calculator,
    crypto_calculator,
)
import scorer
import report_generator

logger = logging.getLogger(__name__)

MARKET_MAP = {
    "us": us_market_calculator,
    "a_share": a_share_calculator,
    "hk": hk_market_calculator,
    "crypto": crypto_calculator,
}


def _collect_search_hints(market_scores):
    """收集所有需要 Web Search 补全的指标"""
    hints = []
    for ms in market_scores:
        for c in ms.get("components", []):
            if not c.get("data_available") and c.get("search_hint"):
                hints.append({
                    "market": ms["market"],
                    "component": c["name"],
                    "hint": c["search_hint"],
                })
    return hints


def main():
    parser = argparse.ArgumentParser(description="Fear & Greed Index — 多市场贪恐指数")
    parser.add_argument("--market", default="all",
                        choices=["all", "us", "a_share", "hk", "crypto"],
                        help="目标市场 (默认: all)")
    parser.add_argument("--api-key", default=os.environ.get("FRED_API_KEY", ""),
                        help="FRED API Key (可选，增强美股 Put/Call)")
    parser.add_argument("--output-dir", default=None, help="报告输出目录")
    parser.add_argument("--lang", default="zh", choices=["zh", "en"])
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    # 初始化可选客户端
    fred_client = None
    if args.api_key:
        try:
            from fred_client import FREDClient
            fred_client = FREDClient(api_key=args.api_key)
            logger.info("FRED 客户端已启用")
        except Exception:
            pass

    finnhub_client = None
    try:
        from finnhub_client import FinnhubClient
        finnhub_client = FinnhubClient()
    except Exception:
        pass

    twelvedata_client = None
    try:
        from twelvedata_client import TwelveDataClient
        td = TwelveDataClient()
        if td._api_key:
            twelvedata_client = td
    except Exception:
        pass

    # 确定要计算的市场
    if args.market == "all":
        markets = ["us", "a_share", "hk", "crypto"]
    else:
        markets = [args.market]

    # 计算各市场
    market_results = []
    market_scores = []

    for market_key in markets:
        calc = MARKET_MAP[market_key]
        logger.info("计算 %s 贪恐指数...", market_key)

        if market_key == "us":
            result = calc.calculate(
                fred_client=fred_client,
                finnhub_client=finnhub_client,
                twelvedata_client=twelvedata_client,
            )
        else:
            result = calc.calculate()

        market_results.append(result)
        ms = scorer.calculate_market_score(result)
        market_scores.append(ms)

    # 全球合成评分
    global_result = scorer.calculate_global_score(market_scores)

    # 输出 Markdown 报告
    md = report_generator.generate_markdown(global_result, market_scores)
    print(md)

    # Web Search hints
    search_hints = _collect_search_hints(market_scores)
    if search_hints:
        print("\n---SEARCH_NEEDED---")
        for h in search_hints:
            print(f"market: {h['market']}")
            print(f"component: {h['component']}")
            print(f"search: {h['hint']}")
            print("---")

    # 保存报告
    if args.output_dir:
        paths = report_generator.save_reports(global_result, market_scores, args.output_dir)
        logger.info("报告已保存: %s", paths)

    # JSON 输出
    print("\n---JSON_START---")
    print(json.dumps(
        report_generator.generate_json(global_result, market_scores),
        ensure_ascii=False, indent=2,
    ))
    print("---JSON_END---")


if __name__ == "__main__":
    main()
