---
name: market-pulse
description: "市场体检综合（12 子模块：Fed/流动性、宏观周期、中国宏观、FRED、情绪、顶/底检测、宽度、地缘、债券、外汇、现金）。输出 Market Health Score 0-100 → 仓位 % 建议 + 顶/底 alert。当用户问'市场温度/Fed/QT/QE/宏观/risk-on/risk-off/CPI/PMI/Fear Greed/分布日/FTD/breadth/收益率曲线/信用利差/DXY/carry/T-bill/货币基金'时触发。"
required_tools: ["tavily", "websearch", "alpaca"]
---

# 市场体检 — 决策协议

不是列出 12 个数字，是**综合成一个分数 → 映射到仓位 → 触发 alert**。

> 12 子模块详解（脚本调用、债券/外汇/现金完整框架）→ [`references/sub-modules.md`](references/sub-modules.md)

---

## 📊 Market Health Score (MHS) — 0-100

```
MHS = 流动性 × 0.25 + 周期 × 0.20 + 情绪 × 0.15 + 宽度 × 0.10
    + 地缘 × 0.10 + 债券 × 0.10 + 外汇 × 0.10
```

> 7 个**连续评分**模块。其余 4 个（中国宏观、FRED 通用、顶部检测、底部确认）是 **alert/触发型**——不进 MHS，但特定条件触发警告。

| 模块 | 权重 | 输入 | 评分逻辑 |
|---|---|---|---|
| 流动性/Fed | 30% | Fed BS / 净流动性 / TGA / RRP / 信用利差 / 美元 | 扩张→高，QT→低 |
| 宏观周期 | 25% | RSP/SPY / 收益率曲线 / 信用 / risk-on/off | risk-on→高 |
| 市场情绪 | 20% | Fear & Greed (0-100) | 中性 40-60→满分，极端→折扣 |
| 市场宽度 | 15% | S&P breadth + 行业上行率 | >60% above 50MA→高 |
| 地缘风险 | 10% | 5 因子加权 | 低风险→高 |
| 债券/固收 | 10% | 收益率曲线 / 信用利差 / TIPS BEI | 正常 + 低利差→高 |
| 外汇 | 10% | DXY / 利差 / carry | 美元弱 + carry 有利→高 |

### 计算示例

```
流动性 65×0.25=16.3 / 周期 55×0.20=11.0 / 情绪 45×0.15=6.8
宽度 60×0.10=6.0 / 地缘 30×0.10=3.0 / 债券 50×0.10=5.0 / 外汇 55×0.10=5.5
MHS = 53.6 → 中性偏谨慎
```

---

## 💰 MHS → 建议股票仓位

仓位**锚**，不是命令；每笔 trade 的默认上限。

| MHS | 状态 | 仓位 | 现金 | 风格 |
|---|---|---|---|---|
| **80-100** | 🔥 Risk-On | 80-90% | 10% | 进攻 — CANSLIM/VCP 突破 |
| **65-80** | 🟢 Bullish | 65-80% | 20% | 趋势跟踪 |
| **50-65** | 🟡 Neutral | 50-65% | 35% | 中性 — 只买最强 setup |
| **35-50** | 🟠 Cautious | 30-50% | 50% | 防御 — 收紧止损、少新开 |
| **20-35** | 🔴 Defensive | 20-30% | 70% | 仅股息/对冲、减仓 |
| **0-20** | ⚫ Crash | 0-20% | 80%+ | 现金为王，等 FTD |

**硬约束**：
- 单标的 ≤ 10%（高确信 15%）
- MHS < 35 → 禁止新开仓
- MHS < 20 → 强制对所有持仓 stop check

---

## 🚨 Alert 阈值

### 顶部

| 触发 | 信号 | 行动 |
|---|---|---|
| MHS > 75 + 分布日 ≥ 3 in 4w | ⚠ Top Warning | 减仓 20-30% |
| Fear & Greed > 85 | 🔶 Extreme Greed | 不对冲不新开 |
| Minsky Bubble > 70 | 🔴 Bubble Risk | 减仓到 30% |
| NYSE 52w 新高 < 50 + SPX near high | 🔶 Breadth Divergence | 收紧止损 |

### 底部

| 触发 | 信号 | 行动 |
|---|---|---|
| Fear & Greed < 15 + MHS < 25 | 🔷 Extreme Fear | 准备购物清单 |
| FTD Day 1（SPX +1.7% vol > prev）| ✅ FTD-1 | 试探 10-20% |
| FTD Day 4-7 健康 | ✅ FTD 确认 | 加到 40-50% |
| MHS 从 < 20 反弹到 > 35 | 🔷 Regime Shift | 逐步加仓 |
| Breadth thrust（≥90% above 50MA in 5d） | 🔷 Powerful Bottom | 加到 60%+ |

