---
name: sector-analyst
description: "板块/行业/主题/大宗 4 合一分析。4 模式：(1) 板块轮动 — TraderMonty 量化周期；(2) 行业深度 — TAM/竞争/价值链；(3) 主题叙事 — bullish/bearish 生命周期；(4) 大宗能源 — 原油/铜/黄金/天然气 供需-库存-地缘框架。当用户问'板块轮动/sector rotation/行业分析/industry deep dive/热门主题/narrative/thematic/原油/能源/铜/天然气/commodity/oil'时触发。NOT for: 黄金/白银 NAV 或 real yield 估值 → 用 valuation（贵金属模式）；个股层面 → us-stock-analysis。"
required_tools: ["tavily", "websearch"]
---

> 行情数据源 / 中文输出规范 见 [`../references/shared-output-rules.md`](../references/shared-output-rules.md)

# Sector Analyst — 决策协议

不是 4 个孤立工具，是**先识别问的是哪类问题 → 选模式 → 跑框架**。

---

## 🎯 4 模式选择

| 用户问 | 模式 | 工具 |
|---|---|---|
| "板块在轮动吗" / "cyclical vs defensive" / "市场周期" | **1. Sector Rotation** | TraderMonty CSV 脚本 |
| "X 行业怎么样" / "industry deep dive" / "TAM 多大" | **2. Industry Deep Dive** | 定性框架 |
| "现在什么主题热" / "AI / 国防 / 能源转型 narrative" | **3. Theme/Narrative** | themes/ scripts |
| "原油 / 铜 / 黄金 / 天然气" | **4. Commodities/Energy** | 供需-库存-地缘框架 |

---

## 📊 1. Sector Rotation

```bash
python3 skills/sector-analyst/scripts/analyze_sector_rotation.py
```

输出：
- Sector ranking by uptrend ratio
- Risk regime（cyclical vs defensive）+ score
- Overbought / oversold flags
- Cycle phase estimate + confidence

### 周期 → 典型板块速查

| Phase | Leading sectors |
|---|---|
| Early Recovery | 金融、可选消费、工业 |
| Mid Expansion | 科技、工业、材料 |
| Late Cycle | 能源、材料、房地产 |
| Recession | 必需消费、医疗、公用 |

详细 5 步流程 + 输出模板 + 概率框架 → [`references/rotation-workflow.md`](references/rotation-workflow.md)

---

## 🏭 2. Industry Deep Dive（任意市场）

适用：美股/A股/港股/加密的行业深度报告。

### 5 步框架

1. **Scope** — sector / 深度 / angle / universe（仅上市 vs 含私有）
2. **Market Overview** — TAM + 5Y CAGR / 细分 / 集中度（top 5 share） / 价值链 / 商业模式 / 进入壁垒
3. **Competitive Landscape**
   ```
   Company | Revenue | Growth | EBITDA% | Share | Differentiator
   ```
   每家：业务描述 + 战略护城河 + 近期动态 + 估值（PE / EV/EBITDA / EV/Rev）
4. **Valuation Context** — 行业倍数 vs 历史 / 溢价驱动 / M&A 倍数
5. **Investment Implications** — 最佳风险回报 / 主题表达 / 多空争论 / 催化剂

输出：市场概览 + 竞争地图 + 公司对比表 + 估值摘要 + 关键图表（增长瀑布 / 竞争矩阵 / 估值散点）

---

## 🌊 3. Theme / Narrative Detection

```bash
python3 skills/sector-analyst/themes/scripts/<script>.py
```

跨板块识别：
- Trending themes（AI / 国防 / 黄金 / 能源转型...）
- Bullish vs Bearish 叙事
- 主题生命周期：**萌芽 → 扩散 → 狂热 → 退潮**
- 热点 vs 冷点轮动

**与板块/行业模式的区别**：
- 板块/行业 = SIC/GICS 标准（11 大行业）
- 主题 = 跨行业故事线（"AI 基础设施"横跨半导体 / 云计算 / 电力）

