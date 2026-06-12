---
name: event-calendar
description: 事件日历/财报/催化合并（earnings-calendar + catalyst-calendar + earnings-analysis）。3 种模式：(1) 财报日历 — FMP API 拉未来财报、EPS/Rev 预期、本周/本月预览；(2) 财报分析 — 财报前预览（共识/隐含波动/检查清单）和财报后打分（Gap/Trend/Volume/MA200/MA50, A/B/C/D 评级）；(3) 催化日历 — 央行决议、CPI/NFP/GDP、产品发布、监管裁决。当用户询问'财报日历/upcoming earnings/this week earnings'、'财报预览/财报分析/Q1/Q2/Q3/Q4 results/EPS beat'、'催化/经济日历/FOMC/CPI/GDP/economic calendar'时触发。支持美股/港股/A股。
required_tools: ["yfinance", "tavily"]
---

# 事件日历 — 决策协议

不只是看哪天发财报。**财报是个人投资者最大的单日非对称信息风险。** 协议覆盖：日历 → 预备 → 应对 → 冲突检测。

---

## 📅 默认视图：本周/下周（用户最常用）

```bash
# 本周 + 下周财报 + 宏观事件一览
python3 /Users/x/.claude/skills/event-calendar/scripts/earnings-calendar/<script>.py --week current
```

**输出必须包含**：
- 用户持仓 + watchlist 中本周/下周发财报的标的（高亮）
- 标的市场中本周宏观数据（CPI/FOMC/NFP 等）
- 冲突日标红

---

## ⚠ Pre-Earnings 操作协议（发财报前 1-3 天）

财报日±2天是"认知断层"事件——信息不对称瞬间释放。散户应有纪律。

### Pre-Earnings 检查清单（持仓中即将发财报的每个标的）

```
📋 [TICKER] Pre-Earnings 检查 — [财报日期]

1️⃣ 仓位检查
   - [ ] 当前仓位是否 > 正常配置？（涨多了没减？）
   - [ ] 是否考虑减仓 30-50%？（过财报不确定性）
   - [ ] 如果考虑减仓，减在财报前一天收盘前

2️⃣ 期权检查
   - [ ] 如果有 short call / put → 是否要在财报前平仓？（IV crush + gap risk）
   - [ ] 如果买 protective put → 现在是否还有效？（检查 strike + expiry）
   - [ ] Implied move（ATM straddle 价格）是多少？是否大于历史平均实际 move？

3️⃣ 期望设定
   - [ ] 卖方共识 EPS/Rev 是多少？
   - [ ] 过去 8Q surprise 历史（beat/miss 方向 + 幅度）
   - [ ] 我的 thesis 哪条 pillar 会被这期财报证实/证伪？

4️⃣ 计划（进财报前决定，不要在财报后 gap 那刻想）
   - [ ] 如果 beat +5% gap up → 追不追？
   - [ ] 如果 miss -10% gap down → 割不割？
   - [ ] 如果 flat → 持仓不动？
```

### 通用 Pre-Earnings 纪律

| 持仓类型 | 建议操作 |
|---|---|
| 短线/交易仓（< 3 月） | **减半或全平** — 财报 gap 不可控 |
| 中线投资仓（3-12 月） | 可选减 20-30%、买保护性 put |
| 长期持有仓（> 1 年） | 不动 — 一季财报不会改长期 thesis |
| 有 short option 的仓位 | **必须平 short leg** — IV crush 是唯一好事但 gap 可能致命 |

**AI 行为**：用户发"这周财报"时，必须同时检查上述清单中用户在持仓的标的，并主动输出预演。

---

## 📊 Post-Earnings 打分 + 行动协议

财报后不是打完分就完了。**打分必须映射到行动。**

### 打分系统（5 因子，A/B/C/D）

| 因子 | A (3分) | B (2分) | C (1分) | D (0分) |
|---|---|---|---|---|
| **Gap Size** | >+5% / <-5% 方向对 | +2-5% 方向对 | 0-2% 或方向错但小 | 方向错 >5% |
| **Trend** (财报前 20MA) | 顺势加速 | 顺势 | 横盘 | 逆势 |
| **Volume** (vs 20d avg) | >200% | 150-200% | 100-150% | <100% |
| **MA200 位置** | 突破 MA200 | 在 MA200 上方 | 在 MA200 附近 | 跌破 MA200 |
| **MA50 位置** | 突破 MA50 | 在 MA50 上方 | 在 MA50 附近 | 跌破 MA50 |

**总分**：A=13-15, B=9-12, C=5-8, D=0-4

### 打分 → 行动映射

| 评级 | 分数 | 行动 |
|---|---|---|
| **A** | 13-15 | ✅ 强趋势确认。若 thesis 支持 → 可追/加仓。止损放 gap day low |
| **B** | 9-12 | 🟢 正面。若 thesis 支持 + 估值合理 → 可小加。等 2-3 天确认 |
| **B-/C+** | 7-8 | 🟡 好坏参半。**不动**——等下一次催化或更多证据 |
| **C** | 5-6 | 🟠 疲弱。减仓 30-50%。如果 score 持续 C 两季 → 全平 |
| **D** | 0-4 | 🔴 危险。**全平，不犹豫。** 财报后跳空低开 + 破 MA50/200 = kill |

