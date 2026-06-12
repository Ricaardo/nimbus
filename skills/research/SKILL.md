---
name: research
description: "投资研究协议（合并 idea-generator + scenario-analyzer）。5 模式：(1) Systematic — 量化筛选 + 主题研究；(2) Narrative — 8 节标准研报；(3) Hypothesis — 可证伪假设 + kill criteria；(4) Scenarios — 新闻 → 一/二/三次影响 18 个月推演 + 受益/受损标的；(5) Regime — 市场牛熊状态定性分析（信用/流动性/资金流/风险偏好/宽度/跨资产/历史类比 7 维）。当用户提到'选股/找标的/idea/研报/narrative/可证伪假设/hypothesis/新闻分析/场景分析/scenario/18 个月展望/X 事件对市场影响/牛市熊市/market regime/市场状态/risk-on off'时触发。NOT for: 仅看新闻列表/龙虎榜/资金流向 → news-dashboard（无推演）；纯量化筛选（CANSLIM / 趋势打分 / 配对）→ stock-screener；个股标准分析 → us-stock-analysis；定量 MHS 评分 → market-pulse。"
required_tools: ["websearch", "tavily", "context7"]
---

# 投资研究 — 决策协议

不是写报告的模板，而是**约束 AI 思考过程的协议**：先想"这个研究的 falsification 条件"再下笔，否则就是叙事故事。

## 🔧 通用 4 步流程

### Step 1: 分类
按用户输入形态选模式：

| 用户输入 | 模式 | 输出 |
|---|---|---|
| 给定 ticker（如 NVDA） | **Systematic** 或 **Narrative** | 候选篮 / 深度研报 |
| 给定主题（如 "AI 基础设施") | **Systematic** | 5-10 候选 + 排序 |
| 给定 hypothesis（如 "做空 IWM") | **Hypothesis** | claim + kill criteria |
| 给定新闻标题 | **Scenarios** | 18m 推演 + 标的篮 |
| "牛市还是熊市" / "市场什么状态" / "risk-on/off" | **Regime** | 牛/熊/过渡 + 7 维证据 + 策略映射 |

### Step 2: 数据预取
- **Systematic** → 调 `stock-screener`（量化筛）+ `valuation`（基本面拉）
- **Narrative** → 调 `valuation` + `market-data` + `sector-analyst`
- **Hypothesis** → 调相关 evidence skill（看 hypothesis 涉及什么）
- **Scenarios** → 调 `news-dashboard` + `market-pulse`（看当前环境）
- **Regime** → 调 `market-pulse`（MHS 定量锚） + `sector-analyst`（板块轮动） + `news-dashboard`（宏观叙事）

### Step 3: 跑模式协议（见下方）

### Step 4: 输出 + 必须包含 Kill Criteria

**任何研究输出都必须有 Kill Criteria**——什么情况下我会承认这个研究错了。无 kill criteria = 不是研究，是故事。

---

## 模式 1: Systematic — 量化筛选 + 主题候选

**触发**：用户给主题或想批量找候选

**协议**：
1. **筛选标准量化**（不要"质优 + 估值合理"这种废话）
   - 例：`ROIC > 15% AND PE < 25 AND Rev YoY > 10% AND Debt/EBITDA < 3`
2. 调 `stock-screener` 跑筛
3. **候选排序**（≥ 5 个候选时必须排序）：用 1 个综合评分（如 quality × valuation × momentum）
4. **去伪**：剔除明显有问题的（财务造假嫌疑、退市风险、流动性差）
5. 输出 Top 5-10 + 每个一句话理由

**输出格式**：
```
🎯 [主题/筛选条件] — Systematic 候选

筛选标准：[量化规则]
全市场命中：X 只
排序后 Top 10：

1. TICKER1 — 一句话理由（核心 metric: X）
2. TICKER2 — ...
...

📌 后续验证（点选 1-3 只用 narrative 模式深挖）：
- 用 valuation 算合理估值
- 用 technical-analysis 看入场点
- 用 thesis-tracker 写论点
```

