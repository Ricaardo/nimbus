# Skill 所有权矩阵 — 防双计 / 取数收口 / 路由收敛

> 目的：50+ skill 有功能重叠。本文档钉死**每类能力的唯一所有者 + 边界规则**，
> 让 AI 不重复调用、不双重计数、取数统一走 facade。
> 配合 CLAUDE.md「牛熊分析主责分工」表使用，本文覆盖全部重叠簇。
> 读者：主会话 AI（路由决策前查）+ 未来 session。

---

## 〇、外部项目接入（每个项目做成一个 skill）

**约定：投顾依赖的每个独立项目，自己做成一个 skill。** 项目本体留在原处
（如 `~/nimbus-os/equity-screener`，自带 venv/CLI/launchd），在 `skills/<项目名>/` 建
SKILL.md + 薄封装脚本，把它暴露成可发现、可触发的能力。**禁止在消费脚本里硬编码项目路径**
——路径只出现在该项目 skill 的封装脚本里（唯一接口点）。

| 操作 | 怎么做 |
|---|---|
| **新增项目** | 建 `skills/<名>/SKILL.md` + `scripts/<名>.py`(封装项目 CLI/产物) |
| **删除项目** | 删项目目录 → 封装 `latest_report_path()` 等返回 None → 消费方**自动降级不崩** |
| **消费** | 消费方 import 该 skill 封装的库函数（如 `screener.load_report()`），不直连项目 |

当前外部项目 skill：**`ah-screener`**（封装 `screener.py`，idea_feed 经
`screener.load_report()` 消费）。macro_feed 直连 FRED API、无外部项目依赖。
（旧 `project-registry` skill 已弃用 → skillOverrides off，可手动删）

## 一、取数收口（数据访问唯一入口）

| 需要 | 唯一入口 | 后端 | 上层不要做 |
|---|---|---|---|
| 实时报价/K线/指数摘要 | **market-data** | futuapi / yfinance | technical-analysis / us-stock-analysis 不各自拉价，调 market-data |
| 期权链/Greeks | **market-data**(options) | futuapi | options-strategy-advisor 取链走 market-data，自己只做策略/P&L |
| 交易执行/持仓/成交 | **futuapi**(写) + MCP(IBKR) | — | 仅 futuapi/MCP 触交易；**AI 不下单**(trade-guard deny) |
| 真实持仓画像/成本/占比 | **L1 portfolio_state.json** | portfolio_state.py | 任何 skill 要"我的持仓"先读 state，不重拉(见 references/state/README.md) |
| 加密基础行情 | **cmc-mcp**(免费) | — | btc-guanfu 只做周期/估值，不做现货报价 |

**规则**：futuapi/yfinance/cmc 是**后端 tool**；market-data 是**只读行情 facade**；
portfolio_state 是**持仓真相**。上层分析 skill 调 facade，不直连后端重复实现取数。

---

## 二、市场状态/宏观（最易双计区）

| 能力 | 唯一所有者 | 边界 |
|---|---|---|
| 定量市场温度 MHS 0-100 → 仓位% | **market-pulse** | 独占定量评分 |
| 定性牛熊 regime（7 维叙事） | **research**(Regime) | 独占定性；引用 MHS 作锚，不重算 |
| BTC 8 域盘面 | **btc-guanfu** | 宏观域**引用** market-pulse MHS，不自行算美股宏观 |
| 大师宏观视角(Soros/Dalio…) | **macro-perspective** | 仅"用 X 视角"显式触发；不是默认市场入口 |
| 板块轮动 | **sector-analyst** | 板块层；个股切 us-stock-analysis |

**防双计**：宏观/流动性/跨资产信号在 market-pulse(定量)、research-Regime(定性)、
btc-guanfu(BTC域) 高度重叠 → **同一信号只计一次**：定量归 pulse、定性归 research、
BTC 专属归 guanfu。读盘时若三者都提"流动性收紧"，是同一事实，不叠加权重。

---

