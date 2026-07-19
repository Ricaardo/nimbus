# Trade Journal — 工具使用与 Schema

> SKILL.md 是复盘协议（Pre-Mortem + Mistake Taxonomy + Cadence）；本文档存放 CLI 调用、YAML schema、与其他工具的接口。

---

## CLI 4 大操作

### 1. Log（开仓记录）

```bash
# 多头开仓
python3 skills/trade-journal/scripts/trade_journal.py log \
  --ticker AAPL --entry-price 175 --size 100 \
  --strategy "breakout" --thesis "VCP breakout on earnings beat" \
  --tags "tech,momentum"

# 做空
python3 skills/trade-journal/scripts/trade_journal.py log \
  --ticker TSLA --entry-price 250 --size 50 --direction short \
  --strategy "breakdown" --thesis "Head & shoulders breakdown"

# 开仓同时记录平仓（已完成交易补录）
python3 skills/trade-journal/scripts/trade_journal.py log \
  --ticker MSFT --entry-price 400 --size 80 --entry-date 2026-03-01 \
  --exit-price 420 --exit-date 2026-03-10 --strategy "swing"
```

保存到 `reports/trades/{TICKER}_{ENTRY_DATE}.yaml`

### 2. Close（平仓）

```bash
python3 skills/trade-journal/scripts/trade_journal.py close \
  --ticker AAPL --entry-date 2026-03-01 \
  --exit-price 190 --exit-date 2026-03-15
```

自动计算盈亏金额和百分比。

### 3. Review（复盘）

```bash
python3 skills/trade-journal/scripts/trade_journal.py review \
  --ticker AAPL --entry-date 2026-03-01 \
  --entry-quality 4 --execution 3 --management 4 --result-score 5 \
  --mistake-tags M01,M07 \
  --review-notes "Entry timing good, could have sized up"
```

### 4. Stats（统计）

```bash
# 完整报告
python3 skills/trade-journal/scripts/trade_journal.py stats

# JSON
python3 skills/trade-journal/scripts/trade_journal.py stats --format json

# 保存
python3 skills/trade-journal/scripts/trade_journal.py stats --output reports/stats.json

# 周/月报
python3 skills/trade-journal/scripts/trade_journal.py weekly
python3 skills/trade-journal/scripts/trade_journal.py monthly

# 错误统计
python3 skills/trade-journal/scripts/trade_journal.py mistakes --since 90d
```

---

## 评分维度（1-5）

| 维度 | 1 分 | 3 分 | 5 分 |
|---|---|---|---|
| 进场质量 | 追高/无计划 | 有计划但时机一般 | 完美时机 + 明确计划 |
| 执行 | 偏离计划 | 基本按计划 | 严格执行 |
| 管理 | 无止损/过早平 | 基本风控 | 完善的止损/加仓/减仓 |
| 结果 | 大幅亏损 | 小赚小亏 | 显著盈利 |

---

## YAML Schema

```yaml
ticker: AAPL
direction: long
entry_date: "2026-03-01"
entry_price: 175.0
exit_date: "2026-03-15"
exit_price: 190.0
size: 100
strategy: breakout
thesis: "VCP breakout on earnings beat"
status: closed
pnl: 1500.0
pnl_pct: 8.57
tags: [tech, momentum]
lessons: "Should have added on first pullback"

# Pre-Mortem (开仓前必填)
pre_mortem:
  q1_drop_20pct: "..."
  q2_failure_mode: "..."
  q3_info_edge: "..."
  q4_kill_signal: "..."
  q5_conviction: 7

# Review
review:
  entry_quality: 4
  execution: 3
  management: 4
  result_score: 5
  avg_score: 4.0
  notes: "Entry timing good, could have sized up"
  reviewed_at: "2026-03-16T10:30:00"

# Mistake Taxonomy（如有）
mistakes:
  - code: M01
    note: "突破后第 2 天才进，已 +18%"
  - code: M07
    note: "没填 pre-mortem"
```

---

## 统计报告内容

- **总体**：胜率、盈亏比、利润因子、总盈亏
- **按策略**：每种 strategy 的胜率与盈亏
- **按月度**：月度表现 trend
- **最近 10 笔**：交易明细
- **复盘均值**：4 维评分平均
- **错误统计**：M01-M08 出现频次

---

## Prerequisites

- Python 3.9+（标准库）
- `pip install pyyaml`（可选，无 PyYAML 时使用内置简易解析器）
- 无 API key

---

## 完整交易闭环

```
1. research / stock-screener  → 发现候选
2. valuation + technical-analysis  → 分析确认
3. trade-execution（5 道闸 + position sizer + stop loss）
4. trade-journal log  ← 含 pre-mortem
5. thesis-tracker create  ← 论点入库
6. [持仓中：thesis kill criteria 触发]
7. trade-journal close + review  ← 含 mistake tag
8. trade-journal weekly / monthly  ← 教训提取
```

### 与 thesis-tracker 区别

- **thesis-tracker**：投资论点的有效性（长期持仓管理）
- **trade-journal**：具体交易的进出场 + 执行质量（交易复盘）

---

## 提示

- 平仓后 **24 小时内**完成复盘，避免记忆偏差
- 每周/每月跑 stats，检查交易系统是否仍有效
- 重复错误 ≥ 3 次 → 暂停该类操作 30 天