---

## 模式 2: Narrative — 标准研报（8 节模板）

**触发**：用户要"深度研报"或给单个 ticker 让做研究

**8 节强制结构**（少一节都不算 narrative report）：

```
1️⃣ Thesis（核心论点）
   - 一句话 thesis（≤ 30 字）
   - 3 个支柱（pillars）每个一句话

2️⃣ Numbers（关键数字）
   - 历史 5 年：Rev / EBIT / FCF / ROIC 趋势
   - 我的预测 3 年：Rev YoY / Margin / FCF
   - vs 卖方共识：高于 / 一致 / 低于

3️⃣ Catalysts（12-24 月催化）
   - 必须可命名（"Q3 财报"、"产品发布"、"FOMC"）
   - 不要写"市场认知改善"这种空话

4️⃣ Risks（主要风险，3-5 个 + 各自概率）
   - 每个风险 + 我的概率估计 + 影响 scale
   - 必须包括 1 个 "我可能错的最大原因"

5️⃣ Valuation（合理估值）
   - 至少 2 种方法（DCF + 相对估值）
   - 输出 fair value range（最低 - 最高）
   - 当前价 vs 区间 → 折溢价 %

6️⃣ Scenarios（三场景）
   - Bull / Base / Bear，各自概率
   - 每场景对应价格目标
   - Expected value = Σ(prob × price)

7️⃣ Position Sizing（仓位建议）
   - Kelly 公式或固定 %（参考 trade-execution）
   - 集中度 vs 分散度建议

8️⃣ Kill Criteria（失效条件）⚠ 必填
   - 哪 3 件事发生 → 我会全部清仓
   - 哪 1 个数据点 → 我会减仓 50%
   - 多久没有催化 → 我会重审
```

---

## 模式 3: Hypothesis — 可证伪交易假设

**触发**：用户问"X 是不是值得做空"、"我有个想法..."、"做这个对不对"

**协议**：把模糊想法拍扁成结构化 hypothesis：

```
🧪 Hypothesis: [一句话 claim，必须可证伪]

例：
✅ "ARKK 在未来 6 个月跑输 SPY ≥ 10%（因为 small-cap growth 在高利率环境下贴现率敏感）"
❌ "ARKK 不行了" — 不可证伪，没时间窗口

🔍 Why now（为什么是现在 not 1 年前）
- [触发因素 1]
- [触发因素 2]

📊 Evidence
支持证据：
- [data 1]
- [data 2]
反对证据（必须找 ≥ 2 条）：
- [反方观点 1]
- [反方观点 2]

⚠ Kill Criteria（这些发生 → 我承认错）
1. [指标 X] 反向（如 long-rate 跌破 4%）
2. [事件 Y] 发生（如 Fed pivot dovish）
3. 6 个月后未到目标且无明显进展

⚖ Position
- 仓位：[X% portfolio]
- 工具：直接做空 / put / pair trade
- 持有期：[time horizon]
- Stop loss：[level / drawdown 触发线]

📈 Expected Outcome
- 成功 → [+X%]
- 失败 → [-Y%]
- 不对称 = X / Y = [需 ≥ 2 才值得]
```

**宏观版 Hypothesis 模板**（当 hypothesis 涉及市场状态转变时使用）：

