# Sector Rotation — 详细工作流 + 输出模板

> SKILL.md 是 4 模式决策协议；本文档存放 Sector Rotation 模式的 Step 1-5 详细执行 + Markdown 输出模板。

---

## Workflow（5 步）

### Step 1: CSV 数据采集

```bash
python3 skills/sector-analyst/scripts/analyze_sector_rotation.py
# JSON: --json
# 保存: --save --output-dir reports/
```

数据源：TraderMonty 公开 GitHub CSV（无 API key）
- `sector_summary.csv` — uptrend ratio / trend / slope / status
- `uptrend_ratio_timeseries.csv` — 时间戳，验证数据新鲜度

提取：
- Sector ranking by uptrend ratio
- Risk regime（cyclical vs defensive）+ score
- Overbought / oversold sectors
- Cycle phase estimate + confidence

如有 freshness warning，标注。

### Step 2: 市场周期评估

读 `references/sector_rotation.md` 的市场周期 + sector rotation 框架，对照脚本输出。

| 周期阶段 | 典型 leading 板块 |
|---|---|
| Early Cycle Recovery | 金融、可选消费、工业 |
| Mid Cycle Expansion | 科技、工业、材料 |
| Late Cycle | 能源、材料、房地产 |
| Recession | 必需消费、医疗、公用 |

如用户提供图表，补充行业级细节：
- 1w vs 1m 表现一致性
- 板块内部哪些行业领涨/落后

### Step 3: 当前定位

- 当前最像哪个 cycle phase
- 支持证据（哪些 sector/industry 确认）
- 矛盾信号或异常
- Confidence level（基于信号一致性）

数据驱动语言，引用具体表现数字。

### Step 4: 场景推演

基于 sector rotation 原则，给 2-4 个下阶段场景：

每个场景：
- 描述周期转换
- Outperformers
- Underperformers
- 催化剂/确认条件
- 概率（见下方 framework）

按概率排序，最可能 → 反向/对立。

### Step 5: 输出 Markdown

`sector_analysis_YYYY-MM-DD.md`，结构见下方。

---

## Output Template

```markdown
# Sector Performance Analysis - [Date]

## Executive Summary
[2-3 句关键发现]

## Current Situation

### Market Cycle Assessment
[哪个 phase + 为什么]

### Performance Patterns
#### 1-Week Performance
[近期表现]

#### 1-Month Performance
[中期 trend]

#### Sector-Level Analysis
[各板块详细]

#### Industry-Level Analysis
[行业层面观察]

## Supporting Evidence

### Confirming Signals
- [支持周期判断的数据]

### Contradictory Signals
- [冲突指标]

## Scenario Analysis

### Scenario 1: [Name] (Probability: XX%)
**Description**: [发生什么]
**Outperformers**: [Sectors/industries]
**Underperformers**: [Sectors/industries]
**Catalysts**: [确认条件]

### Scenario 2: [Name] (Probability: XX%)
[同结构]

## Recommended Positioning

### Strategic（中期）
[Sector 配置]

### Tactical（短期）
[具体调整]

## Key Risks and Monitoring Points
[可能推翻分析的因素]

---
*Analysis Date: [Date]*
*Data Period: [Timeframe]*
```

---

## Probability Framework

| 概率 | 证据强度 |
|---|---|
| **70-85%** | 强证据，多板块多时间窗确认 |
| **50-70%** | 中等，部分确认但混合指标 |
| **30-50%** | 弱证据，有限或冲突信号 |
| **15-30%** | 投机性，与当前指标相反但可能 |

所有场景概率合计 ≈ 100%。

---

## 分析原则

1. **Objectivity First** — 数据导出结论，非预设
2. **Probabilistic Thinking** — 用概率区间表达不确定性
3. **Multiple Timeframes** — 1w + 1m 双确认
4. **Relative Performance** — 关注相对强度，非绝对回报
5. **Breadth Matters** — 广泛轮动 > 孤立移动
6. **No Absolutes** — 市场很少完美对齐教科书
7. **Historical Context** — 参考典型 pattern，但承认独特性

---

## 触发场景

- "Run a sector rotation analysis"
- "Which sectors are leading — cyclical or defensive?"
- "Are any sectors overbought right now?"
- "What phase of the market cycle are we in?"
- 用户提供 sector performance 图表
- "Sector-based scenario analysis"

---

## Resources

| 文件 | 内容 |
|---|---|
| `scripts/analyze_sector_rotation.py` | CSV 抓取 + ranking + regime + cycle phase |
| `references/sector_rotation.md` | 周期阶段 + 典型板块 + 概率框架知识库 |
| `assets/sector_performance.jpeg` | 示例图表（图片分析的输入参考）|
| `assets/industory_performance_*.jpeg` | 行业级图表示例 |

---

## 注意事项

- 分析思考用英文
- 输出 Markdown 用英文
- 每次分析都要参考 sector_rotation.md
- 保持客观，避免 confirmation bias
- 新数据来时更新概率
- 图表可选；CSV 数据是主要输入
- 脚本沿用 uptrend-analyzer 的 sector classification
