---
name: technical-analysis
description: Compute technical indicators (RSI, MACD, BB, SMA, EMA) for stocks, AND analyze chart images for trend/S&R/scenario assessment. Use when user asks about technical analysis, indicators, chart analysis, or provides chart images for visual analysis. 支持美股/A股/港股/加密/贵金属多市场分析。
dependencies: ["trading-skills"]
required_tools: ["yfinance", "futuapi", "tavily"]
---

# Technical Analysis

---

## Technical Indicators（技术指标计算）

Compute technical indicators using pandas-ta. Supports multi-symbol analysis and earnings data.

> **Note:** If `uv` is not installed or `pyproject.toml` is not found, replace `uv run python` with `python` in all commands below.

```bash
uv run python scripts/technicals.py SYMBOL [--period PERIOD] [--indicators INDICATORS] [--earnings]
```

**Arguments:**
- `SYMBOL` - Ticker symbol or comma-separated list
- `--period` - Historical period: 1mo, 3mo, 6mo, 1y (default: 3mo)
- `--indicators` - Comma-separated list: rsi,macd,bb,sma,ema,atr,adx (default: all)
- `--earnings` - Include earnings data

**Output:** `price`, `indicators`, `risk_metrics` (volatility + Sharpe), `signals`, `earnings`

**Interpretation:**
- RSI > 70 = overbought, RSI < 30 = oversold
- MACD crossover = momentum shift
- Golden cross (SMA20 > SMA50) = bullish
- ADX > 25 = strong trend
- Sharpe > 1 = good, > 2 = excellent

**Examples:**
```bash
uv run python scripts/technicals.py AAPL
uv run python scripts/technicals.py AAPL,MSFT,GOOGL
uv run python scripts/technicals.py NVDA --earnings
uv run python scripts/technicals.py TSLA --indicators rsi,macd
```

---

## Correlation Analysis（相关性分析）

Compute price correlation matrix between multiple symbols for diversification analysis.

```bash
uv run python scripts/correlation.py SYMBOLS [--period PERIOD]
```

**Arguments:** `SYMBOLS` (comma-separated, min 2), `--period` (1mo/3mo/6mo/1y, default: 3mo)

**Output:** `symbols`, `period`, `correlation_matrix` (nested dict)

**Interpretation:**
- Near 1.0 = highly correlated; Near -1.0 = negatively correlated; Near 0 = uncorrelated
- For diversification, prefer low/negative correlations

**Examples:**
```bash
uv run python scripts/correlation.py AAPL,MSFT,GOOGL,AMZN
uv run python scripts/correlation.py XLF,XLK,XLE,XLV --period 6mo
uv run python scripts/correlation.py SPY,GLD,TLT
```

---

## Chart Image Analysis（图表图片分析）

### When to Use
- User provides chart images (weekly/daily K-line screenshots)
- User asks for trend identification, support/resistance, or scenario planning
- Works for ANY market (US, A-share, HK, crypto, forex, commodities)

### Visual Analysis Workflow

#### Step 1: Systematic Chart Reading
1. **Trend Analysis** — Direction, strength, duration, HH/HL or LH/LL pattern
2. **Support & Resistance** — Horizontal levels, trendlines, role reversals
3. **Moving Average Analysis** — Price vs 20/50/200 MA, alignment, slope, crossovers
4. **Volume Analysis** — Trend, spikes at key levels, confirmation/divergence
5. **Chart Patterns** — Reversal (H&S, double top/bottom), continuation (flags, triangles)

#### Step 2: Probabilistic Scenarios
- **Base Case** (40-60%): Most likely outcome
- **Bull Case** (20-40%): Upside breakout
- **Bear Case** (20-40%): Downside breakdown
- **Alternative** (5-15%): Lower probability but plausible

#### Step 3: Generate Report
Save as `[SYMBOL]_technical_analysis_[YYYY-MM-DD].md` with sections: Chart Overview → Trend → S/R Levels → MA → Volume → Patterns → Assessment → Scenarios → Summary

---

## 多市场 K 线数据获取

### 全市场首选：futuapi（本地 OpenD，port 11111）

```python
from futu import *
quote_ctx = OpenQuoteContext(host='127.0.0.1', port=11111)
# 美股: US.AAPL / 港股: HK.00700 / A股: SH.600519
ret, data, _ = quote_ctx.request_history_kline('US.AAPL', ktype=KLType.K_DAY, start='2024-01-01')
quote_ctx.close()
```

用 pandas-ta 计算指标：
```python
import pandas_ta as ta
df = df.rename(columns={"time_key": "Date", "open": "Open", "close": "Close", "high": "High", "low": "Low", "volume": "Volume"})
df.set_index("Date", inplace=True)
df.ta.rsi(length=14, append=True)
df.ta.macd(append=True)
df.ta.bbands(append=True)
df.ta.sma(length=20, append=True)
df.ta.sma(length=60, append=True)
df.ta.adx(append=True)
```

### 数据源优先级
- **美股：** futuapi → IBKR MCP → yfinance → AKShare
- **港股：** futuapi → AKShare → WebSearch
- **A股：** futuapi → AKShare → WebSearch

### Dependencies
`numpy`, `pandas`, `pandas-ta`, `futu-api`, `yfinance`, `akshare`

---

## ⚠ 反模式

- ❌ 只看一个指标做决策 — RSI 超卖 + trend down = 还会继续跌
- ❌ 过度优化参数 — 14 日 RSI vs 13 日 RSI 差别不大，别反复调
- ❌ 图表分析不看 volume — 无量突破 = 假突破
- ❌ 忽略多时间框架 — 日线 bullish 但周线 bearish = 短线反弹不是反转

## 🔗 与其他 skill 的联动

| 触发 | 联动 skill | 做什么 |
|---|---|---|
| 技术面超买/超卖 + trend 反转 | `trade-execution` | 调整止损/止盈 |
| MA 突破/跌破 | `thesis-tracker` | 更新 thesis pillar 状态 |
| 多个标的 correlation 高 | `portfolio-manager` | 组合集中度检查 |
| 图表形态出现 | `us-stock-analysis` | 作为 entry/exit timing 输入 |

---

> 详见 [`references/shared-output-rules.md`](../references/shared-output-rules.md) — 中文输出规范、多市场 Ticker 识别、行情数据源优先级、Dashboard JSON 格式。
