---
name: valuation
description: 估值工具集（合并 fundamentals + DCF + 3-statement model）。4 种模式：(1) 财务数据 — Yahoo/SEC 拉取财报、Piotroski F-Score、5 类财务比率；(2) DCF 模型 — WACC/自由现金流投影/敏感性分析/Excel 输出；(3) 三表模型 — IS/BS/CF 模板填充与勾稽；(4) 贵金属估值 — Real yield/美元/央行购金/投机仓位 4 维框架 + 金矿股 NAV 估值。当用户询问'基本面/财务/financials'、'估值/DCF/intrinsic value/WACC'、'三表/IS/BS/CF model'、'PE/PB/ROE/ROIC/Piotroski'、'内在价值/合理估值'、'黄金/贵金属/白银/gold/silver/precious metals'时触发。支持美股/港股/A股。
required_tools: ["yfinance", "futuapi", "tavily", "stock-data"]
---

# 估值 — 决策协议

不是算个数就完了，是**选对方法 → 规范假设 → 标准输出 → 安全边际判断**。

---

## 🔀 Step 1: 估值方法选择树

不是每家公司都适合 DCF。**选错方法比算错数字更致命**。

| 公司类型 | 首选方法 | 次选 | 不能用的方法 |
|---|---|---|---|
| 稳定盈利（消费、医疗） | **DCF** | PE + PEG | — |
| 高增长科技（SaaS、平台） | **EV/Sales + DCF** | PEG | PE（无盈利） |
| 银行 / 保险 | **P/B + ROE** | 股利贴现 (DDM) | DCF（银行 CAPEX 无意义） |
| REIT / 基建 | **NAV + AFFO 倍数** | DDM | DCF |
| 周期性（矿业、化工、航运） | **反向 PE + EV/EBITDA** | Mid-cycle P/B | DCF（周期 peak/trough 会偏） |
| 资源型（油、气、矿） | **NAV + EV/Reserves** | EV/EBITDA | DCF |
| 早期 / 无盈利 | **EV/Sales + TAM 渗透** | DCF（极高不确定） | PE、PEG |
| 高负债 / 破产风险 | **EV/EBITDA + Liquidation Value** | — | DCF（terminal value 假设不可靠） |
| 指数 ETF | **PE + Earnings Yield vs Bond** | — | DCF |

### 快速选择流程

```
公司盈利吗？
 ├─ 是 → 盈利稳定吗？
 │       ├─ 是 → DCF + PE + PEG
 │       └─ 否 (周期) → 反向 PE + EV/EBITDA
 └─ 否 → 有收入吗？
         ├─ 是 → EV/Sales + TAM
         └─ 否 → TAM 渗透 + 可比并购
```

---

## 📐 Step 2: DCF 假设规范

DCF 的核心不是计算，是**假设的合理性**。以下参数不是可调的——调了就不是估值了。

### Risk-Free Rate

| 市场 | 用哪个 | 当前参考 |
|---|---|---|
| 美股 | 10Y UST | ~4.4% (2026-04) |
| A 股 | 10Y 国债 | ~2.5-3% |
| 港股 | 10Y HKD/USD | ~4% |

### Equity Risk Premium (ERP)

| 市场 | ERP | 说明 |
|---|---|---|
| 美股 | **5.0-6.0%** | Damodaran implied ERP 为准 |
| A 股 | **6.0-8.0%** | 新兴市场溢价 |
| 港股 | **5.5-7.0%** | 介于美股和 A 股之间 |

### Terminal Growth Rate

**硬上限：长期名义 GDP 增长率（2-3% for US / 4-5% for China）**

- ❌ 用 5%+ terminal growth → 终值占比 > 90% → DCF 无意义
- ✅ 默认 2.5%（成熟市场）/ 3.5%（新兴市场）
- 对于高增长公司，拉长投影期（10 年）而不是提高 terminal growth

### 其他关键假设

| 参数 | 默认 | 调整条件 |
|---|---|---|
| Beta | Bloomberg/Yahoo 5y monthly | 周期股用行业平均 |
| Cost of Debt | 公司实际借贷利率 | 无数据时用 risk-free + 1.5% |
| Tax Rate | 有效税率 (历史 3y 平均) | 有明确变化时用边际税率 |
| Capex/Sales | 历史 3y 平均 | 增长期可略高 |
| NWC/Sales | 历史 3y 平均 | 稳定 |

### 敏感性分析强制输出

DCF 必须输出以下敏感性表：

```
              Terminal Growth
              2.0%    2.5%    3.0%    3.5%
WACC  7.0%   $245    $258    $272    $289
      8.0%   $215    $225    $236    $249
      9.0%   $191    $199    $208    $218
     10.0%   $171    $178    $185    $193
```

