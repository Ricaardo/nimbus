---
name: market-data
description: 统一行情数据查询。5 种模式：(1) 实时报价 quote — 单股/多股价格/涨跌幅/成交量/市值/52周；(2) 历史 K 线 history — OHLCV 不同周期；(3) 期权 options — 期权链 (calls/puts/strikes/IV/OI/volume) 及希腊字母 (delta/gamma/theta/vega)；(4) 市场摘要 summary — 主要指数/个股/加密一站式；(5) 期货 futures — 合约规格/保证金/基差/升贴水/展期。当用户询问'股价/报价/quote'、'K线/历史/history'、'期权/option chain/Greeks/Delta/IV'、'行情/指数/dashboard'、'期货/futures/合约/保证金/基差/升贴水/contango/backwardation'时触发。支持美股/港股/A股/加密/贵金属/期货。NOT for: on-chain token holder/liquidity/security/social/smart-money detail → OKX OnchainOS skills.
dependencies: ["trading-skills"]
required_tools: ["futuapi", "yfinance", "tavily", "alpaca", "stock-data"]
---

## 🔗 与其他 skill 的联动
| 触发 | 联动 skill | 做什么 |
|---|---|---|
| 用户要估值 | `valuation` | 提供价格/财务数据 |
| 用户要技术分析 | `technical-analysis` | 提供K线/指标数据 |
| 用户要选股 | `stock-screener` | 提供筛选后行情 |
| 用户要交易 | `trade-execution` | 提供实时报价/保证金数据 |
| 写完数据查询 | `us-stock-analysis` | 补充行情到分析报告 |

## ⚠ 反模式
- ❌ 重复查询相同 ticker 不缓存
- ❌ 跳过 futu 直接用 yfinance（延迟高）
- ❌ 期权数据不核对 expiration date
- ❌ 期货数据不区分 contango/backwardation
- ❌ 返回原始 JSON 不格式化

required_tools: ["yfinance", "futuapi", "tavily", "alpaca"]
---

# 市场行情数据（统一）

合并自 stock-quote / price-history / option-chain / greeks / market-summary 的统一查询接口。

## 🔝 行情数据源优先级

1. **futu**（本地，零延迟、零费率）— 美股/港股/A股
2. **CoinMarketCap 官方 MCP (`cmc-mcp`) / CoinGecko** — 加密。优先用官方 CMC MCP 的免费/基础能力（quotes/global metrics/Fear & Greed/trending/category 基础数据）；不要调用 x402、私钥、pay-per-request 或明确付费/高级历史端点。
3. **AKShare / yfinance** — 黄金/原油/期货 fallback

## 🎯 4 种模式

### 模式 1：实时报价（quote）

```bash
python3 /Users/x/.claude/skills/market-data/scripts/quote.py AAPL 00700.HK 600519.SH
```

或直接用 futu helper：

```bash
python3 /Users/x/.claude/skills/futuapi/scripts/helpers/get_price.py AAPL NVDA TSLA
```

返回字段：price / change / change_pct / volume / market_cap / 52w_high / 52w_low

### 模式 2：历史 K 线（history）

```bash
python3 /Users/x/.claude/skills/market-data/scripts/history.py AAPL --period 6mo --interval 1d
```

返回 OHLCV pandas dataframe，period 支持 1d/5d/1mo/3mo/6mo/1y/5y/max；interval 支持 1m/5m/15m/30m/1h/1d/1wk/1mo。

### 模式 3：期权链 + 希腊字母（options）

```bash
# 期权链
python3 /Users/x/.claude/skills/market-data/scripts/options.py AAPL --expiration 2026-05-16

# 希腊字母（Black-Scholes）
python3 /Users/x/.claude/skills/market-data/scripts/greeks.py --underlying AAPL --strike 200 --expiration 2026-05-16 --type call
```

### 模式 4：市场摘要（summary）

主要指数 + 个股 + 加密一站式：

```bash
# 默认面板
python3 /Users/x/.claude/skills/futuapi/scripts/helpers/get_price.py ^GSPC ^IXIC ^HSI 000001.SS AAPL NVDA 00700.HK 600519.SH

# 加密：优先调用官方 CoinMarketCap MCP（cmc-mcp）的免费 quotes；MCP 不可用时用 CoinGecko fallback
curl -s "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true"
```

## 📋 常用标的速查

| 输入 | 名称 | 市场 |
|---|---|---|
| `^GSPC` / `SPY` | 标普 500 | 美 |
| `^IXIC` / `QQQ` | 纳指 | 美 |
| `^DJI` / `DIA` | 道指 | 美 |
| `^HSI` | 恒生指数 | 港 |
| `^HSTECH` | 恒生科技 | 港 |
| `000001.SS` | 上证指数 | A |
| `399006.SZ` | 创业板指 | A |
| `00700.HK` / `09988.HK` | 腾讯 / 阿里 | 港 |
| `600519.SH` / `000858.SZ` | 茅台 / 五粮液 | A |
| `BTC-USD` / `ETH-USD` | 比特币 / 以太 | 加密 |

## 输出格式

```
📊 市场行情

📈 标普500 (SPY): 693.28 (+1.05%)
📈 纳指 (QQQ):    XXX (+X.XX%)
🇭🇰 恒生: 25,872 (+0.82%)
🇨🇳 上证: 4,026 (+0.95%)
🍎 AAPL: 259.68 (+0.19%)
🪙 BTC: $75,261 (+4.10%)
```

## 注意