```
🌐 Macro Hypothesis: [市场状态转变 claim，必须可证伪]

例：
✅ "未来 6 个月内将从 risk-off 转入 risk-on（信用利差收窄 + EM 跑赢 DM + 高 beta 领涨）"
❌ "市场要变好了" — 不可证伪

📍 当前 Regime：[牛/熊/过渡 — 来自 Regime 模式]
🎯 目标 Regime：[描述转变后的状态]

📊 触发条件（什么会让我相信这个转变在发生）
1. [指标 1 + 阈值] 例：HY-IG spread 从 450bp 缩到 < 350bp
2. [指标 2 + 阈值]
3. [指标 3 + 阈值]

⏱ 时间框架
- 最早可能在 [X 月] 确认方向
- 最晚如果 [Y 月] 仍未触发 → hypothesis 大概率错了

⚠ Kill Criteria (宏观版)
1. [信用事件 / 政策突变] — 例：Fed 意外加息 → hypothesis 立刻失效
2. [3 个触发条件中 2 个反向] — 例：利差扩大 + EM 跑输 → 承认错
3. [时间窗口到了但方向未现] — 例：6 个月后仍无 risk-on 迹象

🔗 联动
- 输入 `market-pulse` 的 MHS 趋势交叉验证
- 输入 `sector-analyst` 的板块轮动确认
```

---

## 模式 4: Scenarios — 新闻 → 18 月推演

**触发**：用户给新闻标题，问"对市场什么影响"

**协议**：

```
📰 News: [新闻原文]

🌊 一次影响（直接受冲击的）
- 受益：[标的 + 一句话理由]
- 受损：[标的 + 一句话理由]
- 时间窗：T+0 到 T+5 day

🌊🌊 二次影响（一次的连锁反应）
- 例：能源价格上涨（一次）→ 通胀预期上调（二次）→ 长债下跌
- 受益：[...]
- 受损：[...]
- 时间窗：T+1 week 到 T+3 month

🌊🌊🌊 三次影响（反身性 + 政策回应）
- 例：通胀上调（二次）→ Fed 鹰派（三次）→ growth stocks 重估
- 受益：[...]
- 受损：[...]
- 时间窗：T+3 month 到 T+18 month

📊 概率 × 影响矩阵
| 影响层 | 概率 | 影响幅度 | 期望值 |
|---|---|---|---|
| 一次 | 高 | 中 | 中 |
| 二次 | 中 | 高 | 高 |
| 三次 | 低 | 极高 | 不确定 |

🎯 推荐 actions
- 立即（high conviction）：[1-2 个]
- 监控（中 conviction）：[2-3 个 + 触发条件]
- 反向（contrarian play）：[1 个]

📅 时间轴里程碑（按阶段可验证的 checkpoint）
| 时间窗 | 关键 observation | 若发生→推演在轨道上 | 若不发生→推演可能偏离 |
|---|---|---|---|
| 0-3 月 | [具体可观察事件/数据] | [确认信号] | [偏离信号] |
| 3-6 月 | [...] | [...] | [...] |
| 6-12 月 | [...] | [...] | [...] |
| 12-18 月 | [...] | [...] | [...] |

🔍 市场叙事诊断
- 当前共识：[市场在讲什么故事]
- 我的推演与共识的差异：[如果不同→alpha 来源]

⚠ Kill Criteria
- [news 后续发展中哪些信号 → 这个推演失效]
```

---

## 模式 5: Regime — 市场牛熊状态分析 ⭐ NEW

**触发**：用户问"现在是牛市还是熊市"、"市场什么状态"、"risk-on 还是 risk-off"、"宏观环境怎么样"

**注意**：这是**定性叙事推演**，与 `market-pulse`（定量 MHS 评分→仓位%）互补——MHS 给数字，Regime 给故事。

**协议**：