当前价：$xxx → 在表中位置 → 市场定价隐含什么 WACC/growth？

---

## 📊 Step 3: 标准输出格式

每个估值报告必须输出：

```markdown
## 📈 [TICKER] 估值摘要

### 估值方法
| 方法 | 公允值 | 权重 |
|---|---|---|
| DCF (WACC 9%, g 2.5%) | $225 | 50% |
| PE (20x FY26E EPS) | $240 | 30% |
| EV/EBITDA (12x FY26E) | $218 | 20% |

### Fair Value Range
**$215 - $240**（加权平均 $228）

### 安全边际
- 当前价：$200
- vs Fair Value：**折价 12.3%** ✅
- 安全边际要求：≥ 20%（散户）/ ≥ 10%（高确信）

### 敏感性格局
- 最乐观（低 WACC + 高增长）：$289
- 最悲观（高 WACC + 低增长）：$171
- 当前价在区间位置：底部 25% → 偏低估

### 结论
- 当前价 $200 低于 fair value range 下沿 ($215)
- 安全边际 ~12%，不够我的 20% 要求
- 建议：等待 $185 以下（安全边际 20%+）再入场
```

---

## 🏭 Step 4: 行业适配速查

| 行业 | 关键倍数 | 正常范围 | 看什么 |
|---|---|---|---|
| 消费 (饮料/食品) | PE | 20-30x | Brand power + 分红率 |
| 科技 (SaaS) | EV/Sales | 5-15x | Growth rate + net retention |
| 半导体 | PE | 15-25x | Cycle position + capex cycle |
| 银行 | P/B | 0.8-1.5x | ROE vs Cost of Equity |
| REIT | P/AFFO | 15-25x | Occupancy + cap rate |
| 医药 (大型) | PE | 15-20x | Pipeline value + patent cliff |
| 医药 (biotech) | rNPV | — | Pipeline probability-weighted |
| 能源 | EV/EBITDA | 4-8x | Reserve life + breakeven |
| 矿业 | EV/EBITDA | 5-10x | Mine life + grade |
| 零售 | EV/EBITDA | 8-15x | SSS growth + store economics |
| 保险 | P/B | 1.0-1.5x | Combined ratio + yield |

**周期调整**：
- 周期股 PE 最低时往往在高点（earnings peak），此时应卖出不是买入
- 周期股 PE 最高时（earnings 被压缩），反而是买入时机
- 替代方案：用**正常化盈利**（5-10y average margin × current revenue）

---

## 🎯 Step 5: 实操工作流

```
1️⃣ 选方法（用上面的选择树）
    ↓
2️⃣ fundamentals 模式拉数据（Piotroski + 比率 → 公司值不值得估值）
    ↓
3️⃣ 若 F-Score ≥ 5 → 继续 DCF / 相对估值
   若 F-Score < 5 → 输出警告 + 仅提供相对估值参考
    ↓
4️⃣ 输出标准格式（fair value range + 安全边际% + 敏感性）
    ↓
5️⃣ 后续联动
   - 入场决策 → trade-execution 5 道闸
   - thesis 入库 → thesis-tracker
```

## ⚠ 反模式

- ❌ 所有公司都用 DCF — 银行/REIT/周期股/资源股用 DCF = 误导
- ❌ 不跑敏感性分析 — DCF 假设 ±2% 结果差 30%+
- ❌ "差不多 fair value" 就买 — 等安全边际
- ❌ 只算一种估值方法 — 至少 2 种方法交叉验证
- ❌ 忽略 F-Score — F-Score < 5 的公司不值得 DCF

## 注意

- DCF 是参考框架，不是精确数字。任何假设 ±2% 就能让结果差 30%+ → **敏感性表是唯一的真理**
- 散户只需要 fundamentals 模式 + 简版 DCF（5 年投影 + terminal value），解决 90% 的需求
- 估值便宜 ≠ 买。便宜 + catalyst + thesis 才买
- 永远不要在"差不多 fair value"的时候买——等安全边际

## 📂 Scripts

### 模式 1：财务数据 + 比率分析（fundamentals）

```bash
python3 skills/valuation/scripts/fundamentals/<script>.py AAPL
```

5 类比率：盈利能力 / 成长性 / 效率 / 杠杆 / 估值。Piotroski F-Score (0-9)。

### 模式 2：DCF 内在价值（dcf-model）

```bash
python3 skills/valuation/scripts/dcf-model/<script>.py AAPL
```

5-10y FCF 投影、WACC、Terminal Value（永续增长/退出倍数）、敏感性表、Excel 输出。

### 模式 3：三表勾稽模型（3-statement-model）