---

## 🛢 4. Commodities / Energy

### 原油 — 3+1 因子

| 因子 | 关键指标 | 数据源 |
|---|---|---|
| **供给** | OPEC+ 产量、EIA 周库存、Baker Hughes 钻井 | EIA / OPEC MOMR |
| **需求** | 全球 GDP、中国原油进口、航空/运输 | IEA OMR |
| **地缘** | 中东/俄乌/委内瑞拉 中断风险 | news-dashboard |
| **库存** | Cushing/NYMEX 交割地趋势 | EIA Weekly |

**快速判断**：
```
库存 ↓ + 需求 ↑ + OPEC 不增产 = 🟢 做多
库存 ↑ + 需求 ↓ + OPEC 要增产 = 🔴 做空/回避
库存 ↓ + 地缘风险 ↑       = 🟠 极端波动，散户不宜
```

### 散户参与工具（按风险）

| 工具 | 风险 | 费率 | 适合 |
|---|---|---|---|
| XLE（能源 ETF） | 🟢 低 | 0.09% | 长期看好能源 |
| USO（原油 ETF） | 🟡 中 | 0.60% | 直接赌油价 |
| /CL（原油期货） | 🔴 高 | 保证金 $6K | 期货老手 |

**散户陷阱**：
- ❌ USO contango roll cost：油价横盘 USO 阴跌（年损 5-15%）
- ❌ 能源股 ≠ 油价：油价 +10%，XOM 可能 +3% 或 +15%（看对冲策略）
- ❌ 不追新闻头条：从"沙特要减产"到"油价涨"有 1-3 个月滞后

### 其他大宗速查

| 商品 | 核心驱动 | 工具 | 关键数据 |
|---|---|---|---|
| **黄金** | Real yield / 美元 / 央行购金 | GLD / IAUM / 实物 | COMEX COT、Fed |
| **铜** | 中国基建/地产、全球 PMI、供给 | CPER | LME 库存、TC/RC |
| **天然气** | 天气（HDD/CDD）、LNG 出口、库存 | UNG / NG 期货 | EIA Weekly NatGas |
| **农产品** | ENSO / 种植面积 / 库存 | DBA | USDA WASDE 月度 |

**散户大宗原则**：
- 商品 ≠ 股票：无 earnings、不能 DCF；供需 + 库存 + 展期 = 全部回报
- ETF ≠ 期货：有 contango 损耗 + tracking error
- 最佳参与方式：相关股票（XLE 做能源 / NEM、GOLD 做金矿），而非裸做期货

---

## 🔗 与其他 skill 的联动

| 触发 | 联动 | 做什么 |
|---|---|---|
| Sector rotation 完成 | `market-pulse` | 周期判断 + MHS 一致性 |
| 个股属于某板块/主题 | `us-stock-analysis` | 上下文补齐 |
| 主题/行业筛候选 | `research`（Systematic） | 量化筛 + 排序 |
| 原油 / 地缘紧张 | `market-pulse` 模块 9 | 地缘风险评分 |
| 黄金 real yield | `market-pulse` 模块 10 | 债券/TIPS 联动 |
| 铜 / 工业金属 | `market-pulse` 模块 2 | 宏观周期（铜=领先） |
| 黄金 NAV / 估值 | `valuation`（贵金属模式） | NAV / Real yield 模型 |

---

## ⚠ 反模式

- ❌ 不分模式直接跑 sector rotation 脚本 → 用户问"原油"也跑 CSV
- ❌ Industry deep dive 没竞争对比表 → 单一公司 ≠ 行业分析
- ❌ Theme 没生命周期判断 → 在"狂热"期推荐进场
- ❌ Commodity ETF 等同期货推荐 → 用户买 USO 后才发现 contango 损耗
- ❌ 不区分 sector vs theme → "AI" 当 sector 推（实际跨多板块）
