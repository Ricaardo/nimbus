---
name: us-stock-analysis
description: "个股/资产综合分析（数据驱动入口）。整合基本面 + 技术面 + 行情 + 同行对比 + 分析师评级，输出标准投资分析报告。用法：用户给定 ticker 或 'compare X vs Y'，且**不**指定大师视角时使用。当用户请求 'analyze AAPL'、'compare TSLA vs NVDA'、'评估这只股票'、'AAPL 怎么样'、'看一下 NVDA'、'NVDA 分析师评级/华尔街怎么看/评级共识/多少家买入' 时触发。支持美股/A股/港股/加密/贵金属/外汇。NOT for: (1) 价值派大师 → value-perspective；(2) 宏观派大师 → macro-perspective；(3) 仅查价格 → market-data；(4) 仅算估值 → valuation；(5) 仅看技术指标 → technical-analysis；(6) 选股/找新标的 → research（Ideas）；(7) 新闻推演 → research（Scenarios）。"
required_tools: ["yfinance", "futuapi", "tavily", "alpaca", "context7"]
---

> 行情数据源 / 中文输出规范 见 [`../references/shared-output-rules.md`](../references/shared-output-rules.md)
> 详细工作流 / 多资产数据源代码 / 报告模板 / 对比格式 见 [`references/analysis-workflow.md`](references/analysis-workflow.md)

# US Stock Analysis — 决策协议

不是"分析股票的步骤"，是**先识别请求类型 → 再决定深度 → 必跑 Delta 检查**。

---

## 🎯 第一步：识别请求类型

| 用户语境 | 类型 | 深度 |
|---|---|---|
| "AAPL 什么价 / quick" | **Basic Info** | 表格 + 5 metric |
| "分析 NVDA 财务 / 估值合理吗" | **Fundamental** | 跑基本面流程 |
| "AAPL 技术面 / 超卖了吗" | **Technical** | 跑技术分析流程 |
| "应该买 X 吗 / 完整研报 / 详细分析" | **Comprehensive** | 全套 + bull/bear + 评级 |
| "compare X vs Y" | **Comparison** | 侧侧对比 + 推荐 |

详细执行步骤 → [`references/analysis-workflow.md`](references/analysis-workflow.md)

---

## 🚪 第二步：必查 — Delta Since Last

**任何 re-analyze（"再看一下 AAPL" / "update on NVDA"）都必须先检查 reports/ 里的旧报告**。

### Step A：找上次报告

```
reports/AAPL_analysis_YYYYMMDD.md
reports/AAPL_comprehensive_YYYYMMDD.md
```

| 距今 | 处理 |
|---|---|
| < 30 天 | **Quick delta only** — 价格 + 新闻 + 关键 metric |
| 30-90 天 | **Standard delta + 部分基本面 re-run** |
| > 90 天 | **Full re-analysis**，但 delta 作为开场节 |
| 无上次报告 | 标准 full analysis |

### Step B：算 Delta（输出强制以这一节开头）

```markdown
## 🔄 What Changed — [TICKER] since [上次日期]

### Price & Valuation
| Metric | 上次 | 现在 | Δ |
|---|---|---|---|
| Price | $245 (2026-03-15) | $260 | +6.1% |
| P/E (FWD) | 28× | 30× | +2× |
| FCF Yield | 3.5% | 3.1% | -0.4pp |

### Financials（如有新季报）
| Metric | 上次 Q | 这次 Q | Δ |
| Revenue | $89B | $94B | +5.6% |
| Gross Margin | 45.2% | 46.1% | +0.9pp ✅ |

### Technical
| Indicator | 上次 | 现在 | Δ |
| RSI (14) | 52 | 62 | +10 |
| vs 200MA | -2% | +7% | ✅ 已穿 200MA |

### Thesis Pillars（若 thesis-tracker 有记录）
| Pillar | 上次 | 现在 | Trend |
| P1 服务收入 | on_track | on_track | → |
| P2 AI 换机 | watch | ahead | ↑ |
```

