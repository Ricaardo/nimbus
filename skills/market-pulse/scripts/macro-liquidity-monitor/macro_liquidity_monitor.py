#!/usr/bin/env python3
"""
Macro Liquidity Monitor — 宏观流动性监控

8 组件加权评分系统，衡量金融系统整体流动性。
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
    fed_balance_sheet_calculator,
    net_liquidity_calculator,
    yield_curve_calculator,
    credit_spread_calculator,
    dollar_strength_calculator,
    overnight_rate_calculator,
    commodity_inflation_calculator,
    crypto_liquidity_calculator,
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
    parser = argparse.ArgumentParser(description="Macro Liquidity Monitor — 宏观流动性监控")
    parser.add_argument("--api-key", default=os.environ.get("FRED_API_KEY", ""),
                        help="FRED API Key")
    parser.add_argument("--output-dir", default=None, help="报告输出目录")
    parser.add_argument("--lookback-days", type=int, default=365, help="回溯天数")
    parser.add_argument("--lang", default="zh", choices=["zh", "en"])
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    from fred_client import FREDClient
    from finnhub_client import FinnhubClient
    fred = FREDClient(api_key=args.api_key)
    finnhub = FinnhubClient()  # 用于实时报价 fallback

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

    # 1. Fed Balance Sheet (FRED + Reserves + RRP)
    logger.info("计算 Fed 资产负债表...")
    components.append(fed_balance_sheet_calculator.calculate(fred, args.lookback_days))

    # 2. Net Liquidity (FRED + TGA 季节性)
    logger.info("计算净流动性...")
    components.append(net_liquidity_calculator.calculate(fred, args.lookback_days))

    # 3. Yield Curve (FRED)
    logger.info("计算收益率曲线...")
    components.append(yield_curve_calculator.calculate(fred, args.lookback_days))

    # 4. Credit Spreads (FRED)
    logger.info("计算信用条件...")
    components.append(credit_spread_calculator.calculate(fred, args.lookback_days))

    # 5. Dollar Strength (Finnhub → TwelveData → yfinance)
    logger.info("计算美元强弱...")
    components.append(dollar_strength_calculator.calculate(
        finnhub_client=finnhub, twelvedata_client=twelvedata))

    # 6. Overnight Rate (FRED)
    logger.info("计算隔夜利率...")
    components.append(overnight_rate_calculator.calculate(fred))

    # 7. Commodity/Oil Shock (Finnhub → TwelveData → yfinance 批量)
    logger.info("计算商品/油价冲击...")
    components.append(commodity_inflation_calculator.calculate(
        finnhub_client=finnhub, twelvedata_client=twelvedata))

    # 8. Crypto Risk Appetite (Finnhub → OKX → Binance → TwelveData → yfinance)
    logger.info("计算加密风险偏好...")
    components.append(crypto_liquidity_calculator.calculate(
        finnhub_client=finnhub, twelvedata_client=twelvedata))

    # Composite score
    composite = scorer.calculate_composite(components)

    # Output
    md = report_generator.generate_markdown(composite, lang=args.lang)
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
        paths = report_generator.save_reports(composite, args.output_dir)
        logger.info("报告已保存: %s", paths)

    stats = fred.get_api_stats()
    logger.info("FRED API 调用次数: %d", stats["call_count"])

    print("\n---JSON_START---")
    print(json.dumps(report_generator.generate_json(composite), ensure_ascii=False, indent=2))
    print("---JSON_END---")


if __name__ == "__main__":
    main()
