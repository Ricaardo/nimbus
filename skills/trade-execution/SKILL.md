---
name: trade-execution
description: 交易执行风控决策协议（合并 risk-assessment + position-sizer + stop-loss-manager）。3 大子工具 + 完整 pre-trade 决策树。当用户询问'仓位/多少股/position size/Kelly'、'止损/止盈/take profit/trailing stop/ATR'、'风险/Beta/VaR/最大回撤/波动率'、'pre-mortem/开仓前检查/我该不该买'时触发。支持美股/港股/A股/加密/贵金属。
required_tools: ["futuapi", "alpaca"]
---

# 交易执行 — 风控决策协议

不是计算器，是**开仓前的 5 道闸 + 持仓中的 3 个触发器**。

## 🚪 Pre-Trade 5 道闸（go/no-go）

按下"买"之前**必须全部回答**——任何一道闸 FAIL = NO GO。

### 闸 1: Thesis 写了吗？
- [ ] 1 句话能说清为什么买（不能说"看着不错"）
- [ ] 已用 `thesis-tracker` 记录或临时写在 trade-journal pre-mortem
- [ ] **Kill criteria 明确**（什么发生我会承认错）

❌ FAIL 案例：
- "AAPL 应该会涨"——不是 thesis
- "FOMO，怕错过"——不是 thesis
- 没有 kill criteria——投机不是投资

### 闸 2: Pre-Mortem 做了吗？

**必答 5 题（开仓前 90 秒思考）**：
1. 如果今天就跌 20%，我加仓还是认错？（决定信仰）
2. 这笔最可能怎么死？（base rate of failure）
3. 我的"信息优势"是真的吗？还是 confirmation bias？
4. 12 个月后哪个数据点会让我说"我错了"？
5. 我对这只股的 conviction 是 1-10 多少？（< 6 直接放弃）

> Pre-mortem 是 Daniel Kahneman + Gary Klein 的方法：把事情**当作已经失败**，反推原因。比 post-mortem 早一个 cycle 救你。

### 闸 3: 仓位算了吗？

3 种方法 → 选一种 + 行业/集中度检查：

| 方法 | 公式 | 适用 |
|---|---|---|
| **固定 % 风险**（默认） | `仓位 = 组合 × 1-2% / (入场 - 止损)` | 大部分散户 |
| **Half-Kelly** | `仓位 = 0.5 × (胜率 × 盈亏比 - 失败率) / 盈亏比` | 有可靠胜率统计的策略 |
| **ATR-based** | `仓位 = 风险金额 / (2 × ATR)` | 波动大的成长股/加密 |

**附加硬约束**：
- [ ] 单标的 ≤ 10% 组合（高 conviction 可到 15%）
- [ ] 同行业仓位 ≤ 30%
- [ ] 总杠杆 ≤ 1.5×（散户）
- [ ] 现金保留 ≥ 10%（机会储备金）

```bash
python3 /Users/x/.claude/skills/trade-execution/scripts/position-sizer/<script>.py \
  --ticker AAPL --portfolio 100000 --risk-pct 1 --stop 245
```

### 闸 4: 止损画了吗？

**4 种止损方法**（选最适合的）：

| 方法 | 公式 | 何时用 |
|---|---|---|
| **固定 %** | `entry × (1 - 7%)` | 简单标的，波动正常 |
| **ATR 倍数** | `entry - 2×ATR` | 个股 / 自适应波动 |
| **支撑位** | 最近支撑 - 1-2% | 技术派、有清晰结构 |
| **波动率分位** | 当前 σ 在历史百分位 → 高 σ 给宽止损 | 加密 / 高波动 |

**止盈定**：
- R:R = 入场到止损 = 1R，止盈定 2-3R
- Fibonacci 1.618 / 2.618 关键位
- 部分止盈：到 2R 卖 50%，剩下移动止损

```bash
python3 /Users/x/.claude/skills/trade-execution/scripts/stop-loss-manager/<script>.py \
  --ticker AAPL --entry 250 --rr 2
```

### 闸 5: Tail Risk 想过吗？

- [ ] 这个标的有"突然 -50%"的风险吗？（财务造假、Fed 政策、地缘）
- [ ] 如果整个市场 -30%，这只股大概率 -X%（用 Beta × -30%）
- [ ] 是否需要 hedge？（OTM put / collar / 对冲指数）
- [ ] 黑天鹅情况下我能撤吗？（流动性 / 假期 / 涨跌停）

