# Options Strategy Details — 数学、18 策略、模板

> SKILL.md 是决策协议；此文档存放（1）数学公式 Black-Scholes/Greeks（2）18 策略详细列表（3）每种策略的 setup/Greeks/exit/警示（4）报告输出模板。需要时按需读取。

---

## 一、数学层

### Black-Scholes（European-style）

```
Call = S·N(d1) − K·e^(−rT)·N(d2)
Put  = K·e^(−rT)·N(−d2) − S·N(−d1)
d1 = [ln(S/K) + (r + σ²/2)·T] / (σ·√T)
d2 = d1 − σ·√T
```

S=股价 / K=行权 / T=年化到期 / r=无风险利率 / σ=IV 或 HV / N=正态 CDF

**美式期权**：用 European 近似，注明可能低估；分红股票需在 S 中减去贴现分红。

**Python 实现**：见 `scripts/black_scholes.py`。

### Greeks 公式

| 希腊字母 | 含义 | 公式（Call）|
|---|---|---|
| Δ Delta | 标的±$1 时期权价格变动 | `e^(−qT)·N(d1)` |
| Γ Gamma | Δ 的变化率 | `e^(−qT)·φ(d1)/(S·σ·√T)` |
| Θ Theta | 每日 time decay | `[−S·φ(d1)·σ·e^(−qT)/(2√T) − rK·e^(−rT)·N(d2) + qS·N(d1)·e^(−qT)] / 365` |
| ν Vega | IV ±1% 价格变动 | `S·e^(−qT)·φ(d1)·√T / 100` |
| ρ Rho | 利率 ±1% 价格变动（Call）| `K·T·e^(−rT)·N(d2) / 100` |

**Position Greeks**（多腿组合）：每腿 × 仓位（long=+1, short=−1）后求和。

### IV vs HV

```python
HV = std(log_returns(prices_90d)) × √252
```

| IV vs HV | 含义 | 默认策略 |
|---|---|---|
| IV > HV | 期权偏贵 | 卖方 — credit spread / IC |
| IV < HV | 期权偏便宜 | 买方 — long call/put / debit spread |
| IV ≈ HV | 公允 | 任意 |

**IV Percentile**：当前 IV 在过去 1 年 HV 序列里的百分位。
- > 75 → 高 IV，卖方友好
- < 25 → 低 IV，买方友好

### P/L 模拟

```python
for leg in strategy.legs:
    intrinsic = max(0, S_T - K) if call else max(0, K - S_T)
    pnl += (intrinsic - premium_paid) * 100 if long else (premium_received - intrinsic) * 100
```

输出 max profit / max loss / breakeven / profit probability（简化版用 BE 之间的价格区间百分比 × IV 调整）。

---

## 二、18 策略目录

### Income（收租）
1. **Covered Call** — 持股 + 卖 call。封顶上行换稳定收租
2. **Cash-Secured Put** — 现金担保卖 put。愿以行权价买入
3. **Poor Man's Covered Call (PMCC)** — Long LEAPS call + short near call

### Protection（保险）
4. **Protective Put** — 持股 + 买 put。下行保险
5. **Collar** — 持股 + 卖 call + 买 put。封顶上行换零成本保险

### Directional（方向性）
6. **Bull Call Spread** — 买低 call + 卖高 call（debit, bullish）
7. **Bull Put Spread** — 卖高 put + 买低 put（credit, bullish）
8. **Bear Call Spread** — 卖低 call + 买高 call（credit, bearish）
9. **Bear Put Spread** — 买高 put + 卖低 put（debit, bearish）

### Volatility（波动率）
10. **Long Straddle** — ATM call + ATM put。赌大幅波动
11. **Long Strangle** — OTM call + OTM put。便宜版 straddle，需要更大波动
12. **Short Straddle** — 卖 ATM call + put。赌不动；理论无限风险
13. **Short Strangle** — 卖 OTM call + put。范围更宽

### Range-Bound（区间）
14. **Iron Condor** — Bull put spread + Bear call spread。赌区间内
15. **Iron Butterfly** — 卖 ATM straddle + 买 OTM strangle。窄区间，credit 更多

### Advanced
16. **Calendar Spread** — 卖近月 + 买远月（同 strike）。time decay 套利
17. **Diagonal Spread** — Calendar 不同 strike。方向性 + time decay
18. **Ratio Spread** — 不平衡腿（如 1×long + 2×short）

---

## 三、典型策略 Setup 详解

### Covered Call（收租）

```
持股 100 AAPL @ $180
卖 1× $185 call (30 DTE) for $3.50

Max Profit: $850  (stock @ $185+: $5 stock + $3.50 premium)
Max Loss: 无限下行（持股本身风险）
Breakeven: $176.50  (cost - premium)
Greeks: Δ -0.30 / Θ +$8/day
Assignment: 到期 > $185 → 股票被叫走
退出: 大涨买回 / 区间内让到期 / roll 下月保留
```

### Protective Put（保险）

```
持股 100 AAPL @ $180
买 1× $175 put (30 DTE) for $2.00

Max Profit: 无限上行
Max Loss: -$7/股 ($5 stock + $2 premium)
Breakeven: $182  (cost + premium)
Greeks: Δ +0.80 / Θ -$6/day
Cost ≈ 1-3% of stock value
退出: 涨 → 让 put 作废 / 跌穿 $175 → 行权
```

### Iron Condor（区间）

```
AAPL @ $180:
  卖 $175 put @ 1.50 / 买 $170 put @ 0.50
  卖 $185 call @ 1.50 / 买 $190 call @ 0.50
Net Credit: $2.00

Max Profit: $200  (stock 175-185)
Max Loss: $300  (stock < 170 或 > 190)
Breakeven: $173 / $187
Greeks: Δ ~0 / Θ +$15/day / ν -$25
止损: 一侧被测试时 2× credit (-$400)
退出: 50% max profit 早平 / roll 被测试侧
```

