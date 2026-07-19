---
name: ah-screener
description: A股/港股 价值选股筛选器（equity-screener 项目的 A/H 接口）。自定义多因子打分（基本面/估值/技术/中外投资大师框架）+ value_ratehike 抗加息价值 profile + 板块相对估值分位 + 幸存者偏差回测验证 + A/H 同主体去重。当用户要「A股选股/港股选股/A股H股价值股/抗加息标的/沪深港通筛选/今日A股H股候选/expert-score」时触发。数仓在 ~/nimbus-os/equity-screener（DuckDB ah_screener.duckdb，自带 venv/CLI/launchd，每日自动跑）。NOT for：美股选股 → us-screener；简单实时硬条件筛(PE/PB/ROE/股息) → futu `get_stock_filter` 更轻；个股深度分析 → us-stock-analysis；新闻推演 → research(Scenarios)。
---

# ah-screener — A股/港股 价值筛选器（equity-screener 项目的 A/H 接口）

成熟的 A/H 自建筛选器：DuckDB(`ah_screener.duckdb`) + 数据源(AKShare/Longbridge/FRED)，
自定义多因子模型 + 大师框架 + 回测验证。**数仓在 `~/nimbus-os/equity-screener`**，
本 skill 是它的 A/H 可调用接口。每日 launchd 自动跑出报告。美股见 `us-screener`。

## 看候选（轻、安全、读已生成报告）

```bash
python3 skills/ah-screener/scripts/screener.py candidates --top 8
python3 .../screener.py candidates --decision core_candidate    # 仅核心池
python3 .../screener.py status                                  # 项目/报告新鲜度
python3 .../screener.py report-path                             # 最新报告 JSON 路径
```

候选含评分拆解/证据链的完整 JSON 在 `report-path` 指向的文件里，需深读时打开它。

## 🔗 价值一条龙（futu 粗筛 → ah 深算，缝合两层）

`scripts/value_pipeline.py`：futu `get_stock_filter --preset value`(实时、零存储)出价值
幸存者(几十只) → 在 ah 已算好的 DB(每日全市场)查这些票的深度 expert_score/decision →
取交集排序。**不重跑 ah 管线(轻)**。两层都点头 = 估值便宜 + 多因子/大师模型也认。

```bash
python3 skills/ah-screener/scripts/value_pipeline.py --market HK --limit 40
python3 .../value_pipeline.py --market HK --min-roe 12 --max-pe 15   # 自定义粗筛
```
输出标记：🟢核心 / 🟡观察 / 🔴剔除（futu便宜但深度模型不认=分歧信号）/ ·未覆盖。
需 futu OpenD(粗筛) + ah 已跑(深算)。HK 价值筛需开市时段。

## value_ratehike 抗加息价值 profile

长期价值 + 加息姿态的可选 profile（抬基本面/价值大师、压技术/动量；见
`~/nimbus-os/equity-screener/docs/value-ratehike-profile.md`）。**评分在管线阶段算**，故要让候选
反映该 profile，需带 env 重跑评分（⚠ 重，且覆盖默认分，谨慎；理想用独立 DB）：

```bash
cd ~/nimbus-os/equity-screener
AH_PROFILE=value_ratehike .venv/bin/python -m ah_screener.cli expert-score   # 重打分(覆盖默认)
AH_PROFILE=value_ratehike .venv/bin/python -m ah_screener.cli report --output-dir /tmp/vrh
```
⚠ 未经样本外验证 → 视为先验非 edge。

## 触发/刷新全量（最重，一般靠 launchd 自动，不手动）

```bash
cd ~/nimbus-os/equity-screener && .venv/bin/python -m ah_screener.cli update-all   # 同步+评分+报告
```

## 分层用法（重要）

- **简单硬条件筛**（PE<15、ROE>15%、股息>3%）→ 用 **futu `get_stock_filter`**，别动这个重模型。
- **深度价值/抗加息打分 + 回测** → 用本 skill（futu 做不到自定义多因子+回测）。
- 候选出来后深析单只 → `us-stock-analysis`；估值 → `valuation`。
- **美股选股** → `us-screener`。

## 被谁消费

投顾日报 `idea_feed.py` 经本 skill 的 `screener.latest_report_path()` 读候选（已降级安全：
项目缺失/未跑 → 日报"选股 idea"节优雅留白）。库接口：`from screener import
latest_report_path, load_report, top_candidates`。

> 只读为主；重跑命令会动 DB。AI 不下单。
