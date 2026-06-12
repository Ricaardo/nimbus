---
name: portfolio-manager
description: "组合分析+再平衡决策协议。两模式：(1) 分析 — futu+IBKR 拉真实持仓、配置/分散/风险/绩效；(2) 再平衡 — drift / 税务感知 / asset location / wash sale。当用户询问'组合/portfolio/我的持仓/再平衡/rebalance/drift/配置/风险评估/sector concentration'时触发。支持美股/A股/港股/加密/贵金属。"
required_tools: ["futuapi", "alpaca", "tavily"]
---

> 行情数据源 / 中文输出规范 见 [`../references/shared-output-rules.md`](../references/shared-output-rules.md)

# Portfolio Manager — 决策协议

不是 7 步教程，是**仓位温度计 + 偏离警报系统**。它不告诉你"买什么"——它告诉你组合**有没有问题，问题在哪**。

## 🔌 数据源覆盖（本人专属 · 最高优先级）

**本人真实持仓在 futu（主）+ IBKR（小号），alpaca 是空的。** 下文凡写"Alpaca MCP 拉持仓"一律改用：
- **futu 主账户**（~USD 22K）：`python3 ~/.claude/skills/futuapi/scripts/trade/get_all_portfolios.py --trd-env REAL`（成本用 `average_cost`/`unrealized_pl` 均价口径）
- **IBKR 小号**（~USD 1.4K，仅 NOK）：`mcp__claude_ai_Interactive_Brokers_IBKR__get_account_positions`
- 两账户**合并**后再算配置/集中度/tail risk。HK 仓换算 USD 再与美股加总。
- ⚠️ 已知画像：几乎满仓（现金~8%）+ 半导体 44% 集中 → 单标的/行业阈值大概率已破，重点给**降集中**建议。
- 🔒 任何"trim/减仓/再平衡"落到下单 → 必经本人确认（见 [[feedback_trade_must_confirm]]，trade-guard hook 拦截）。

> 详细执行步骤、报告模板见 [`references/portfolio-workflow.md`](references/portfolio-workflow.md)（其中 Alpaca 调用细节按上方覆盖替换为 futu/IBKR）

---

## 🚨 4 个硬阈值（自动触发联动）

每次 portfolio review 必须扫描以下 4 项；任一触发 → 立即跳到对应 skill：

| 触发条件 | 信号 | 联动 skill | 必做动作 |
|---|---|---|---|
| 单标的 > 15% | 🔴 单点风险 | `trade-execution` | 强制 trim 至 10% |
| 同行业 > 30% | 🟠 行业集中 | `trade-execution` 闸 3 | 新开仓前确认 / 减仓 |
| 现金 > 30% | 🟡 闲置 | `market-pulse` 模块 12 | 现金安置（货币基金/T-Bill）|
| Drift > 5% from target | 🟡 偏离 | `market-pulse` (MHS) | 判断主动 vs 被动漂移 |

---

## 🌀 Tail Risk — 必跑场景

**核心问题**：多个持仓同时崩，组合扛得住吗？

### 计算公式

| 持仓类型 | 估损 |
|---|---|
| 股票/ETF | `仓位% × Beta × 市场跌幅` |
| 期权 | `仓位% × Delta × underlying跌幅` |
| 债券 | `仓位% × 久期 × 利率变动` |
| 现金/黄金 | ≈ 0（避险）|

### 4 档场景

```
📉 -10% 市场 → 组合预估 ?
📉 -20% 市场 → 组合预估 ?
📉 -30% 市场 → 组合预估 ?
📉 -50% 市场 → 组合预估 ? (2008 级)
```

### Tail Risk 阈值

| 条件 | 信号 | 行动 |
|---|---|---|
| -30% 场景下组合 > -20% | 🔴 过度杠杆/集中 | 检查单标的/行业硬阈值 |
| -20% 场景下组合 > -10% | 🟠 偏激进 | 减仓或加 tail hedge |
| 3+ 持仓 Beta > 1.5 | 🟠 高 Beta 集中 | 低 Beta 替代 / 缩小 |
| 单标的贡献 > 总回撤 40% | 🔴 单点 | 强制 trim 到 10% |
| -50% 场景下组合 > -30% | 🔴 配置失衡 | 重新审视股债比 |

