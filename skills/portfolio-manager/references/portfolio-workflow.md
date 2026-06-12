# Portfolio Workflow — 详细执行步骤

> 这是 SKILL.md 的扩展，记录完整的 Step 1-7 工作流和输出模板。SKILL.md 只保留决策协议；具体怎么拉持仓、怎么写报告在这里。

---

## Step 1: Fetch Portfolio Data（futu 主 + IBKR 小号）

> 本人真实持仓在 futu + IBKR，**不在 alpaca**。下方为权威拉取方式（替代旧 Alpaca 调用）。

### 1.1 futu 主账户（资金 + 持仓 + 成本）

```
python3 ~/.claude/skills/futuapi/scripts/trade/get_all_portfolios.py --trd-env REAL
→ 每账户：总资产 / 现金 / 持仓市值 + 逐仓：code / 数量 / 现价 / 市值 / average_cost / unrealized_pl / pl_ratio_avg_cost
⚠️ 成本/盈亏用 average_cost / unrealized_pl（均价口径），禁用 cost_price / pl_val（摊薄口径）
```

### 1.2 IBKR 小号

```
mcp__claude_ai_Interactive_Brokers_IBKR__get_account_summary   → net_liquidation / cash / buying power
mcp__claude_ai_Interactive_Brokers_IBKR__get_account_positions → ticker / qty / average_price / market_value / unrealized_pnl
```

### 1.3 历史/成交（可选，复盘用）

```
futu 今日成交：get_order_fill_list.py --trd-env REAL ；历史：get_history_order_fill_list.py
IBKR 资金曲线：get_account_balances
```

**合并规则**：HK 仓按汇率换 USD，与美股加总后再算配置/集中度/tail risk。
**Data Validation**: 持仓市值合计应≈账户净值；处理碎股/期权/加密；两账户去重（如 NOK 两处都有则分列）。
**Fallback**: futu OpenD 未启动 → 提示本人启动；alpaca 仅当本人在 alpaca 实际有仓时才用。

---

## Step 2: Enrich Position Data

每个持仓补齐：
- **Market data**: 当前价、52 周区间、市值
- **Fundamentals**: 行业、PE/PB/股息、近期财报、分析师评级
- **Technical**: 趋势（20/50/200MA）、RS、支撑/阻力、RSI/MACD

---

## Step 3: Portfolio-Level Analysis

### 3.1 Asset Allocation

读 `references/asset-allocation.md`。维度：
- **Asset Class**: 股/债/现金/另类 vs target
- **Sector**: vs S&P 500 基准
- **Market Cap**: 大/中/小盘分布
- **Geography**: 美/国际/新兴

输出：
```markdown
## Asset Allocation

| Asset Class | Current | Target | Variance |
|---|---|---|---|
| ... |

### Top 10 Holdings
| Rank | Symbol | % | Sector |
|---|---|---|---|
```

### 3.2 Diversification

读 `references/diversification-principles.md`。检查：
- **Position concentration**: 单仓 > 10-15% flag
- **Sector concentration**: 单行业 > 30-40% flag
- **HHI** 集中度指数
- **Correlation**: > 0.8 视为冗余
- **Position count**: 15-30 为优

### 3.3 Risk

读 `references/portfolio-risk-metrics.md`。指标：
- **Beta**（持仓加权）
- **σ**（如有历史数据）
- **Max DD** + 当前距峰值回撤
- **High-vol exposure**: Beta > 1.5 占比
- **Tail risk**: 见下方专节

### 3.4 Performance

- **绝对**: 总 P&L、Top 5 / Bottom 5
- **TWR**（如有历史）: YTD / 1Y / 3Y / 5Y vs benchmark
- **胜率**: winners vs losers，平均盈/亏

---

## Step 4: Individual Position Analysis（Top 10-15）

读 `references/position-evaluation.md`。每个核心持仓走 5 步：

1. **Thesis 验证** — 还成立吗？
2. **Valuation** — PE/PB vs 历史/同行
3. **Technical** — 趋势 / MA 关系 / 支撑阻力
4. **Sizing** — 当前权重是否合理
5. **Action**: HOLD / ADD / TRIM / SELL + 1-2 句理由

输出模板：
```markdown
### [SYMBOL] - [Company] (X.X% of portfolio)

**Position**: Shares XXX | Avg $XX | Now $XX | MV $XXX | P&L +X.X%
**Fundamental**: Sector | MCap $XB | PE X | Yield X%
**Technical**: [Trend] | vs 50DMA [+/- X%] | Sup/Res
**Assessment**: Thesis [Intact/Weak/Broken] | Val [Under/Fair/Over] | Size [OK/Over/Under]

**Action**: HOLD / ADD / TRIM / SELL
**Why**: [1-2 句]
```

---

## Step 5: Rebalancing Recommendations

读 `references/rebalancing-strategies.md`。优先级：

