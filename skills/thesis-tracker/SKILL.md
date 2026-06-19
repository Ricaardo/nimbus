---
name: thesis-tracker
description: "投资论点追踪与更新协议。维护持仓/观察名单的投资论点，追踪关键数据点、催化剂、论点里程碑，含 decay 检测与 90 天僵尸论点检测 + 价格对照 + 极端情况。当用户提到 'update thesis / thesis check / is my thesis still intact / add data point / 更新论点 / 论点是否还成立 / 论点追踪 / decay / 僵尸论点' 时触发。支持美股/A股/港股/加密货币/贵金属。"
required_tools: ["session_logs", "tavily"]
---

# Thesis Tracker

## Workflow（工作流）

### Step 1: Define or Load Thesis

If creating a new thesis:
- **Company**: Name and ticker
- **Position**: Long or Short
- **Thesis statement**: 1-2 sentence core thesis (e.g., "Long ACME — margin expansion from pricing power + operating leverage as mix shifts to software")
- **Key pillars**: 3-5 supporting arguments
- **Key risks**: 3-5 risks that would invalidate the thesis
- **Catalysts**: Upcoming events that could prove/disprove the thesis (earnings, product launches, regulatory decisions)
- **Target price / valuation**: What's it worth if the thesis plays out
- **Stop-loss trigger**: What would make you exit

If updating an existing thesis, ask the user for the new data point or development.

### Step 2: Update Log

For each new data point or development:

- **Date**: When this happened
- **Data point**: What changed (earnings beat, management departure, competitor move, etc.)
- **Thesis impact**: Does this strengthen, weaken, or neutralize a specific pillar?
- **Action**: No change / Increase position / Trim / Exit
- **Updated conviction**: High / Medium / Low

### Step 3: Thesis Scorecard

Maintain a running scorecard:

| Pillar | Original Expectation | Current Status | Trend |
|--------|---------------------|----------------|-------|
| Revenue growth >20% | On track | Q3 was 22% | Stable |
| Margin expansion | Behind | Margins flat YoY | Concerning |
| New product launch | Pending | Delayed to Q2 | Watch |

### Step 4: Catalyst Calendar

Track upcoming catalysts:

| Date | Event | Expected Impact | Notes |
|------|-------|-----------------|-------|
| | | | |

### Step 5: Output

Thesis summary suitable for:
- Morning meeting discussion
- Portfolio review
- Risk committee presentation

Format: Concise markdown or Word doc with the scorecard, recent updates, and current conviction level.

## Important Notes（重要提示）
 
- A thesis should be falsifiable — if nothing could disprove it, it's not a thesis
- Track disconfirming evidence as rigorously as confirming evidence
- Review theses at least quarterly, even when nothing dramatic has happened
- If the user manages multiple positions, offer to do a full portfolio thesis review
- Store thesis data in a structured format so it can be referenced across sessions
 
## ⚠ 反模式
- ❌ 只记录 confirming evidence，忽略 disconfirming data
- ❌ Thesis 无法被证伪（"AAPL 总会涨" 不是 thesis）
- ❌ 90天不更新，变成僵尸 thesis
- ❌ 存储格式混乱，无法跨 session 引用
- ❌ 没有明确的 stop-loss 触发条件
 
## 数据持久化（YAML Schema）

### Thesis YAML Schema

论点存储在 `reports/theses/` 目录下，每个标的一个 YAML 文件：

```yaml
# reports/theses/AAPL.yaml
ticker: AAPL
name: Apple Inc.
position: long
created: "2026-01-15"
last_updated: "2026-03-12"
conviction: high  # high/medium/low
thesis_statement: "Long AAPL — 服务收入高速增长 + AI 功能驱动换机周期"

pillars:
  - id: P1
    description: "服务收入占比提升，毛利率扩张"
    status: on_track  # on_track/behind/ahead/invalidated
    evidence:
      - date: "2026-01-30"
        event: "Q1 服务收入 $26.3B (+14% YoY)"
        impact: strengthens
  - id: P2
    description: "Apple Intelligence 驱动 iPhone 升级"
    status: watch
    evidence: []

risks:
  - id: R1
    description: "中国市场需求持续疲软"
    severity: medium
    status: active

catalysts:
  - date: "2026-04-24"
    event: "Q2 FY2026 Earnings"
    expected_impact: high

target_price: 245
stop_loss: 185
entry_price: 198
current_conviction_score: 78  # 0-100
```

### 操作指令

```bash
# 创建新论点
echo "创建 AAPL 论点" && mkdir -p reports/theses

# 更新论点（手动编辑 YAML 或通过对话更新）
# Claude 会自动读取/更新 reports/theses/TICKER.yaml
```

### 评分卡计算

| 维度 | 权重 | 评分规则 |
|------|------|---------|
| 支撑论据达成率 | 40% | on_track=100, ahead=100, watch=50, behind=25, invalidated=0 |
| 风险可控度 | 25% | 无 active 高风险=100, 有=根据严重性折扣 |
| 催化剂进展 | 20% | 已验证催化剂占比 |
| 价格位置 | 15% | 相对入场价和目标价的位置 |

综合评分 = 加权平均，<50 建议减仓/退出，50-70 维持，>70 可加仓

---

> 详见 [`references/shared-output-rules.md`](../references/shared-output-rules.md) — 中文输出规范、多市场 Ticker 识别、行情数据源优先级、Dashboard JSON 格式。