- **美股指数**：futu 不支持原生指数，自动映射 ETF 代理（^GSPC→SPY / ^IXIC→QQQ）
- **加密**：优先用官方 CoinMarketCap MCP (`cmc-mcp`) 的免费/基础 market data；MCP 不可用时用 CoinGecko；不要为行情摘要调用 CMC x402、私钥、pay-per-request 或付费历史端点。
- **盘前盘后**：futu 快照返回盘中价；如需 EXT 数据用 IBKR MCP

### ⚠ 已知问题：A股 realtime via stock-data MCP

`mcp__stock-data__stock_realtime` **A股 (sh/sz) 失效**（Not Found）— 上游东财 push2 全市场 cluster 在本机网络返回 empty，akshare/efinance fallback 走同一上游。

**A股 realtime fallback 优先级（已修复）**：
1. **futu**（首选）：`python3 /Users/x/.claude/skills/futuapi/scripts/quote/get_market_snapshot.py SH.600519`
2. **本 skill 自带 sina/qq 直连**：`python3 /Users/x/.claude/skills/market-data/scripts/a_share_realtime.py 600519 000858`
3. **stock-data 历史代替**：`mcp__stock-data__stock_prices(symbol=600519, market=sh, limit=1)` — 拿最近 1 日 K 线，含全部技术指标

港股 realtime（`market=hk`）正常工作。A股**历史数据** `stock_prices` 也正常。
- **期权 IV**：futu 不返回 IV，需用 yfinance 或 Black-Scholes 反推

### 模式 5：期货（2026-04 新增）

```bash
# 期货合约行情（CME / ICE / HKEX / SHFE 等）
python3 /Users/x/.claude/skills/market-data/scripts/futures.py --symbol ES --month 202606
```

期货数据源：yfinance（国际）、AKShare（国内）。futu 支持部分 HK 期货。

#### 常用期货合约速查

| Ticker | 名称 | 交易所 | 合约规模 | 最小变动 | yfinance |
|---|---|---|---|---|---|
| ES | E-mini S&P 500 | CME | $50×指数 | 0.25 = $12.50 | ES=F |
| NQ | E-mini Nasdaq-100 | CME | $20×指数 | 0.25 = $5 | NQ=F |
| ZB | 30Y US Treasury Bond | CBOT | $100,000 | 1/32 | ZB=F |
| ZN | 10Y US Treasury Note | CBOT | $100,000 | 1/64 | ZN=F |
| CL | WTI Crude Oil | NYMEX | 1,000 bbl | $0.01 = $10 | CL=F |
| GC | Gold | COMEX | 100 oz | $0.10 = $10 | GC=F |
| SI | Silver | COMEX | 5,000 oz | $0.005 = $25 | SI=F |
| HG | Copper | COMEX | 25,000 lbs | $0.0005 = $12.50 | HG=F |
| NG | Natural Gas | NYMEX | 10,000 MMBtu | $0.001 = $10 | NG=F |

#### 关键期货概念（散户必懂）

| 概念 | 解释 | 对你的意义 |
|---|---|---|
| **合约规模** | 每点价值 × 指数/价格 | ES 1 点 = $50，SPX 跌 100 点 = 亏 $5,000 |
| **保证金** | 开仓所需最低资金 | 初始 ~$12K (ES)，维持 < 初始 |
| **展期** | 近月换远月 | 每季度必须展期一次，成本 = bid-ask + 价差 |
| **Contango** | 远月 > 近月（正价差）| 原油常见，每次展期亏钱（roll cost）|
| **Backwardation** | 远月 < 近月（倒价差）| 展期赚钱（roll yield），黄金/铜偶尔出现 |
| **基差** | 期货 - 现货 | 基差归零 = 到期回归 |
| **杠杆** | 合约价值 / 保证金 | /ES 1 手 ≈ $290,000 敞口 ÷ $12K 保证金 = 24× 杠杆 |

#### 散户期货使用场景

| 场景 | 用什么 | 替代方案 |
|---|---|---|
| 对冲股票组合下跌 | Short /ES (E-mini S&P) | 买 SPY put 或减仓 |
| 做多债券（赌利率下跌）| Long /ZN or /ZB | 买 TLT (长期国债 ETF) |
| 做多/空原油 | Long/Short /CL | 买 USO (原油 ETF) 或 XLE (能源股) |
| 做多黄金 | Long /GC | 买 GLD (黄金 ETF) 或实物 |
| 对冲利率风险 | Short /ZN | 缩短债券久期 |

> **散户原则**：1 手 /ES = $290K 名义敞口。如果你的整个组合不到 $500K，一手 /ES 就能把你的净敞口翻倍。期货用在对冲上最合理——例如你满仓美股但不想卖（税务原因），用少量 /ES short 对冲系统性风险。

#### 保证金与风险

| 合约 | 名义价值 | 初始保证金 (约) | 杠杆 | 日波动风险 |
|---|---|---|---|---|
| ES | ~$290,000 | ~$12,000 | 24× | ±100pt = ±$5,000/天 |
| NQ | ~$420,000 | ~$18,000 | 23× | ±400pt = ±$8,000/天 |
| CL | ~$68,000 | ~$6,000 | 11× | ±$2/bbl = ±$2,000/天 |
| GC | ~$300,000 | ~$9,000 | 33× | ±$50/oz = ±$5,000/天 |

**风控规则**：
- 单合约占用保证金 < 组合 5%（散户）
- 永远不要在数据发布日/重大事件日持有高杠杆期货（CPI/FOMC/NFP 当天）
- 展期前 3 天必须准备好资金或提前平仓