> **铁律**：没有 FTD 不抄底（O'Neil）。"Until a Follow-Through Day occurs, the market is in a correction — and cash is a position."

---

## 🎯 决策树

| 用户问 | 优先查 | 次查 |
|---|---|---|
| "现在该不该减仓" | MHS + 顶部检测 | 宽度 |
| "市场底了吗" | FTD + Fear&Greed (<20) | MHS 趋势 |
| "Fed 还在收水吗" | 流动性/Fed | — |
| "仓位该多少" | MHS → 仓位表 | 顶/底 |
| "risk-on 还是 off" | 宏观周期 | RSP/SPY |
| "黑天鹅" | 地缘风险 | VIX |
| "中国情况" | 中国宏观 | — |
| "债券/利率怎么看" | 债券/固收 | 收益率曲线 |
| "美元/汇率" | 外汇 | DXY + 利差 |
| "现金放哪" | 现金/货币市场 | 实际回报率 |

子模块详细脚本调用与框架 → [`references/sub-modules.md`](references/sub-modules.md)

---

## ⚡ Express Mode（30 秒快速体检）

用户说"快速体检"/"quick check"/"随便看看"时，**不跑 12 模块全量**：

```
📊 速检 — YYYY-MM-DD

MHS: 54/100 🟡 | 仓位上限: 65%
本周: AAPL 财报 Wed + CPI Thu ⚠ 冲突日
🚨 Alert: 无
Thesis: 5 活跃 | 0 zombie | 0 ±30% 触发
上周 P&L: +2.3% | 胜率: 3/4

⏱ 30 秒读完。要深挖哪个？
```

数据来源（AI 拼接，不跑全量）：
- MHS + 仓位 → market-pulse（仅算分）
- 本周事件 → event-calendar（仅冲突）
- Thesis 状态 → thesis-tracker（仅 zombie + 触发）
- Drift → portfolio-manager（仅 drift）

---

## 🗓 操作节奏

### 周一早晨（5 分钟）
1. MHS 几分？→ 本周仓位上限
2. 本周财报 + 宏观（CPI/FOMC/NFP） → 冲突检测
3. Thesis decay (>90d) 或 ±30% 触发？
4. 组合 drift > 5%？行业 > 30%？
5. 上周 trade 都复盘了？

### 周日晚（15 分钟）
1. 本周关闭 trade → trade-journal review + 错误归类
2. 每个活跃 thesis 更新数据点 / pillar 状态
3. MHS 趋势（本周 vs 上周）+ 顶/底 alert
4. research → 下周 idea / 教训

### 月度 1 号
1. trade-journal monthly → 策略胜率 + 错误 trend
2. portfolio-manager → 完整 drift + 风险
3. thesis-tracker → 所有 thesis 重打分
4. 淘汰胜率 < 40% 且 N ≥ 10 的策略 30 天

### AI 自动提醒

| 时间 | 提醒 |
|---|---|
| 周日 20:00 | "该做周复盘了" |
| 月 1 号 09:00 | "新月度复盘" |
| 财报前 3 天 | "AAPL 3 天后发财报，pre-earnings 检查" |
| Thesis decay 90 天 | "AAPL thesis 3 个月没更新" |
| 持仓 ±30% | "TSLA 跌 32%，复审" |

---

## 🔗 与其他 skill 的联动

| 触发 | 联动 | 做什么 |
|---|---|---|
| MHS 计算完成 | `portfolio-manager` | 对照实际仓位 vs 建议 |
| 顶部 Alert | `trade-execution` | 触发 trim 决策 |
| 底部 Alert + FTD | `research` Systematic | 准备购物清单 |
| 现金 > 30% | 见 sub-module §12 | 货币基金/T-Bill 安置 |
| Thesis 受 macro 影响 | `thesis-tracker` | 重新评估 pillar |
| 财报冲突日 | `event-calendar` | 调整持仓决策 |

---

## ⚠ 反模式

- ❌ 单一指标决策（只看 Fear & Greed）
- ❌ MHS 只是参考就跳过 — 它是混沌中的锚
- ❌ MHS > 80 就 all-in — 极端亢奋也要 discipline
- ❌ 没有 FTD 抄底 — 接飞刀断手
- ❌ 地缘风险忽略 — 10% 权重虽小，黑天鹅来了其他 4 项全废
- ❌ Express 模式跑全量 — 浪费时间，违背设计
