#!/usr/bin/env python3
"""
Fed Data Tracker — 美联储数据仪表盘

一次调用展示利率/资产负债表/TGA&RRP/通胀/就业/美元全景数据。
"""

import argparse
import json
import logging
import os
import sys

# 共享模块路径
shared_dir = os.path.join(os.path.dirname(__file__), "..", "..", "shared")
if shared_dir not in sys.path:
    sys.path.insert(0, shared_dir)

from sections import rates_section, balance_sheet_section, reserves_section
from sections import inflation_section, employment_section, dollar_section
import report_generator

logger = logging.getLogger(__name__)

SECTION_MAP = {
    "rates": ("利率", rates_section),
    "balance_sheet": ("资产负债表", balance_sheet_section),
    "reserves": ("TGA & RRP", reserves_section),
    "inflation": ("通胀", inflation_section),
    "employment": ("就业", employment_section),
    "dollar": ("美元", dollar_section),
}


def main():
    parser = argparse.ArgumentParser(description="Fed Data Tracker — 美联储数据仪表盘")
    parser.add_argument("--api-key", default=os.environ.get("FRED_API_KEY", ""),
                        help="FRED API Key")
    parser.add_argument("--output-dir", default=None, help="报告输出目录")
    parser.add_argument("--sections", default="all",
                        help="要分析的板块，逗号分隔或 all")
    parser.add_argument("--lang", default="zh", choices=["zh", "en"], help="输出语言")
    parser.add_argument("--verbose", action="store_true", help="详细日志")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    # 初始化 FRED 客户端
    from fred_client import FREDClient
    fred = FREDClient(api_key=args.api_key)

    # 确定要分析的板块
    if args.sections == "all":
        sections = list(SECTION_MAP.keys())
    else:
        sections = [s.strip() for s in args.sections.split(",")]

    results = {}
    for section_key in sections:
        if section_key not in SECTION_MAP:
            logger.warning("未知板块: %s，跳过", section_key)
            continue
        name, module = SECTION_MAP[section_key]
        logger.info("分析板块: %s ...", name)
        try:
            results[section_key] = module.analyze(fred)
        except Exception as e:
            logger.error("板块 %s 分析失败: %s", name, e)
            results[section_key] = {"data_available": False, "error": str(e)}

    # 生成报告
    md = report_generator.generate_markdown(results, lang=args.lang)
    print(md)

    # 保存文件
    if args.output_dir:
        paths = report_generator.save_reports(results, args.output_dir)
        logger.info("报告已保存: %s", paths)

    # 输出 API 统计
    stats = fred.get_api_stats()
    logger.info("FRED API 调用次数: %d", stats["call_count"])

    # 输出 JSON 到 stdout（供 Claude 解析）
    print("\n---JSON_START---")
    print(json.dumps(report_generator.generate_json(results), ensure_ascii=False, indent=2))
    print("---JSON_END---")


if __name__ == "__main__":
    main()
