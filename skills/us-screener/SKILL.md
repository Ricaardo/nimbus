---
name: us-screener
description: 美股 价值/成长选股筛选器（equity-screener 项目的 US 接口）。多因子打分（基本面/估值/技术/动量/热度/宏观）+ SEC companyfacts 财务 + stooq 历史 + forward PE + 概念板块/主题热度 + squeeze watch + 财报临近。当用户要「美股选股/US 选股/找美股价值股成长股/今日美股候选/expert-score 美股/美股核心池/美股盘前扫描」时触发。数仓在 ~/nimbus-os/equity-screener（DuckDB us_screener.duckdb，自带 venv/CLI/launchd，每日盘前自动跑）。NOT for：A股/港股选股 → ah-screener；简单实时硬条件筛 → futu `get_stock_filter`；个股深度分析 → us-stock-analysis；新闻推演 → research(Scenarios)。
---

# us-screener — 美股 价值/成长筛选器（equity-screener 项目的 US 接口）

成熟的美股自建筛选器：DuckDB(`us_screener.duckdb`) + 数据源(SEC companyfacts/stooq/FRED/Nasdaq)，
多因子模型 + 概念板块/主题热度 + squeeze watch + forward PE。**数仓在 `~/nimbus-os/equity-screener`**，
本 skill 是它的 US 可调用接口。每日盘前 launchd 自动跑出报告。A/H 见 `ah-screener`。

## 看候选（轻、安全、读已生成报告）

```bash
python3 skills/us-screener/scripts/screener_us.py candidates --top 8
python3 .../screener_us.py candidates --decision core_candidate   # 仅核心池
python3 .../screener_us.py status                                 # 项目/报告新鲜度
python3 .../screener_us.py report-path                            # 最新 US 报告 JSON 路径
```

候选含评分拆解（fundamental/technical/valuation/heat/macro 分量）/概念板块/squeeze/财报临近的
完整 JSON 在 `report-path` 指向的文件里，需深读时打开它。

## 🔗 价值一条龙（futu 粗筛 → us 深算，缝合两层）

`scripts/value_pipeline.py`：futu `get_stock_filter --market US --preset value`(实时)出价值
幸存者 → 在 us 已算好的 DB 查这些票的深度 expert_score/decision → 取交集排序。

```bash
python3 skills/us-screener/scripts/value_pipeline.py --market US --limit 40
python3 .../value_pipeline.py --market US --min-roe 12 --max-pe 15
```
输出标记：🟢核心 / 🟡观察 / 🔴剔除 / ·未覆盖。需 futu OpenD(粗筛) + us 已跑(深算)。

## 触发/刷新（最重，一般靠 launchd 盘前自动，不手动）

```bash
cd ~/nimbus-os/equity-screener && .venv/bin/python -m us_screener.cli update --json   # 增量+评分+报告
```
首次全量本地化用 `us_screener.cli backfill`；离线批量灌库用 `load-stooq` / `load-sec-facts`。
可选 MCP server：`us_screener.cli mcp`。

## 分层用法（重要）

- **简单硬条件筛**（PE<15、ROE>15%）→ 用 **futu `get_stock_filter --market US`**，别动这个重模型。
- **深度多因子打分 + 主题热度 + squeeze** → 用本 skill。
- 候选出来后深析单只 → `us-stock-analysis`；估值 → `valuation`。
- **A股/港股选股** → `ah-screener`。

## 被谁消费

投顾日报/机会引擎可经本 skill 读美股候选。库接口：`from screener_us import
latest_report_path, load_report, top_candidates`。

> 只读为主；重跑命令会动 DB。AI 不下单。