## 三、选股/找标的（入口收敛）

| 方法 | 所有者 | 何时用 |
|---|---|---|
| 量化筛选(趋势/股息/PEAD/配对/A股/ETF) | **stock-screener**(6模式) | 有明确量化条件 |
| 主题/叙事研究("AI 基建有哪些股") | **research**(Systematic) | 主题驱动、需推演 |
| 13F 机构/聪明钱筛 | **institutional-flow-tracker** | 跟机构持仓变动找标的 |
| 打新(港股为主) | **ipo-subscription-analyzer** | IPO 申购 |

**路由**：量化条件→screener；主题→research；机构跟踪→institutional-flow；打新→ipo。
**注**：institutional-flow-tracker 概念上是 screener 的一种方法，但代码重(389行+scripts)，
保留独立。若想精简上下文，可在 settings `skillOverrides` 设 `name-only`（可逆，不删）。

---

## 四、个股分析（编排 vs 原子）

| 层 | 所有者 | 规则 |
|---|---|---|
| 综合个股报告(基本面+技术+行情+同行) | **us-stock-analysis** | 编排层：**调** valuation/technical-analysis/market-data，不重写 |
| 估值(DCF/三表/贵金属) | **valuation** | 原子 |
| 技术指标/图像 | **technical-analysis** | 原子 |
| 价值派大师视角 | **value-perspective** | 仅显式"用 Buffett/Lynch…"触发 |

**防重**：us-stock-analysis 出报告时不自己实现 DCF/RSI，路由到 valuation/technical-analysis。

---

## 五、新闻/事件/推演

| 能力 | 所有者 | 边界 |
|---|---|---|
| 新闻情报流(market/stock/raw/A股) | **news-dashboard** | 情报，不推演 |
| 财报+催化+经济日历 | **event-calendar** | 独占"日历"(CPI/FOMC/财报日) |
| 新闻→一/二/三次影响 18 月推演 | **research**(Scenarios) | 独占"推演" |
| 宏观事件打分 | **market-pulse** | event-calendar 给日期、pulse 给影响评分，不重复 |

---

## 六、交易/组合/复盘（流水线，非重叠）

```
research(找) → valuation/us-stock(评) → trade-execution(仓位/止损/5闸)
→ [下单：本人手动，AI deny] → trade-journal(log+复盘) → thesis-tracker(论点追踪)
→ portfolio-manager(鸟瞰+再平衡) ↔ L1 portfolio_state(真相底座)
→ behavior_monitor(行为体检) → briefing(日报编排)
```
- **trade-execution** vs **portfolio-manager**：execution 管单笔开仓风控；portfolio 管组合鸟瞰。
  集中度/风险指标以 **L1 state 对账**为准，二者都读 state 不各自算。

---

## 七、反模式（CLAUDE.md 强化）

- ❌ 并行调 ≥3 个功能重叠 skill（如 pulse+research+macro 同问"市场怎样"）
- ❌ 同一宏观信号在多 skill 重复计权重
- ❌ 分析 skill 绕过 market-data 直接拉价 / 绕过 L1 重拉持仓
- ❌ us-stock-analysis 重写 DCF/技术指标而非路由
- ❌ AI 触发任何下单（trade-guard deny，只给参数本人手动）

---

## 实际精简动作（已评估）

| 候选 | 裁决 | 理由 |
|---|---|---|
| institutional-flow-tracker → stock-screener | **不物理合并** | 389行+scripts，迁移风险>收益；用本矩阵定边界即可。可选 skillOverrides=name-only 降上下文 |
| value+macro-perspective → investor-lenses | **暂不** | 分得清，合并边际收益小 |
| market-data 成行情 facade | **约定收口** | 见 §一，文档约定优于代码大改 |

**结论**：本系统问题 90% 不是"skill 太多"，是缺取数/状态底座 + 边界。
L1 状态层(已建) + 本矩阵 = 收口与定边界的主要抓手；物理删 skill 收益小、风险高，不做。
