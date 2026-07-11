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
- `nav_usd / cash_usd / cash_pct` — **统一净值**：futu(HKD→USD) + IBKR(USD)。IBKR 现金取值优先级：
  ① `ibkr_positions.json` 本次有 `total_cash` 字段 → 直接用；② 本次缺失时，从
  `nav_history.jsonl` 最后一条的 `ibkr_cash_usd` **携带前值**(carry-forward)，避免 AI 手动刷新漏写
  `total_cash` 时 `nav_usd` 静默跳空掉整个 IBKR 现金额度、在净值曲线上刻出一个假回撤/污染
  `max_drawdown` 基线；③ 两者都没有（含首次运行、历史也没有过现金数据）→ 保持原口径
  （positions-only，不并入），`accounts.ibkr.cash_usd` 给 `null`。长桥模拟盘**不**并入
  （见 ROADMAP，账户不真实）。注意 carry 的代价：若 IBKR 真的清仓/提现而刷新又一直漏写
  `total_cash`，携带值会一直冻结在最后一次新鲜数字上（幻影现金），直到刷出新 `total_cash`
  （含 0）才纠正——`cash_carried=true` 持续出现时应催一次完整刷新。
- `pl_usd` — 合并未实现浮盈亏(USD)，两账户皆无法算时为 `null`。
- `accounts` — 分账户拆分：
  `{"futu": {"total_usd", "cash_usd", "pl_usd"},
  "ibkr": {"mv_usd", "cash_usd"(可能 null；本次新鲜值或 carry-forward 值), "stale", "pl_usd",
  "cash_carried"(true=本次现金是携带前值算出的，非新鲜数据，正常刷新时为 false)}}`
- `positions[]` — 每仓：`canon`(归一 ticker)、`source`(`futu`/`ibkr`，即账户归属)、`weight_pct`、
  `mv_usd`、`pl_pct`、`pl_usd`(反推的浮盈亏 USD，成本未知时 `null`)、
  `thesis`(关联论点文件或 null)、`conviction_score`、`stop_loss`、`is_option`/`underlying`
- `reconcile_flags[]` — 裸仓 / 僵尸论点 / 单仓>15% / 行业>30% / 破止损 / 期权

## canon 归一化规则（跨源匹配键）
- 美股/字母代码：原样大写（`US.MRVL`→`MRVL`、`NOK`→`NOK`）
- 数字代码：**按市场加命名空间** `市场:号`，去前导零
  （`HK.00700`/`0700.HK`→`HK:700`；`SZ.000700`→`SZ:700`，二者不混）
- 论点 YAML 的 `ticker` 字段与 SECTORS 成员都用同一 canon 键

## nav_history.jsonl — 净值历史（`portfolio_state.py` 自动写）
- **谁写**：`portfolio_state.py` 每次成功拉到 futu 数据（组装出 `portfolio_state.json`）后，
  在 `main()` 里追加一行；futu 拉取失败/无数据时**不追加**（避免脏点污染曲线）。
- **schema**：`{"ts": "YYYY-MM-DD HH:MM"(与 as_of 同格式), "nav_usd", "cash_usd", "futu_usd", "ibkr_usd",
  "ibkr_cash_usd"(本次并入 nav 的 IBKR 现金，新鲜或 carry-forward 来的，可能为 null), "ibkr_stale"}`。
  `ibkr_cash_usd` 是本 fix（2026-07-11）新增字段，此前写入的旧行没有这个键——读取按 `None`/未知处理，
  向后兼容，不需要迁移旧数据。
- **去重**：同一 `ts`（= 同一次 `as_of`）重复运行不重复追加，写入幂等。
- **上限**：无（每天约 2 条，07:30/20:30 cron，规模极小，长期也就几百行）。
- **写法**：原子写（临时文件 + `os.replace`），文件不存在时自动创建。
- **消费建议**：Cici 可直接读它画净值曲线（`nav_usd` vs `ts`）、算任意区间回报/回撤，
  或用 `portfolio_state.load_nav_history()` / `nav_change_pct()` 复用现成解析逻辑；
  统一封装见 `skills/portfolio-manager/scripts/nav_view.py`。

## flows.jsonl — 出入金流水（手记，可选）
- **谁写**：目前无自动化，出入金后由 AI/主人手动追加一行（无此文件时相关计算优雅降级为"未剔除出入金"）。
- **schema**：`{"ts": "YYYY-MM-DD", "amount_usd": ±数, "note": "…"}`；入金记正、出金记负。
- **用途**：`nav_view.py` 用它把区间净值变化里的出入金效应剔除，得到更接近"真实投资回报"的修正值
  （简单法：区间 NAV 变化 − 区间净流入）。

## 谁应该读它
portfolio-manager / trade-execution / thesis-tracker / us-stock-analysis /
market-pulse(仓位对照) / trade-journal — 任何需要"本人真实持仓画像"的 skill。

## 边界
- 只读分析，**不下单**（trade-guard deny）。
- FX 为近似静态汇率（行为/占比度量足够，精确盈亏以券商对账单为准）。
- 长桥模拟盘账户不计入统一净值（数据不可信，见 ROADMAP 决策）。