---

## 📊 持仓中 3 个触发器

开仓后不是放着不管。持续监控以下条件：

### 触发器 A: 止损命中 → 立即全平
- 不要"再等等"——止损就是止损
- 如果想留，先问自己："如果今天没仓位，我会以这个价买吗？"——不会就走

### 触发器 B: Thesis 失效 → 不管价格，立即重审
- Kill criteria 里的某条已发生 → **30 分钟内决定 trim 或 exit**
- 不能"等下次财报再说"——thesis 错了就是错了
- 见 `thesis-tracker` 的 decay protocol

### 触发器 C: 价格大幅偏离基本面（±30%）→ 主动复审
- 大涨 30%+：是 thesis 提前实现（部分止盈）还是泡沫？
- 大跌 30%+：是 thesis 错了还是市场恐慌？（用 `value-perspective` Klarman lens 判断）

---

## 🛠 加仓 / 减仓 / 全平 决策树

**加仓**（金字塔加仓 vs 摊低成本）：
- ✅ 金字塔（thesis 进一步验证、价格在向好方向走）→ OK
- ❌ 摊低成本（thesis 没验证、只因为跌了）→ **绝对禁止**（散户最大亏损源）

**减仓 / 部分止盈**：
- 到达 2R / 3R → 卖 30-50%
- 估值进入泡沫区（如 PE > 历史 95%ile）→ 卖 30%
- 仓位涨到 > 15% → 强制 trim 到 10-12%（防止单点风险）

**全平**：
- 止损命中
- Thesis kill criteria 触发
- 找到更好的机会（机会成本）
- 生活需要现金

---

## 📐 风险度量基础

```bash
python3 /Users/x/.claude/skills/trade-execution/scripts/risk-assessment/<script>.py AAPL
```

输出：
- σ daily/annualized
- Beta vs SPY
- VaR 95%（单日最大损失）
- 最大回撤
- 下行偏差

**散户参考门槛**：
- σ_annual > 50% = 高波动，用更小仓位
- Beta > 1.5 = 杠杆于市场，做空风险大
- 最大回撤 > 60% = 这个标的历史上"会让你怀疑人生"

---

## 🔁 完整开仓流程

```
1️⃣ 研究（research / us-stock-analysis）
   ↓
2️⃣ 估值（valuation）
   ↓
3️⃣ 通过 5 道闸
   - thesis 写了？
   - pre-mortem 5 题答了？
   - 仓位算了？
   - 止损画了？
   - tail risk 想了？
   ↓
4️⃣ 下单（futuapi / 券商）
   ↓
5️⃣ 记录（trade-journal log）
   ↓
6️⃣ thesis 入库（thesis-tracker）
   ↓
7️⃣ 监控 3 个触发器（止损 / thesis / ±30%）
```

## ⚠ 反模式

1. **跳过 pre-mortem**（90 秒救你 90% 的烂 trade）
2. **摊低成本**（亏损加仓 = 把小错变大错）
3. **不设止损**（"我相信它会回来"）
4. **追高 + 心理止损**（嘴上说 -10% 走，实际 -30% 还在抗）
5. **没有 thesis kill criteria**（永远找理由不卖）

每条都有解药——见上面 5 道闸。

## 🔗 与其他 skill 的联动

trade-execution 是"开仓安检口"——进入前必须通过，出问题时也由它裁量。

| 触发 | 联动 skill | 做什么 |
|---|---|---|
| 闸 1: thesis 检查 | `thesis-tracker` | 拉取/创建 thesis |
| 闸 3: 仓位计算 | `market-pulse` | 参考 MHS→仓位上限 |
| 闸 5: tail risk | `portfolio-manager` | 组合尾风险校验 |
| 止损触发 | `trade-journal` | 记录平仓 + mistake 分类 |
| 入场后 | `thesis-tracker` | 写入 entry_price + kill criteria |

## 📂 Scripts

- `scripts/risk-assessment/` 波动率/Beta/VaR
- `scripts/position-sizer/` Kelly/ATR/固定% 仓位计算
- `scripts/stop-loss-manager/` 止损/止盈/移动止损