```
🔭 Regime 判断: [牛市中期 / 牛市末期 / 熊市初期 / 熊市末期 / 过渡]

### 证据框架（7 维度）

#### 1. 信用周期
- HY-IG 利差：[当前 bp vs 历史分位] → 信用扩张/收缩
- 银行贷款标准：[收紧/放宽] → 领先 6-12m
- 企业债发行：[活跃/冻结]

#### 2. 流动性环境
- Fed 资产负债表：[扩表/QT/持平]
- 实际利率 10Y：[值 + 方向] 
- M2 YoY：[值 + 方向]
- 金融条件指数：[宽松/中性/收紧]

#### 3. 资金流
- 股票 ETF 流量：[流入/流出 + 幅度]
- 债券基金流量：[流入/流出]
- 货币市场基金规模：[上升 = 避险，下降 = 风险偏好回归]

#### 4. 风险偏好
- VIX 期限结构：[contango (正常) / backwardation (恐慌)]
- EM vs DM 相对强弱：[EM 跑赢 = risk-on]
- 高 beta vs 低波动：[高 beta 领涨 = risk-on]

#### 5. 市场宽度（仅美股）
- SPX % above 50MA / 200MA
- 新高 vs 新低比
- 行业参与率

#### 6. 跨资产确认
- 股债相关性：[正相关(通胀regime) / 负相关(增长regime)]
- 美元方向：[走强(避险) / 走弱(risk-on)]
- 黄金 vs 铜：[金涨铜跌 = 衰退交易；金跌铜涨 = 复苏交易]

#### 7. 历史类比
- 当前最接近 [YYYY-MM 的 XX 阶段]
- 那次之后 12m 发生了什么
- 关键不同点（别简单套用）

### 策略映射
- 牛市早期：进攻型配置，趋势跟随，容忍波动
- 牛市中期：趋势跟踪 + 板块轮动（周期→成长→防御）
- 牛市末期：收紧止损，降低 beta，关注分配信号
- 熊市初期：现金为王，禁止新开仓
- 熊市末期：准备购物清单，关注 FTD/底部信号
- 过渡：轻仓试探，等确认

### 市场叙事诊断
- **当前共识**：[一句话]
- **叙事与指标的矛盾**：[如果指标开始偏离叙事 → 这是 alpha 来源]

⚠ Kill Criteria
- 如果 [3 个关键指标] 同时反向 → regime 判断错误
- 如果 [信用事件/政策转向] → 重新评估
```

**联动**：Regime 判断 → 输入 `trade-execution`（调整仓位上限） + `portfolio-manager`（调整配置）。

---

## 🔁 跨模式工作流（典型组合）

**完整研究流程**（从主题到落地）：
```
1. 主题来了 → Systematic 模式产 10 候选
2. 选 3 个最强 → Narrative 模式深度研报
3. 1 个最确信 → Hypothesis 模式拍扁假设
4. 用 valuation 算合理价格
5. 用 trade-execution 算仓位 / 止损
6. 用 thesis-tracker 写下 thesis + kill criteria
7. 入场 → trade-journal 记录 + pre-mortem
```

## ⚠ 反模式

- ❌ 写 narrative 但没有 kill criteria → 是故事不是研究
- ❌ Hypothesis 不可证伪（"长期看好"） → 没法判错没法学习
- ❌ Scenarios 只写一次影响 → 二三次才是 alpha source
- ❌ Systematic 筛但不排序 → 候选篮就是噪音
- ❌ 任何模式不写 evidence against → 是 confirmation bias
- ❌ Regime 纯靠指标不给叙事 → 是数据报告不是判断
- ❌ Regime 不给策略映射 → 判断牛熊却不告诉用户"然后呢"

## 🔗 与其他 skill 的联动

research 是"idea 工厂"——产出流入估值→执行→跟踪链。

| 触发 | 联动 skill | 做什么 |
|---|---|---|
| Systematic 产出候选篮 | `valuation` + `technical-analysis` | 对 Top 3 做估值+技术复检 |
| Narrative 研报完成 | `trade-execution` | 按研报建议仓位执行 |
| Hypothesis 生成 | `thesis-tracker` | 写入 thesis + kill criteria |
| Scenarios 推演 | `event-calendar` | 对照催化日历调整时间假设 |
| Regime 牛熊判断 | `market-pulse` + `trade-execution` + `portfolio-manager` | MHS 定量锚 + 调整仓位上限 + 调整组合配置 |
| Regime (BTC) | `btc-guanfu` | BTC 专用牛熊读盘，观复 8 域 vs Regime 7 维交叉验证 |

## 📂 References

- `ideas/` 系统筛选 + 主题研究模板（来自 idea-generator）
- `scenarios/` 场景推演方法论（来自 scenario-analyzer）