---

## 🔁 工作流（节点级，不是 step-by-step）

```
1. Alpaca MCP 拉数据（详见 references/portfolio-workflow.md Step 1-2）
2. 跑 4 硬阈值扫描（上方表）
3. 跑 Tail Risk 场景（4 档）
4. 配置/分散/风险/绩效（详见 references Step 3）
5. Top 10 单仓评估 → HOLD/ADD/TRIM/SELL（详见 references Step 4）
6. 再平衡建议（如触发，详见 references Step 5）
7. 生成报告 portfolio_analysis_YYYY-MM-DD.md
```

---

## 💼 再平衡触发规则

不是定期跑，是**条件触发**：

| 条件 | 是否再平衡 |
|---|---|
| Drift < 3% | ❌ 别动 |
| Drift 3-5% | 🟡 用新 cash flow 调，不交易 |
| Drift > 5% | 🟢 触发 |
| 单仓 > 15% | 🟢 强制 trim |
| 重大持仓 thesis 破裂 | 🟢 优先卖（不只为再平衡）|
| 临近税务年末 + 有亏损 | 🟢 顺手 TLH |

### 税务感知优先级

1. **优先在 IRA/Roth 中操作** — 无税
2. **应税账户**：避免短期大额盈利、顺手 TLH
3. **Wash Sale 30 天**跨所有账户
4. **新资金**优先投低配，而非卖出

详见 [`references/portfolio-workflow.md`](references/portfolio-workflow.md) Mode 2。

---

## 🔗 与其他 skill 的联动

portfolio-manager 是**鸟瞰层**——不产生买卖决策，但告诉你哪里需要关注。

| 触发 | 联动 skill | 做什么 |
|---|---|---|
| 行业集中度 > 30% | `trade-execution` | 闸 3 硬约束检查 |
| 单标的 > 15% | `trade-execution` | 触发强制 trim |
| Drift > 5% | `market-pulse` | 对照 MHS 判主动/被动 |
| 减仓决策 | `thesis-tracker` | 别卖最强的买最弱的 |
| 现金 > 30% | `market-pulse` 模块 12 | 货币基金/T-Bill/I-Bonds |
| 分红/除权 | `event-calendar` | 现金流入 + dividend capture 风险 |
| 大幅回撤 | `thesis-tracker` → `trade-journal` | kill criteria 检查 → pre-mortem |
| Tail risk 高 | `options-strategy-advisor` | protective put / collar 成本 |
| 单仓深度分析 | `us-stock-analysis` | 切到个股层 |

---

## ⚠ 反模式

- ❌ 为再平衡而再平衡（drift < 3% 也交易）→ 摩擦成本超过收益
- ❌ 应税账户里卖盈利股 → 税单可能 > 收益
- ❌ 跨账户没考虑 Wash Sale → IRS 否决 TLH
- ❌ Tail risk 只算 -30% 不算 -50% → 黑天鹅暴露
- ❌ 不调用 thesis-tracker 就 trim → 卖了反而是最强的
- ❌ 卖出建议没 tax impact → 用户惊讶

---

## 📂 References

- `portfolio-workflow.md` — 完整 Step 1-7 流程 + 报告模板（本 SKILL 砍下来的部分）
- `alpaca-mcp-setup.md` — Alpaca MCP 配置
- `asset-allocation.md` — 配置框架
- `diversification-principles.md` — 分散理论
- `portfolio-risk-metrics.md` — Beta / σ / DD / VaR
- `position-evaluation.md` — 单仓评估
- `rebalancing-strategies.md` — 再平衡方法
- `target-allocations.md` — 基准配置（保守/平衡/成长/激进）
- `risk-profile-questionnaire.md` — 风险偏好评估

> *分析仅供参考，不构成投资建议。Alpaca/第三方数据源准确性以原始来源为准；税务影响为估算，请咨询税务专业人士。*
