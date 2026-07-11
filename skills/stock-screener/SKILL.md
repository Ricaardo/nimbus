---
name: stock-screener
description: "多维度股票筛选器。6 模式：(1) 趋势/成长 — SMA/RSI/MACD/ADX + CANSLIM + Minervini VCP；(2) 股息 — Growth/Value 双策略；(3) PEAD — 财报后跳空 + 红 K 回调；(4) 配对交易 — 协整/z-score；(5) A股量化信号 — 0-100 评分；(6) ETF — 费率/规模/跟踪误差/资金流/折溢价。当用户问'选股/screen/scan/CANSLIM/VCP/Minervini/股息/dividend/PEAD/财报后/配对交易/cointegration/A股买入信号/ETF 筛选'时触发。支持美股/港股/A股。NOT for: 主题级研究（'AI 基础设施有哪些股'）→ research（Systematic 模式）；个股详细评估 → us-stock-analysis。"
required_tools: ["yfinance", "tavily", "stock-data"]
---

# 股票筛选器 — 决策协议

筛选只是第一步。**筛完不处理 = 没筛**。协议涵盖：选模式 → 筛 → 排序 → 验证 → 联动。

---

## 🔀 筛前：选对模式

| 我的目标 | 用哪个模式 | 大盘要求 |
|---|---|---|
| 找强势突破股 | Technical / CANSLIM / VCP | MHS ≥ 50 (market-pulse) |
| 找便宜高股息（防御）| Dividend Value | 不限 |
| 找逐年加股息的复利机器 | Dividend Growth | 不限 |
| 财报反转动量 | PEAD | 不限 |
| 市场中性套利 | Pair Trade | 不限 |
| A 股量化信号 | Quant Signals | 不限 |
| 筛选 ETF / 选指数 | **ETF** (mode 6) | 不限 |

---

## 🎯 5 种筛选模式

### 1. 趋势 / 成长（scanner-bullish）

```bash
python3 skills/stock-screener/scripts/scanner-bullish/<script>.py --mode {technical|canslim|vcp}
```