---

## 🧠 升级协议（2026-04-26）：Thesis Decay + 价格对照 + 自动复审

thesis-tracker 的价值不是存 YAML，是**检测 thesis 是活着还是死了**。以下 3 个协议让 AI 主动监控而非被动记录。

## A. Thesis Decay 检测（理论衰减）

任何 thesis **超过 90 天未更新 → 自动标记 decayed**，下次用户提到该 ticker 时 AI 主动提醒：

```
⚠ AAPL thesis 已 120 天未更新 — 你还记得为什么买它吗？
```

### Decay 等级

| 最后更新 | 状态 | AI 行为 |
|---|---|---|
| < 60 天 | 🟢 Active | 正常 |
| 60-90 天 | 🟡 Stale | 轻提醒 |
| 90-180 天 | 🟠 Decayed | 主动重审建议 |
| > 180 天 | 🔴 Zombie | "要么更新要么清仓" |

### 自动重审触发条件（OR）

Thesis 进入 🟠 Decayed 时，AI 应该：

1. 拉最新 financials（valuation）
2. 拉最新价格 + chart（market-data + technical-analysis）
3. 检查 catalysts calendar 中哪些已过期 / 哪些发生了
4. 重新打分（用下方 Scorecard）
5. 输出：thesis 仍然成立 / 部分失效 / 完全失效

## B. Thesis 实现度 vs 价格对照

这是**区分"市场错"还是"论点错"的核心工具**：

```
Thesis 实现度       vs        股价变动
    ↑                           ↑
论点实现 60%          股价 -25% → 是市场错杀？→ 加仓机会
论点实现 60%          股价 +50% → 是泡沫？→ 减仓
论点实现 10%          股价 -30% → 是论点错了 → 止损
论点实现 90%          股价 +30% → thesis playing out → 持有
```

### 对照表模板（每次季度复盘必填）

```yaml
thesis_vs_price:
  date: "2026-04-26"
  thesis_progress_pct: 60  # 主观判断论点实现了多少
  price_change_pct: -25    # 从入场价
  verdict: bull_correction # 选项见下方
```

**verdict 枚举**：
- `on_track` — thesis 进展正常，价格跟进
- `bull_correction` — thesis 进展好但价格跌（买入机会）
- `bear_trap` — thesis 进展差但价格涨（减仓信号）
- `failed` — thesis 进展差且价格跌（止损）
- `mania` — thesis 进展差但价格暴涨（泡沫，全部止盈）

**AI 行为**：
- `bull_correction` → 建议检查是否加仓（用 trade-execution 5 道闸）
- `bear_trap` → 建议立即重审，可能 thesis 有盲点
- `failed` → 建议退出，不要"再等等"

## C. Position-Thesis 联动（价格触发器）

持仓价格出现以下偏差时，**自动触发 thesis review**（不是止损，是复审）：

| 触发条件 | AI 行为 |
|---|---|
| 涨 +20% in 5 days | 问：有我不知道的催化吗？是否需要部分止盈？ |
| 跌 -20% | 强制执行 thesis vs price 对照表 |
| 涨 +50% | 强制检查 valuation（泡沫？） |
| 跌 -50% | 强制执行 kill criteria 检查 |
| 30 天无任何更新 | 轻提醒 |

## D. 多 Thesis 组合视图

当用户管理 ≥ 3 个活跃 thesis 时，AI 在每个周末自动提供组合级视图：

```
📊 Thesis 组合健康度 — 2026-04-26

🟢 Active (3): AAPL (78)、NVDA (82)、MSFT (75)
🟡 Stale (1): GOOGL (65) — 78 天未更新
🔴 Zombie (1): PLTR (40) — 185 天未更新，建议清仓

平均 conviction: 68/100
需要重审: 2 (GOOGL、PLTR)
下次集体复盘: 2026-05-01
```

**AI 行为**：如果有 zombie thesis → 主动 push 用户决定（update or exit），不要默默留着。

## E. 极端情况处理

| 事件 | thesis 状态 | 行动 |
|---|---|---|
| 标的退市/delisting | 自动 → `failed` | 立即平仓 + trade-journal 记录错误分类 |
| 标的停牌 | 冻结 → 等复牌 | 停牌 > 30 天 → 标记 zombie，提醒用户 |
| 标的破产 | 自动 → `failed` | thesis kill criteria 强制触发 |
| 标的被收购 (cash) | 自动 → `on_track` | 记录收购价 vs thesis target，评分 |
| 标的被收购 (stock) | 需要新 thesis | 新标的的 business + valuation 需重新评估 |
| 分红/拆股 | 不影响 thesis | 更新 entry_price 基准 |
| 增发稀释 10%+ | 下调 conviction | 稀释 = management 对自己股价不敏感 |
| CEO/CFO 突然离职 | 强制重审 | 管理团队变化 = thesis 可能已变 |

**AI 行为**：上述任何事件发生时，主动触发 thesis review + 建议 trade-journal 记录。

## 📚 入知识库（thesis 创建/重大更新后必做）

新建 thesis 或里程碑式更新后，入库（kind=thesis），让未来对该标的的分析自动召回历史论点与 decay 轨迹：

```bash
bun run ~/nimbus-stack/nimbus/scripts/kb-ingest.ts --kind thesis --ticker CRCL --title "CRCL 多头论点" --file <thesis.md>
```

弱依赖，失败不阻塞主流程。