**关键原则**：
- D 评级出现 → **当天退出**，不要"再等等"
- 连续 2 季 C → 这不是"短期波动"，是 trend deterioration
- A 评级 ≠ 不用看估值。A + PE > 历史 95%ile → 追高风险

---

## 📆 催化日历 + 冲突检测

```bash
python3 /Users/x/.claude/skills/event-calendar/scripts/catalyst-calendar/<script>.py
```

跟踪：
- **央行**：FOMC、ECB、BoJ、PBOC LPR
- **宏观**：CPI、PCE、NFP、GDP、PMI
- **产品/监管**：发布会、FDA 裁决、反垄断
- **会议**：CES、NVIDIA GTC、WWDC、伯克希尔

### ⚡ 冲突检测（自动）

**同一天发生**以下组合 → 自动标记冲突日，输出 warning：

```
⚠ 冲突日检测
- 持仓财报 + CPI = 双重波动，建议降低当天操作频率
- 持仓财报 + FOMC = 三重不确定性（财报 + 利率 + 市场重定价）
- 3+ 持仓同天发财报 = 集中风险，至少 1 个应 pre-earnings 减仓
```

**冲突日纪律**：
- 当天不开新仓
- 所有限价单收紧（或全部取消）
- 不追 gap（too many moving parts）

---

## 🔁 完整周工作流

```
周五收盘后：
  跑 earnings-calendar --week next
  → 标记下周自己的持仓中哪些要发财报
  → 记入 checklist

提前 1-3 天：
  每个要发财报的持仓 → 过 Pre-Earnings 检查清单
  → 决定减仓/保护/不动

财报日当晚：
  看实际数字 vs 共识
  财报后第二天：
  跑 post-earnings 打分 → 按映射行动

每周日：
  跑 catalyst-calendar → 看下周宏观
  → 与持仓日历做冲突检测
```

---

## 🎯 模式速查

| 模式 | 命令 | 用途 |
|---|---|---|
| 财报日历 | `earnings-calendar --week current` | 本周/下周/本月发财报的标的 |
| 财报预览 | `earnings-analysis pre --ticker AAPL` | 共识、implied move、历史 surprise |
| 财报打分 | `earnings-analysis post --ticker AAPL` | A/B/C/D + 行动建议 |
| 催化日历 | `catalyst-calendar` | 央行/宏观/产品事件 |
| 冲突检测 | AI 自动执行 | 财报 + 宏观 overlap |

---

## ⚠ 散户最常犯的财报错误

1. **"财报一定涨"** → 没买保护，gap down -20% 后扛单
2. **"财报后 gap up 追"** → 跳空 +5% 追进去，第二天回吐
3. **"D 评级但我不信"** → 连续两季 miss 还在替公司找理由
4. **不检查期权到期日** → 财报日当天 short call/put 被打穿
5. **多个持仓同天发财报** → 集中风险爆炸

每条的解法都在上面协议里。

## ⚠ 反模式
- ❌ 只查本周财报，忽略央行决议/经济数据
- ❌ 财报分析不看隐含波动率（IV）
- ❌ 催化日历不检测事件冲突
- ❌ 评级只看EPS beat，忽略趋势/成交量
- ❌ 不更新已过时的事前预览

## 🔗 与其他 skill 的联动

event-calendar 是整个系统的**时间锚**——它告诉你"什么时候该紧张"。

| 触发 | 联动 skill | 做什么 |
|---|---|---|
| 持仓发财报前 3 天 | `trade-execution` | Pre-trade 5 道闸复审（仓位/beta/tail risk）|
| 财报后打分 C 或 D | `thesis-tracker` | 更新 thesis pillar 状态、检查 kill criteria |
| 财报 gap + 技术面变化 | `technical-analysis` | 重新画支撑/阻力、确认 MA 突破/跌破 |
| FOMC/CPI 与持仓财报同日 | `market-pulse` | 冲突日检查 MHS、顶部/底部 alert |
| 财报后 valuation 变化 | `valuation` | 重新算 fair value range |
| 财报日大宗波动 | `sector-analyst` (模式 4) | 原油/能源供需变化需要重评 |
| 财报后决定入场/加仓/退出 | `trade-execution` → `trade-journal` | 执行 → pre-mortem → 记录 |

> event-calendar 不产生"买/卖"结论，它产生"你该做功课了"——决策由联动 skill 完成。

## 注意

- FMP API key 通过环境变量配置
- 个人投资者：财报日 + 1-2 天隔夜 gap 风险大，建议持仓减半或买保护性 put
- A 股财报披露规则不同于美股，部分数据需用 Tushare/AKShare
