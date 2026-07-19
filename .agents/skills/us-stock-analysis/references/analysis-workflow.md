# US Stock Analysis Workflow — 详细执行步骤

> SKILL.md 是决策协议（路由 + Delta 协议）；本文档存放：4 类分析的完整工作流、多资产数据源代码片段、报告模板、对比分析格式。

---

## 一、4 类分析工作流

### 1. Basic Stock Info（快速概览）

**触发**：用户问"AAPL 什么价"、"快速看一下 X"

**步骤**：
1. 拉当前价 / 成交量 / 市值
2. 5 个核心 metric（PE / EPS / Rev growth / margin / 52w range）
3. YTD 表现
4. 近期重大新闻（如有）

**输出**：1-2 句业务描述 + 当前数据 + 估值表 + 表现 + 新闻

---

### 2. Fundamental Analysis（基本面深度）

**触发**：用户要"分析 NVDA 财务"、"AAPL 估值合理吗"

**步骤**：
1. **拉数据**：3-5 年 Rev / Earnings / FCF / BS / 利润率 / ROE / ROIC
2. 读 `references/fundamental-analysis.md`（分析框架）
3. 读 `references/financial-metrics.md`（公式与定义）
4. **业务质量**：护城河、管理层、行业位置
5. **估值**：PE / PEG / PB / EV/EBITDA vs 历史 + 同行 + 公允区间
6. **风险**：公司特定 / 宏观 / 财务 red flag
7. **输出**：按 `references/report-template.md` 结构

**关键分析维度**：
- 利润率趋势（改善/恶化）
- FCF 质量（FCF vs Earnings）
- 资产负债表强度（杠杆 / 流动性）
- 增长可持续性
- 估值 vs 同行 + 历史

---

### 3. Technical Analysis（技术面）

**触发**：用户要"AAPL 技术面"、"TSLA 超卖了吗"

**步骤**：
1. **拉数据**：当前价 + 成交量 + 20/50/200MA + RSI/MACD/BB
2. 读 `references/technical-analysis.md`（指标与形态定义）
3. **趋势**：上升/下降/横盘 + 强度
4. **支撑/阻力**：近期高低点 / MA / 整数关口
5. **指标**：RSI（>70 超买 / <30 超卖）、MACD（金叉/死叉/背离）、Volume（确认/背离）、BB（挤压/扩张）
6. **形态**：反转（H&S / 双顶底）/ 持续（旗形 / 三角）
7. **结论**：趋势 + 关键位 + R:R + 短中期展望

**解读铁律**：
- 多指标确认（不靠单一信号）
- Volume 验证
- 价格与指标背离要警惕
- 必须给止损位

---

### 4. Comprehensive Investment Report（完整研报）

**触发**：用户要"完整研报"、"应该买 X 吗"、"详细分析"

**步骤**：
1. 拉全数据
2. 跑 Fundamental Analysis 流程
3. 跑 Technical Analysis 流程
4. 读 `references/report-template.md`
5. **综合**：基本面 + 技术面 → bull case / bear case → R:R
6. **建议**：Buy/Hold/Sell + Target Price + 时间框架 + Conviction
7. 按模板生成

**报告必含**：
- Executive Summary + 评级
- Company Overview
- Investment Thesis（bull + bear）
- Fundamental Analysis
- Technical Analysis
- Valuation
- Risk Assessment
- Catalysts + Timeline
- Conclusion

---

## 二、Stock Comparison（对比分析）

**触发**："compare AAPL vs MSFT"、"X 和 Y 哪个好"

**步骤**：
1. 对每个 ticker 拉数据（同时间段）
2. 读 `references/fundamental-analysis.md` + `financial-metrics.md`
3. **侧侧对比表**：
   - 业务模式
   - 财务比率（all key ratios）
   - 估值（PE/PB/EV/EBITDA/PEG）
   - 增长率
   - 利润率
   - 资产负债表强度
4. **相对优势**：每个公司哪里强 + 量化
5. **技术对比**：RS 强度 + 动量 + 哪个技术位置更好
6. **结论**：哪个更优 + 为什么 + 组合配置建议 + 风险调整收益

输出格式：见 `references/report-template.md` 的 "Comparison Report Structure"。

---

## 三、多资产数据源（代码片段）

### A 股（优先 AKShare）

```python
import akshare as ak

# 实时行情
df = ak.stock_zh_a_spot_em()                                # 全部 A 股
df = ak.stock_individual_info_em(symbol="601231")            # 个股信息

# 历史 K 线
df = ak.stock_zh_a_hist(symbol="601231", period="daily",
                          start_date="20240101", adjust="qfq")

# 财务数据
df = ak.stock_financial_report_sina(stock="601231", symbol="利润表")
df = ak.stock_financial_report_sina(stock="601231", symbol="资产负债表")
```

### 港股（优先 AKShare）

```python
df = ak.stock_hk_spot_em()                                   # 实时行情
df = ak.stock_hk_hist(symbol="00700", period="daily", adjust="qfq")
```

### 加密 / 贵金属 / 原油（yfinance）

```python
import yfinance as yf
data = yf.download("BTC-USD", period="3mo")   # Bitcoin
data = yf.download("ETH-USD", period="3mo")   # Ethereum
data = yf.download("GC=F", period="3mo")      # 黄金
data = yf.download("SI=F", period="3mo")      # 白银
data = yf.download("CL=F", period="3mo")      # WTI 原油
```

### Fallback 链
```
futu helpers → AKShare → yfinance → WebSearch → WebFetch
```

### 数据源参考

- **美股**：Yahoo Finance / Google Finance / MarketWatch / Seeking Alpha / Bloomberg / SEC（10-K/10-Q）/ TradingView
- **A 股**：东方财富 / 同花顺 / 雪球 / 巨潮（cninfo）/ AKShare
- **港股**：HKEXnews / AKShare

---

## 四、Output Guidelines

### General Principles
- 表格化财务数据（易扫）
- Bold 关键 metric 与发现
- 标注数据源与日期
- 量化（不"较好"）
- Bull + Bear 双面
- 假设与不确定性明示

### Formatting
- Headers 分节
- Tables 用于 metric / 对比 / 历史
- Bullets 用于列表 / 因素 / 风险
- Bold 用于关键发现
- % 用于增长 / 回报 / margin
- $ 一致：$B / $M

### Tone
- 客观平衡
- 承认不确定
- 数据支持论断
- 不夸张
- 风险明示

---

## 五、Example Queries（按类型）

### Basic Info
- "What's the current price of AAPL?"
- "Give me key metrics for Tesla"
- "Quick overview of Microsoft"

### Fundamental
- "Analyze NVDA's financials"
- "Is Amazon overvalued?"
- "Evaluate Apple's business quality"
- "What's Google's debt situation?"

### Technical
- "Technical analysis of TSLA"
- "Is Netflix oversold?"
- "Show me support levels for AAPL"
- "What's the trend for AMD?"

### Comprehensive
- "Complete analysis of Microsoft"
- "Give me a full report on AAPL"
- "Should I invest in Tesla?"

### Comparison
- "Compare AAPL vs MSFT"
- "Tesla vs Nvidia"
- "Analyze Meta vs Google"

---

## 六、Reference Files

| 文件 | 何时读 |
|---|---|
| `technical-analysis.md` | 跑技术分析或解读指标 |
| `fundamental-analysis.md` | 跑基本面或业务评估 |
| `financial-metrics.md` | 需要 ratio 定义/公式 |
| `report-template.md` | 写 comprehensive 或 comparison |
