---
name: options-strategy-advisor
description: "期权一站式工具（合并 options-screener）。三合一：(1) Screening — PMCC / Premium Selling / Unusual Activity / LEAPS Replacement 4 模式；(2) Strategy — Black-Scholes / Greeks / P&L 模拟 / 18 策略 / 财报 plays；(3) Spread Analyzer — yfinance 实时多腿分析。当用户问 'covered call / iron condor / PMCC / spread / straddle / strangle / 期权策略 / 期权筛选 / option screen / sell premium / unusual options / LEAPS / 期权 P/L / Greeks' 时触发。支持美股/港股。"
required_tools: ["yfinance", "tavily"]
---

> 行情数据源 / 中文输出规范 见 [`../references/shared-output-rules.md`](../references/shared-output-rules.md)

# Options Strategy Advisor — 决策协议

不是公式手册，是**先选对模式 → 再控 IV/财报风险 → 再算 P&L**。

> 数学公式（Black-Scholes / Greeks）、18 策略详细列表、Setup/Exit、报告模板 → [`references/strategy-details.md`](references/strategy-details.md)

---

## 🎯 第一步：用户想干什么？

| 用户语境 | 用哪个模式 | 优先级 |
|---|---|---|
| "找 PMCC / 卖期权 / 异常大单 / LEAPS 替代" | **Screening**（4 子模式）| 先筛 |
| "分析这个 spread / 这笔 P&L / 这个 Greeks" | **Strategy Analysis**（BS）| 详分析 |
| "快速验证我已选的 strikes" | **Spread Analyzer**（yfinance）| 执行前 |
| "AAPL 财报前怎么做" | **Earnings Plays**（必查 IV crush）| 特殊 |

---

## 🔍 Screening — 4 子模式速查表

| 模式 | 核心阈值 | 何时用 | 调用 |
|---|---|---|---|
| **PMCC** | LEAPS Δ≥0.70 / DTE 360-720 / Short Δ 0.20-0.30 / yield/月 >1.5% LEAPS cost | 小额账户低成本做多 | `pmcc_scan.py` |
| **Premium Selling** | IV Rank >50 / IV %ile >60 / 横盘或微涨 / vol >$50M | 持股收租 / CSP | scripts |
| **Unusual Activity** | OTM 单边 vol >5× avg + premium >$500K | 跟聪明钱 | scripts |
| **LEAPS Replacement** | Δ≥0.80 / DTE 360-720 / spread <2% / 资金节省≥60% / 隐含利率<6% | 资金效率 | scripts |

**通用排除**：
- ❌ 流动性差（bid-ask >$0.15 或 OI < 100）
- ❌ 财报 <7 天内（除非主动做 earnings play）
- ❌ 假信号（spread/combo 误报、roll 非新信号）

---

## 📐 Strategy Analysis — 决策树

```
1. 用户给 ticker + 想法
   ↓
2. 问清 thesis：bullish / bearish / 中性 / 波动？
   ↓
3. 看 IV 状态（IV vs HV、IV percentile）
   ├─ IV high (>75%ile) → 卖方策略（credit spread / IC）
   └─ IV low (<25%ile) → 买方策略（debit spread / long call/put）
   ↓
4. 配方向 + 风险/收益偏好
   ↓
5. BS 定价 + Greeks → P&L 模拟 → 报告
```

### 18 策略快速分类（详见 references）

| Bias | Income | Directional | Volatility | Range |
|---|---|---|---|---|
| Bullish | Covered Call / CSP / PMCC | Bull Call/Put Spread | Long Straddle | — |
| Bearish | — | Bear Call/Put Spread | — | — |
| Neutral | Calendar / Diagonal | — | Short Straddle/Strangle | Iron Condor / Butterfly |
| 任意 + 保险 | Collar | Protective Put | — | — |

---

## ⚠ 财报前 5 条铁律