1. **Immediate** — 风险消除（过度集中 trim）
2. **High** — 主分配漂移 > 10%
3. **Medium** — 漂移 5-10%
4. **Low** — 微调

输出：
```markdown
## Rebalancing Recommendations

### Summary
- **Needed**: Yes/No/Optional
- **Reason**: [Concentration / Drift / Cash deployment]

### HIGH PRIORITY
**TRIM [SYMBOL]** XX% → YY%
- Sell XX shares (~$XX,XXX)
- Tax: $X,XXX cap gain (est)

### MEDIUM PRIORITY
**ADD [Sector]**
- Target XX% → YY%
- Suggested: [TICKER1, TICKER2]

### Cash Deployment
Current $XX,XXX (XX%) → recommend deploy/keep
```

---

## Step 6: Generate Portfolio Report

文件名：`portfolio_analysis_YYYY-MM-DD.md`

结构：
1. Executive Summary（3-5 bullets）
2. Holdings Overview（汇总表）
3. Asset Allocation（Step 3.1）
4. Diversification（Step 3.2）
5. Risk Assessment（Step 3.3）
6. Performance Review（Step 3.4）
7. Position Analysis（Step 4）
8. Rebalancing（Step 5）
9. Action Items（Immediate / Medium / Watch）
10. Appendix: Full Holdings

---

## Step 7: Interactive Follow-up

常见追问及应对：

**"Why sell [X]?"** → valuation/thesis/concentration 具体证据
**"Buy what instead?"** → 改善的 sector/factor + 简短 thesis
**"Biggest risk?"** → 量化首要风险 + 缓解方案
**"vs benchmark?"** → 配置/行业/风险三维对比
**"Now or wait?"** → 市场/税务/成本三因素
**"Deep dive [X]?"** → 切到 us-stock-analysis

---

## Mode 2: Rebalance — 完整流程

### Step 1: Current State（按账户）
- 账户类型（taxable / IRA / Roth / 401k）
- 持仓 + MV
- Cost basis（应税）
- 未实现 P&L

### Step 2: Drift Analysis

```markdown
| Asset Class | Target % | Current % | Drift | $ Over/Under |
|---|---|---|---|---|
| US Large Cap | | | | |
| US SMID | | | | |
| Intl Developed | | | | |
| EM | | | | |
| IG Bonds | | | | |
| HY / Credit | | | | |
| TIPS | | | | |
| Alt | | | | |
| Cash | | | | |
```

阈值通常 ±3-5%。

### Step 3: Tax-Aware Rules

- **优先在 IRA/Roth 中再平衡** — 无税
- 应税账户：避免短期大额盈利
- 顺手收割亏损（TLH）
- Wash Sale 30 天窗口跨账户
- 新资金优先投低配，而非交易

### Step 4: Asset Location

- **Tax-deferred (IRA/401k)**: 债券、REIT、高周转基金
- **Roth**: 最高预期增长资产（免税增长）
- **Taxable**: 税效高的权益、TLH 候选

### Step 5: Implementation Summary
- 各账户交易汇总
- 预估成本/税务
- Before/After 配置对比

### Important Notes
- 不为再平衡而再平衡（阈值内别动）
- 算盈亏平衡：税务成本可能 > 收益
- 考虑 cash flow（供款、提款、RMD）
- Wash Sale 跨账户协调

---

## Reference Files

| 文件 | 何时读 |
|---|---|
| `asset-allocation.md` | 配置分析、再平衡 |
| `diversification-principles.md` | 评估分散质量 |
| `portfolio-risk-metrics.md` | 风险计算 |
| `position-evaluation.md` | 单仓 Buy/Hold/Sell |
| `rebalancing-strategies.md` | 再平衡方法 |
| `target-allocations.md` | 基准配置（保守/平衡/成长/激进）|
| `risk-profile-questionnaire.md` | 用户没指定风险偏好 |

---

## Error Handling

- **futu OpenD 未启动** → 提示本人启动 OpenD；IBKR 走 MCP（只读）；备选本人提供 CSV
- **数据不全** → 用现有数据 + 标注限制
- **数据 stale** → flag + 建议刷新
- **空仓位** → 切到组合构建建议（research / stock-screener）

---

## Advanced Features

- **TLH**: 损 > 5% + Wash Sale 检查 + 替代标的（不"实质相同"）
- **Dividend income**: 估年股息、增长率、可持续性、yield on cost
- **Correlation matrix**: 5-20 仓时算 corr，> 0.8 视为冗余
- **Scenario analysis**: Bull / Bear / Sector rotation / Rate up

---

## Disclaimers（每份报告附）

> *仅供参考，不构成投资建议。投资决策应基于个人情况、风险承受、目标。过往业绩不预示未来。*
> *数据准确性依赖 Alpaca API 及第三方源。税务影响仅为估算，请咨询税务专业人士。*