```bash
# IS/BS/CF 模板自动勾稽
```

IS: Net Income → BS: Retained Earnings。IS: NI + D&A + working capital → CF。CF ending cash = BS cash。每期 A = L + E。

---

## 🥇 Step 6: 贵金属估值框架

贵金属（黄金/白银）不能用 DCF 或 PE 估值——它们没有现金流。用以下 4 维框架。

### 黄金估值 4 维框架

#### 1. Real Yield（负相关，最强驱动）

```
Gold Price ↑ 的宏观环境：
- Real yield ↓（TIPS yield 下跌）
- Nominal yield ↓ + inflation ↑ = real yield ↓↓ → Gold ↑↑
- Fed 降息预期增强

Gold Price ↓ 的宏观环境：
- Real yield ↑（TIPS yield 上升）
- Nominal yield ↑ + inflation 稳定 = real yield ↑ → Gold ↓
- Fed 鹰派
```

**参考**：10Y US Real Yield (FRED `DFII10`) 从 2.0% → 1.0% → 黄金通常应涨 10-15%。

#### 2. 美元指数（负相关）

| DXY 趋势 | 黄金方向 | 逻辑 |
|---|---|---|
| DXY ↑ | Gold ↓ | 美元强 = 美元计价的黄金对非美买家更贵 |
| DXY ↓ | Gold ↑ | 美元弱 = 黄金更便宜，需求增加 |

但注意：极端避险时（2020、2022），美元和黄金可以同涨（都是避险资产）。

#### 3. 央行购金（结构性支撑）

过去 5 年央行购金量（主要来自中国/印度/波兰）已成为金价的**结构性**支撑：

| 央行购金趋势 | 含义 |
|---|---|
| 连续增持 > 3 季度 | 结构性去美元化 → 黄金底抬升 |
| 暂停/减持 | 短期失去一个需求支柱 |

数据：World Gold Council 季度报告。

#### 4. 投机仓位（短期噪音）

CFTC COT 报告（Commitments of Traders）— 看 managed money 净多仓：

| Managed Money 净多仓 | 信号 |
|---|---|
| 极端净多（历史 90%ile+）| 🟠 拥挤交易，回调风险 |
| 极端净空（历史 10%ile-）| 🟢 contrarian 买入信号 |
| 中性仓位 | 趋势跟随为主 |

#### 黄金/白银比（Gold/Silver Ratio）

| GSR | 含义 |
|---|---|
| > 85 | 白银相对极度便宜，可能白银补涨（或黄金跌）|
| 70-85 | 正常偏高 |
| 50-70 | 正常偏低（risk-on 环境）|
| < 50 | 白银极端走强（通常牛市末期）|

#### 散户黄金投资工具

| 工具 | 费率 | 流动性 | 适合 |
|---|---|---|---|
| **GLD** | 0.40% | 极好 | 交易用 |
| **IAUM** | 0.09% | 好 | 长期持有（最低费率）|
| **SGOL** | 0.17% | 好 | 瑞士存储偏好 |
| **GDX** | 0.51% | 好 | 金矿股 ETF（杠杆于金价 ~2-3×）|
| **/GC 期货** | — | 极好 | 大资金、有期货经验 |
| **实物（金条/金币）** | 买卖差价 2-5% | 差 | 长期持有、避险、不卖 |

#### 贵金属与其他资产联动

| 信号 | 联动 |
|---|---|
| 黄金涨 + 国债涨（yield 跌）| 市场在赌 Fed pivot → 加仓 risk assets |
| 黄金涨 + 国债跌（yield 涨）| 地缘/金融系统风险 → 风险规避 |
| 黄金涨 + 铜涨 | 通胀预期上行（全球增长 + 货币贬值）|
| 黄金涨 + 铜跌 | 滞胀（stagflation）预期 → 极度危险 |
| 金银比飙升 > 90 | 极度 risk-off / 经济危机 |

#### 金矿股估值（不适用普通 DCF）

金矿股估值核心看：

| 指标 | 公式 | 说明 |
|---|---|---|
| **NAV** | Σ(储量 × 金价 × 回收率) - 负债 | 核心估值 |
| **P/NAV** | 股价 / 每股 NAV | > 1.2 = 贵, < 0.8 = 便宜 |
| **EV/Reserves** | EV / 已探明储量 (oz) | 行业并购估值锚 |
| **AISC** (All-In Sustaining Cost) | 每盎司全成本 | 金价 - AISC = margin，越高越好 |

> **散户原则**：如果你买了 GDX（金矿 ETF），实际杠杆于金价的倍数在 2-3×——金价涨 10%，GDX 预期涨 20-30%（但要接受下行也是 2-3×）。
