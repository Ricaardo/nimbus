# L1 统一状态层 — 消费协议

`portfolio_state.json` 是组合的**单一真相**。所有投资 skill 在需要"持仓/成本/占比/论点状态"时，
应**先读这份文件**，而不是各自重拉 futu/IBKR/论点（避免漂移与重复取数）。

## 刷新
```bash
python3 ~/.claude/skills/portfolio-manager/scripts/portfolio_state.py          # 构建+摘要
python3 ~/.claude/skills/portfolio-manager/scripts/portfolio_state.py --quiet  # 仅写文件
```
- **futu** 主账户：脚本自动拉（需 OpenD 运行）。
- **IBKR** 小号：脚本读 `ibkr_positions.json`。该文件由 **AI 经 MCP**
  (`mcp__claude_ai_Interactive_Brokers_IBKR__get_account_positions`) 刷新——
  脚本无法调 MCP。IBKR 持仓变动时让 AI 重写此文件（含 `stale:false`）。

## 字段（portfolio_state.json）
- `nav_usd / cash_usd / cash_pct` — 合并 NAV（futu HKD→USD + IBKR USD）
- `positions[]` — 每仓：`canon`(归一 ticker)、`weight_pct`、`mv_usd`、`pl_pct`、
  `thesis`(关联论点文件或 null)、`conviction_score`、`stop_loss`、`is_option`/`underlying`
- `reconcile_flags[]` — 裸仓 / 僵尸论点 / 单仓>15% / 行业>30% / 破止损 / 期权

## canon 归一化规则（跨源匹配键）
- 美股/字母代码：原样大写（`US.MRVL`→`MRVL`、`NOK`→`NOK`）
- 数字代码：**按市场加命名空间** `市场:号`，去前导零
  （`HK.00700`/`0700.HK`→`HK:700`；`SZ.000700`→`SZ:700`，二者不混）
- 论点 YAML 的 `ticker` 字段与 SECTORS 成员都用同一 canon 键

## 谁应该读它
portfolio-manager / trade-execution / thesis-tracker / us-stock-analysis /
market-pulse(仓位对照) / trade-journal — 任何需要"本人真实持仓画像"的 skill。

## 边界
- 只读分析，**不下单**（trade-guard deny）。
- FX 为近似静态汇率（行为/占比度量足够，精确盈亏以券商对账单为准）。
- IBKR 现金未并入 NAV（仅 NOK 持仓市值），小号 immaterial。