### Step C：Top 2-3 关键变化

```markdown
### 🔑 关键变化
1. **突破 200MA**（-2% → +7%）→ 反弹变趋势
2. **Margin +0.9pp**（超预期，Pillar 1 加强）
3. **估值更贵**（PE 28→30×）→ 安全边际缩小
```

### Step D：评级更新

```markdown
### 📈 Recommendation Update
上次 (2026-03-15): **Buy @ $245**
现在: **Hold @ $260** — thesis 更强但估值更紧
- ✅ 已有持仓 → 持有，止损 $235
- 🟡 无持仓 → 等回调 PE < 29×
- 🚫 不追（PE > 30× = fair value）
```

**评级共识数据源**：在 full analysis 中，拉分析师评级共识作为标准一节：
```bash
python3 ~/.claude/skills/us-stock-analysis/scripts/analyst.py AAPL
```
输出：看多/中性/看空家数分布 + 看多占比 + 近 4 月环比趋势 + 方向判断。
在报告中输出 `### 📊 分析师共识` + 看多占比环比的趋势箭头。
注意：不含目标价（Finnhub 付费）；评级是滞后指标，趋势变化比绝对值更有信息量。

### Step E：保存为新文件

```
reports/AAPL_analysis_20260430.md

Header: Previous: AAPL_analysis_20260315.md
```

---

## 🌐 多资产覆盖

| 市场 | Ticker 格式 | 数据源 |
|---|---|---|
| 美股 | AAPL / NVDA | futu → yfinance → WebSearch |
| A 股 | 600519.SH / 000858.SZ | futu → AKShare |
| 港股 | 00700.HK / 09988.HK | futu → AKShare |
| 加密 | BTC / ETH | CoinMarketCap 官方 MCP (`cmc-mcp`) 免费/基础行情 → yfinance fallback；BTC 周期/估值切 `btc-guanfu` |
| 贵金属 | GC=F / SI=F | yfinance |
| 原油 | CL=F | yfinance |

代码片段 → [`references/analysis-workflow.md`](references/analysis-workflow.md) §三

---

## 🔗 与其他 skill 的联动

| 触发 | 联动 skill | 做什么 |
|---|---|---|
| 用户要 DCF / WACC | `valuation` | 切到估值专用 |
| 用户要 Buffett/Lynch 视角 | `value-perspective` | 切到大师协议 |
| 用户要 Soros/Dalio 视角 | `macro-perspective` | 切到宏观派 |
| 用户问"现在该买吗" | `trade-execution` | 加 5 道闸检查 |
| 写完报告 | `thesis-tracker` | 落 thesis + kill criteria |
| 个股属于宏观/板块叙事 | `sector-analyst` | 上下文补齐 |
| 财报临近 | `event-calendar` | 加 IV / 共识表 |

---

## ⚠ 反模式

- ❌ Re-analyze 不查旧报告 → 用户每次重读全文
- ❌ Comprehensive 没 bull + bear → 单边推销
- ❌ 推荐没 target + timeframe + conviction → 鸡汤
- ❌ 技术分析单一指标 → 假信号
- ❌ Comparison 不量化"哪里强" → 主观比较
- ❌ Delta 算了但不更新 recommendation → 无意义

---

## 📂 References

- [`analysis-workflow.md`](references/analysis-workflow.md) — 4 类分析详细流程 + 多资产代码 + 输出 guideline + example queries
- [`fundamental-analysis.md`](references/fundamental-analysis.md) — 业务/财务/估值/风险框架
- [`technical-analysis.md`](references/technical-analysis.md) — 指标/形态定义
- [`financial-metrics.md`](references/financial-metrics.md) — Ratio 公式与定义
- [`report-template.md`](references/report-template.md) — 完整报告 + 对比报告模板