- **Technical**：SMA/RSI/MACD/ADX 综合 0-8 评分
- **CANSLIM** (O'Neil 7 因子，0-100)：Current/Annual/New/Supply/Leader/Institutional/Market
- **VCP** (Minervini 波动收缩)：Stage 2 突破候选

### 2. 股息（dividend-screener）

```bash
python3 skills/stock-screener/scripts/dividend-screener/<script>.py --mode {growth|value}
```

- **Growth**：5y 股息 CAGR ≥ 12% + RSI 超卖（<30）回调
- **Value**：P/E < 20 + P/B < 2 + 股息率 ≥ 3%
- 两者先用 FINVIZ 预筛

### 3. PEAD 财报后漂移（pead-screener）

```bash
python3 skills/stock-screener/scripts/pead-screener/<script>.py --input <FMP|earnings-trade-analyzer-json>
```

财报跳空高开 → weekly 红 K 回调 → 突破信号。

### 4. 配对交易（pair-trade-screener）

```bash
python3 skills/stock-screener/scripts/pair-trade-screener/<script>.py --sector tech
```

行业内协整对、z-score 入场/出场、spread backtest。

### 5. A 股量化信号（quant-signal）

两子模式：**市场总览**（情绪/资金/涨跌停）和 **个股评分**（技术指标综合）。

#### 5.1 市场情绪总览

```bash
python3 -c "
import akshare as ak
# 涨跌停统计（市场情绪温度计）
df = ak.stock_market_activity_legu()
print('=== 涨跌停统计 ===')
print(df.to_string())
"
```

```bash
# 北向资金流向
python3 -c "
import akshare as ak
df = ak.stock_hsgt_north_net_flow_in_em(symbol='北上')
print('=== 北向资金(近10日) ===')
print(df.tail(10).to_string())
"
```

```bash
# 大盘指数表现（上证/深证/创业板/科创50）
python3 -c "
import akshare as ak
for idx in ['000001','399001','399006','000688']:
    df = ak.stock_zh_index_daily_em(symbol=idx)
    latest = df.iloc[-1]
    print(f'{latest[\"date\"]} | {idx} | 收{latest[\"close\"]:.2f} | 涨跌{latest[\"pct_chg\"]:.2f}%')
"
```

#### 5.2 个股技术评分

```bash
python3 -c "
import akshare as ak, pandas as pd, numpy as np

# 取沪深300成分股近60日K线，计算综合技术评分
def calc_tech_score(df):
    close = df['close'].values
    vol = df['volume'].values
    # MA趋势
    ma20 = np.mean(close[-20:]); ma60 = np.mean(close[-60:]) if len(close)>=60 else ma20
    trend_score = 30 if close[-1] > ma20 > ma60 else (15 if close[-1] > ma20 else 0)
    # RSI(14)
    delta = np.diff(close[-15:])
    gain = np.sum(delta[delta>0]); loss = -np.sum(delta[delta<0])
    rs = gain/loss if loss != 0 else 100
    rsi = 100 - 100/(1+rs)
    rsi_score = 25 if 30 < rsi < 70 else (10 if rsi > 70 else 20)
    # 量比
    vol_ratio = np.mean(vol[-5:]) / np.mean(vol[-20:]) if np.mean(vol[-20:]) > 0 else 1
    vol_score = 20 if vol_ratio > 1.2 else (10 if vol_ratio > 0.8 else 5)
    # MACD
    ema12 = pd.Series(close[-30:]).ewm(span=12).mean().iloc[-1]
    ema26 = pd.Series(close[-30:]).ewm(span=26).mean().iloc[-1]
    macd = ema12 - ema26
    macd_score = 25 if macd > 0 else 10
    return trend_score + rsi_score + vol_score + macd_score

# 示例：沪深300指数
df300 = ak.stock_zh_index_daily_em(symbol='000300')
score = calc_tech_score(df300.tail(60).rename(columns={'close':'收盘','volume':'成交量'}))
print(f'沪深300 综合技术评分: {score}/100')
"
```

#### 5.3 A股选股（stock-picker）

三层筛选：热度(30%) + 基本面(40%) + 技术面(30%)

```bash
# 第一层：人气排名 + 热门板块
python3 -c "
import akshare as ak
# 个股人气榜 Top30
df = ak.stock_hot_rank_em()
print('=== 人气榜 Top30 ===')
print(df[['排名','代码','名称','最新价','涨跌幅']].head(30).to_string())
"
```

```bash
# 第二层：基本面筛选（业绩高增长 + 低负债）
python3 -c "
import akshare as ak
# 业绩预告 — 净利润增长 > 50%
df = ak.stock_yjyg_em(date='$(date +%Y%m%d)')
high = df[pd.to_numeric(df['预告净利润变动幅度(%)'], errors='coerce') > 50]
print('=== 净利润增长 > 50% ===')
print(high[['代码','名称','预告净利润变动幅度(%)','业绩变动原因']].head(20).to_string())
"
```

```bash
# 第三层：技术面筛选（均线多头 + MACD金叉 + 放量）
# 用 akshare 拉K线后本地计算，或用问财自然语言查询
python3 -c "
import akshare as ak
# 问财：技术面条件查询（需 IWENCAI_API_KEY）
# curl -X POST \$IWENCAI_BASE_URL -H 'Content-Type: application/json' \
#   -d '{\"question\": \"MACD金叉, 均线多头排列, 成交量放大, 非ST\"}'
print('推荐使用问财API进行自然语言技术面查询')
print('条件示例: MACD金叉, RSI 50-70, 均线多头排列, 换手率3%-10%, 非ST')
"
```

0-100 评分：80-100 强烈买入 / 60-80 买入持有 / 40-60 中性 / 20-40 卖出 / 0-20 强烈卖出。

### 6. ETF 筛选（2026-04 新增）

**核心回答**：哪个 ETF 跟踪最准？费率最低？资金在往哪流？

```bash
python3 skills/stock-screener/scripts/<script>.py --mode etf --category {broad|sector|bond|commodity|factor|thematic}
```

#### 筛选维度

| 维度 | 标准 | 为什么重要 |
|---|---|---|
| **费率** | < 0.10% (broad) / < 0.35% (thematic) | 30 年复合差距可达 20%+ |
| **规模 (AUM)** | > $500M (broad) / > $100M (niche) | 流动性 + 不会被清盘 |
| **跟踪误差** | < 0.5% annual | 越大 = 越不像指数 |
| **折溢价** | ±0.20% 以内 | 大幅溢价 = 你在多付 |
| **日均成交量** | > $50M | 流动性保证 |
| **资金流 (1m/3m)** | 正流入 > AUM 的 5% | 机构在用钱投票 |
| **Spread** | < 0.05% | 买卖成本 |

#### ETF 红线（一票否决）

- AUM < $50M → 随时可能清盘
- 日均成交 < $5M → 买不进卖不出
- 跟踪误差 > 2% → 不是在跟踪指数
- 折溢价经常 > 1% → 做市商在坑你
- 费率 > 1% → 主动基金也嫌贵

#### 按资产类别选 ETF

```bash
# 宽基指数
python3 <script> --mode etf --category broad

# 行业/板块
python3 <script> --mode etf --category sector --sector tech

# 债券 ETF（久期选择）
python3 <script> --mode etf --category bond --duration {short|intermediate|long}

# 商品（黄金/原油/农产品）
python3 <script> --mode etf --category commodity --underlying {gold|oil|agri}

# 因子（value/momentum/quality/low-vol）
python3 <script> --mode etf --category factor --style {value|momentum|quality|low-vol}

# 主题（AI/ESG/robotics...）
python3 <script> --mode etf --category thematic --theme {ai|esg|robotics|cloud}
```

#### ETF vs 个股 vs 指数基金

| | ETF | 个股 | 传统指数基金 |
|---|---|---|---|
| 分散度 | ✅ 一篮子 | ❌ 单个 | ✅ 一篮子 |
| 交易 | 盘中实时 | 盘中 | 仅收盘 NAV |
| 费率 | 低 (0.03-0.5%) | 无 | 极低 (0.015%) |
| 税收 | 比 mutual fund 高效 | 个人税率 | 可能有 capital gain 分配 |
| 期权 | ✅ 大部分有 | ✅ | 部分有 |
| 最小购买 | 1 股 | 1 股 | 基金公司门槛 |

#### 输出格式

```
🎯 ETF 筛选 — 宽基美股指数

| # | Ticker | 名称 | 费率 | AUM | 日均量 | 跟踪误差 | 资金流(3m) |
|---|---|---|---|---|---|---|---|
| 1 | VOO | Vanguard S&P 500 | 0.03% | $450B | $2.5B | 0.02% | +$8B |
| 2 | IVV | iShares Core S&P 500 | 0.03% | $380B | $1.8B | 0.03% | +$5B |
| 3 | SPLG | SPDR Portfolio S&P 500 | 0.02% | $35B | $200M | 0.04% | +$1B |

📌 VOO 和 IVV 几乎一样 — VOO 日均量更大
📌 SPLG 费率最低但规模较小 — 适合长期 buy-and-hold
```

---

## 🔁 筛后处理流程（关键——不能跳过）

```
1️⃣ 筛选产出 Top 5-10 候选
    ↓
2️⃣ 排序（必须）
    用 1 个综合维度排序：quality × value × momentum
    - quality: ROIC / F-Score / Debt
    - value: PE / EV/EBITDA / FCF yield
    - momentum: 相对强度 / SMA 位置
    ↓
3️⃣ 去伪
    剔除：财务造假嫌疑、退市风险、日均成交 < $1M、无期权流动性差的
    ↓
4️⃣ 选前 3 用 valuation 算便宜度
    每个候选输出：fair value range、当前折溢价%、安全边际
    ↓
5️⃣ 选前 1 用 technical-analysis 看入场点
    找具体 entry / stop / target
    ↓
6️⃣ 用 trade-execution 算仓位 + 止损
    ↓
7️⃣ 用 thesis-tracker 写 thesis + kill criteria
    ↓
8️⃣ 用 trade-journal 做 pre-mortem → 入场
```

**AI 行为**：用户要的是候选清单 → 但你不能只给清单就不管了。筛选输出后必须主动问："要不要我对前 3 个做快速估值对比？"

---

## 📊 筛选输出标准格式

```markdown
🎯 [筛选条件] — 筛选结果

筛选规则：[量化条件]
全市场命中：X 只
剔除（流动性/欺诈）：Y 只
Top 10（按综合评分排序）：

| # | Ticker | 评分 | PE | ROIC | Rev YoY | 一句话理由 |
|---|---|---|---|---|---|---|
| 1 | AAPL | 85 | 28 | 45% | +5% | 服务占比提升 + buyback |
| 2 | ... | | | | | |

📌 推荐下一步：
- 对 #1 AAPL 做 valuation 深挖
- 对 #2-3 做 quick PE/EV 对比
- 是否继续？（回复 1/2/3 或 "全做"）
```

---

## ⚠ 反模式

- ❌ 筛完直接买 — 筛选 ≠ 研究，必须过 valuation + technical
- ❌ CANSLIM / VCP 在 bear market 用 — 突破策略在 MHS < 50 时失灵
- ❌ 股息筛只看 yield — 必须看 payout ratio + debt + dividend history
- ❌ PEAD 只追跳空 — 等回调 + 突破确认，跳空当天冲进去容易被套
- ❌ 配对交易不做 spread backtest — 协整关系会突然消失，必须设止损
- ❌ A 股量化信号盲信 — 结合龙虎榜 + 资金流向（news-dashboard）验证
