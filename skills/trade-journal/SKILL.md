---
name: trade-journal
description: "交易日志 + 复盘协议。3 操作：log（开仓/平仓）/ review（4 维评分 + mistake taxonomy）/ stats（胜率 / 盈亏比 / 按策略 / 按月度）。核心是 Pre-Mortem 5 题强制 + 8 类错误归类 + 周/月/季节奏。当用户要 log trade / review trade / 交易统计 / 复盘 时触发。支持美股/港股/A 股/加密/贵金属。"
required_tools: ["futuapi", "session_logs"]
---

> 行情数据源 / 中文输出规范 见 [`../references/shared-output-rules.md`](../references/shared-output-rules.md)
> 工具使用（CLI / YAML schema / 评分维度）→ [`references/tool-usage.md`](references/tool-usage.md)

# Trade Journal — 复盘决策协议

不是记账本，是 **复盘 → 提取 pattern → 不犯第二次同样的错**。

---

## 🚪 A. Pre-Mortem 5 题（开仓前**强制**）

`log` 命令的 `--thesis` 字段必须含 5 题。用户没写 → AI 主动问。

```yaml
pre_mortem:
  q1_drop_20pct: "如果今天就跌 20%，我加仓还是认错？"
  q2_failure_mode: "这笔最可能怎么死？"
  q3_info_edge: "我的'信息优势'是真的吗？还是 confirmation bias？"
  q4_kill_signal: "12 个月后哪个数据点会让我说'我错了'？"
  q5_conviction: "1-10 多少？(< 6 不开仓)"
```

**AI 行为**：
- conviction < 6 → 主动建议放弃
- q4（kill_signal）写"看情况"等模糊语 → 拒绝记录，要求具体化
- 自动同步到 `thesis-tracker`

---

## 🏷 B. Mistake Taxonomy（8 类错误）

每次 review 后 AI 自动归类。**同类错误第 2/3 次出现 → 警告**。

| 代码 | 名称 | 例子 |
|---|---|---|
| `M01` | **追高** | FOMO 突破后 +20% 才进 |
| `M02` | **摊低成本** | 亏损加仓救自己 |
| `M03` | **不设止损** | "我相信它会回来" |
| `M04` | **嘴硬止损** | 止损延后 / 实际价远低于计划 |
| `M05` | **过早止盈** | 1R 就跑，错过 5R |
| `M06` | **跳过 thesis** | 没写 thesis 就买（情绪驱动） |
| `M07` | **跳过 pre-mortem** | conviction 不足就开仓 |
| `M08` | **越界交易** | 不熟领域（散户做空 / 期权 / meme）|

### 重复警告输出

```
⚠ 90 天错误统计

M02 (摊低成本): 出现 3 次 ← 重复警告 ⚠⚠
  - TSLA 2026-02-14
  - NIO 2026-03-02
  - PLTR 2026-04-01
  → 行动建议：禁止亏损加仓 30 天

M07 (跳过 pre-mortem): 出现 2 次 ⚠
```

**AI 行为**：开仓时检测到最近 90 天某类错误 ≥ 3 次 → 主动提醒 + 建议禁止该类操作 30 天。

调用 → `trade_journal.py mistakes --since 90d`（详见 [`tool-usage.md`](references/tool-usage.md)）

---

## 📅 C. Review Cadence（复盘节奏）

### 每周日（自动 prompt）

`trade_journal.py weekly`

```
📊 上周复盘 (YYYY-MM-DD 至 YYYY-MM-DD)

✅ 关闭交易：N 笔（胜率 X/Y）
📝 4 维评分平均
🚨 错误：M0X × N
📌 本周课程：[管理偏弱 → 重点改进止损纪律]
🎯 下周计划：[ ]
```

### 每月 1 号（深挖）

`trade_journal.py monthly` 额外输出：
- 按策略胜率（哪个 strategy 真在赚钱）
- 按时段（早盘/盘中/尾盘哪个最好）
- 按持仓时长（短线/波段/中线）
- 错误 trend（哪类在减少/增加）

### 每季度（淘汰策略）

某 strategy 胜率 < 40% 且 N ≥ 10 → **暂停 30 天**

---

## 🤖 D. AI 主动行为

| 时机 | AI 行为 |
|---|---|
| 用户说"我要买 X" | 主动问 5 个 pre-mortem 题 |
| 用户说"X 平仓了" | 主动跑 review + mistake taxonomy |
| 周日 20:00 | 主动跑 weekly review（如开启 `/loop weekly`）|
| 检测 M0X ≥ 3 次 | 主动警告 + 建议禁该类操作 |

---

## 🔗 与其他 skill 的联动

```
trade-execution（开仓 5 道闸）
  ↓ thesis + pre-mortem 必填
trade-journal log（写入 YAML）
  ↓
thesis-tracker create（论点入库）
  ↓
[持仓中：thesis kill criteria 触发]
  ↓
trade-journal close + review（评分 + mistake tag）
  ↓
trade-journal weekly/monthly（统计 + 教训）
```

**与 thesis-tracker 区别**：
- thesis-tracker：投资论点有效性（长期持仓）
- trade-journal：具体交易进出场 + 执行质量（复盘）

---

## ⚠ 反模式（散户复盘最常犯的错）

1. **平仓不评分** → 3 个月后翻记录，不知是运气还是技术
2. **只评分赚钱 trade** → 亏损 trade 才最有信息量。5 笔赚的不如 1 笔亏的教得多
3. **不归因错误类型** → 重复 M02 三次自己都没发现
4. **跳过 pre-mortem** → 亏损后怪市场，其实开仓前就知道会怎么死
5. **只做周报不趋势分析** → 周报告诉你"发生了什么"，月度告诉你"在重复什么"

---

## 🎯 输出标准

- ✅ 开仓 → 用户感受："AI 像严格的 risk officer，逼我答完才让买"
- ✅ 平仓 → 用户感受："AI 立刻问我学到了什么"
- ✅ 周末 → 用户主动找 AI 周报（不是反过来）

## 📚 入知识库（周报/复盘产出后）

周报或行为复盘成稿后入库（kind=journal），让执行弱点/有效打法被未来对话语义召回：

```bash
bun run ~/nimbus-os/nimbus/scripts/kb-ingest.ts --kind journal --title "周复盘 2026-06-21" --file <report.md>
```