**任何 DTE < 14 + earnings 在期内的策略必须明示这 5 条**：

1. **IV Crush 警告**：财报后 IV 通常掉 10-20 点。即使股票不动，long premium 也可能亏 30-50%
2. **Implied Move 计算**：`√(DTE/365) × IV × Stock = ±$X` — long 策略需要实际波动 > IM
3. **不要硬扛单边方向**：财报赌方向 = coin flip。中性/IV 策略胜率更高
4. **Short Premium 是"赢 IV crush"**：Short IC / Short Strangle / Bear/Bull credit spread 都是 vega 负，财报后 IV 跌 → 直接获利
5. **Theta 视角错位**：财报前 Theta 加速 ≠ 普通时段。Implied calendar effect 已 priced in

---

## 🎚 Position Sizing 硬约束

```
单笔最大风险 = 账户 × 1-2%
张数 = 单笔风险 / 该策略 max loss/张

例（$50k 账户，2%）：
  Iron Condor max $300/张 → 3 张
  Bull Call Spread debit $250/张 → 4 张
```

**叠加约束**：
- [ ] 单 ticker 总 vega ≤ $500 ABS
- [ ] Portfolio Δ -10 ~ +10
- [ ] Theta 偏正（卖方优势）

---

## 🚪 Exit Rules（按策略类型）

| 类型 | Profit Take | Stop Loss | Time-based |
|---|---|---|---|
| Covered Call | 50-75% max | 股跌 >5% 买回 | 7-10 DTE roll |
| Debit Spread | 50% max | 2× debit | 21 DTE 平或 roll |
| Credit Spread / IC | 50% credit | 2× credit / 一侧测试 | 21 DTE / 早平减 tail |
| Long Straddle | 突破 BE 立即 | theta 蚕食时 | 财报后必平 |
| Short Straddle/Strangle | 50% credit | 2× credit | 21 DTE 必动 |

---

## 🔗 与其他 skill 的联动

| 触发 | 联动 skill | 做什么 |
|---|---|---|
| 用户问 ticker + IV 状态 | `market-data` (mode 3 options) | 拉期权链 + Greeks |
| 财报 plays | `event-calendar` | 拉精确财报日 + 历史财报反应 |
| LEAPS Stock Replacement | `valuation` + `us-stock-analysis` | 长期持有需先确认基本面 |
| 用户要对冲组合 | `portfolio-manager` | 算 protective put / collar 成本 |
| Bubble 风险高 | `market-pulse`（顶部检测）| 优先 protective put / 限 short premium |
| 趋势分析（strike 选支撑/阻力） | `technical-analysis` | 用关键位定 strike |

---

## ⚠ 反模式

- ❌ 财报前买 long straddle 不算 IV crush → 亏概率 60%+
- ❌ Sell premium 没设 stop → 一次大幅波动吃光半年收益
- ❌ Iron Condor 持有到 21 DTE 内不平 → gamma 风险爆炸
- ❌ Portfolio Greeks 不汇总 → 隐藏巨额 vega 敞口
- ❌ Position size 不算账户% → 单笔 wipe out
- ❌ Deep ITM Long Call 当"便宜的股票"持有 → 时间价值 + 流动性双输
- ❌ 用 BS 理论价直接下单 → 实际市场价 + bid-ask 差异未考虑

---

## 📂 References

- [`strategy-details.md`](references/strategy-details.md) — Black-Scholes / Greeks 公式、18 策略详细 setup、报告模板、财报 plays、Mode 2 详解
- `../references/shared-output-rules.md` — 中文输出 / 行情数据源

## 📂 Scripts

- `scripts/black_scholes.py` — BS 定价 + Greeks
- `scripts/spreads.py` — Mode 2 多腿快速分析（yfinance）
- `scripts/screener/pmcc_scan.py` — PMCC 候选扫描

> *理论 BS 定价不等于市场价。期权高风险，先 paper trade 再实战。*