---

## 四、财报策略（Earnings Plays）

### 关键风险：IV Crush

财报前 IV 抬升（如 40%）→ 财报后回落（如 25%）。即使股票不动，long 期权也会因 vega 跌 -$750。

### Long Straddle 财报前（赌大波动）

```
AAPL @ $180, earnings in 7 days
买 $180 call @ $5.00 + 买 $180 put @ $4.50
Cost: $9.50

Implied Move: √(7/365) × 0.40 × 180 = ±$10.50
Breakeven Move: ±$9.50
P(profit) ≈ 30-40%

✅ 期待 >10% 实际波动 才适合
❌ 普通 5% 财报反应 → IV crush 直接亏
```

### Short Iron Condor 财报前（赌区间内 + IV crush）

```
AAPL @ $180, earnings in 7 days
卖 $170/$175 put spread @ $2.00
卖 $185/$190 call spread @ $2.00
Net Credit: $4.00

Profit Zone: $175-$185
Max Profit: $400 / Max Loss: $100
ν -$40 (享受 IV crush)

✅ 普通财报反应 <8% 时最优
✅ IV crush 不论方向都帮你
⚠ 跳出 > $190 或 < $170 → 仍可能亏

Exit: 财报次日 IV 暴跌 → 立即 close
```

---

## 五、Position Sizing

**通用公式**：
```
账户 × 风险% / 单笔 max loss = 张数

例：$50k × 2% = $1,000 max loss
- Iron Condor (max $300/张) → 3 张
- Bull Call Spread (debit $250/张) → 4 张
```

---

## 六、Portfolio Greeks 管理

### 推荐区间

| Greek | 推荐 | 说明 |
|---|---|---|
| Delta | -10 ~ +10 | 大致中性 |
| Theta | 正（卖方友好）| 收时间价值 |
| Vega | < $500 ABS | IV 风险可控 |

### 解读示例

```
Δ +5    ✅ 略 bullish 但中性
Θ +$150/day  ✅ 时间在你这边
ν -$300  ⚠ short vega，IV 升 1% 亏 $300
→ VIX 上升时减 short premium 仓位
```

---

## 七、Exit Rules（按策略）

### Covered Call
- Profit: 50-75% max profit 平
- Loss: 股价跌 >5% → 买回 call 保留上行
- Time: 7-10 DTE → roll 避免被指派

### Spreads（debit/credit）
- Profit: 50% max profit 早平（减 tail）
- Loss: 2× debit 止损
- Time: 21 DTE → 平或 roll（避 gamma 风险）

### Iron Condor
- Profit: 50% credit 平
- Loss: 一侧测试 + 2× credit 亏
- Adjust: roll 被测试侧

### Straddle/Strangle
- Profit: 突破 BE → 立即平
- Loss: theta 蚕食、股票不动
- Time: 财报次日（如做 earnings play）

---

## 八、报告输出模板

```markdown
# Options Strategy Analysis: [Strategy Name]

**Symbol**: [TICKER]
**Strategy**: [Type]
**Expiration**: [Date] ([DTE] days)
**Contracts**: [N]

## Strategy Setup
| Leg | Type | Strike | Price | Position | Qty |
|-----|------|--------|-------|----------|-----|
| 1 | Call | $180 | $5.00 | Long | 1 |
| 2 | Call | $185 | $2.50 | Short | 1 |

**Net Debit/Credit**: $X

## Profit/Loss
- Max Profit: $X (at $X+)
- Max Loss: -$X (at $X-)
- Breakeven: $X
- R:R: X:Y

## Greeks (1 unit)
- Δ +/- | Γ +/- | Θ -$/day | ν +$ /1% IV

## P/L Diagram
[ASCII art — 见 scripts/black_scholes.py 的 diagram 输出]

## Risk Assessment
- Max Risk Scenario / Assignment Risk / % of account

## Trade Management
- Entry: [conditions]
- Profit Take: [target]
- Stop Loss: [trigger]
- Adjustments: [rolling rules]

## Suitability
- ✅ When to use
- ❌ When to avoid

## Alternatives Comparison
| Strategy | Max P | Max L | When Better |

*Disclaimer: 理论 BS 定价，市场实际可能不同。期权风险高，自担。*
```

文件命名：`options_analysis_[TICKER]_[STRATEGY]_[DATE].md`

---

## 九、Mode 2: Spread Analyzer（实时市场价快速分析）

`scripts/spreads.py` — 基于 yfinance 实时数据，秒级算 cost/max P/L/BE/概率。

支持：vertical / straddle / strangle / iron condor。

| 维度 | Mode 1 (BS 理论) | Mode 2 (Spread Analyzer) |
|---|---|---|
| 定价 | Black-Scholes | yfinance 市场价 |
| 输出 | 完整报告 + Greeks + 教育 | 快速 cost/P&L/概率 |
| 用途 | 学习/研究 | 执行前验证 |

调用：
```bash
uv run python scripts/spreads.py AAPL --strategy iron-condor --expiry 2026-01-16 \
  --put-short 175 --put-long 170 --call-short 185 --call-long 190
```

---

## 十、常见问题

| 问题 | 解决 |
|---|---|
| IV 拿不到 | 用 HV 代替 + 提示用户从券商平台输入 |
| 期权价为负 | 检查 strike vs S；deep ITM 可能数值问题 |
| Greeks 不对 | 检查 T (年化)、σ (年化) 单位 |
| 策略复杂 | 拆腿单独分析后求和 |
