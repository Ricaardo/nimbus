---
name: news-dashboard
description: "Unified news + data intelligence. 5 modes: market (Finnhub macro), deep (event impact 结构化提取), stock (per-ticker sentiment), raw (Jinshi/BlockBeats/Finnhub/Policy feeds — 直连上游), A-share data (龙虎榜/资金流向/热门板块/机构调研/IPO/研报/限售解禁/情绪 — 直连 akshare/futu). 当用户询问市场新闻、龙虎榜、资金流向、热门板块时触发。NOT for: 推演新闻 18 个月二三次影响 → research（Scenarios 模式）；个股深度叙事 → us-stock-analysis；财报具体数据 → event-calendar。"
required_tools: ["tavily", "websearch", "tavily_extract"]
---

# News Dashboard Skill

四合一新闻分析工具，整合宏观新闻聚合、深度事件影响分析、个股新闻情绪和本地 API 快讯源。

## When to Use This Skill

- 「市场近期有什么新闻？」→ `--mode market`（默认）
- 「最近 10 天重大事件对市场影响？」→ `--mode deep`
- 「AAPL 最近有什么新闻？」→ `--mode stock AAPL`
- 「金十快讯」/「币圈新闻」/「财经新闻」/「证监会政策」→ `--mode raw SOURCE`

---

## Mode 4: Raw（直连原始快讯源）

**来源（优先级）：** 直连上游 API

### 4.1 金十快讯（jin10）

**直连上游**（推荐）：
```bash
curl -sS "https://flash-api.jin10.com/get_flash_list?channel=-8200" \
  -H "Referer: https://www.jin10.com/" \
  | jq '.data[:20] | .[] | {time, content: .data.content, important}'
```

参数: `limit`、`important_only`
触发词: "最新消息"、"市场快讯"、"金十"

### 4.2 BlockBeats 区块链新闻

**直连上游**（推荐）：
```bash
# 中文快讯（type=0 快讯, type=1 文章）
curl -sS "https://api.theblockbeats.news/v1/open-api/open-flash?size=10&page=1" \
  | jq '.data.data[] | {time: .create_time, title, link}'

# 英文深度
curl -sS "https://api.theblockbeats.news/v1/open-api/open-information?size=5&page=1&lang=en" | jq
```

触发词: "区块链"、"crypto"、"币圈"、"Web3"

### 4.3 Finnhub 市场新闻

**直连上游**（推荐）：需 `$FINNHUB_API_KEY`（已在 `~/.zshrc`）
```bash
# 综合新闻
curl -sS "https://finnhub.io/api/v1/news?category=general&token=$FINNHUB_API_KEY" \
  | jq '.[:10] | .[] | {time: .datetime, headline, source, url}'

# 类别: general / forex / crypto / merger
curl -sS "https://finnhub.io/api/v1/news?category=forex&token=$FINNHUB_API_KEY" | jq '.[:5]'
```

触发词: "市场新闻"、"美股新闻"、"财经新闻"

### 4.4 中国政策新闻（CSRC / 央行 / 交易所）

**直连上游**（无 API，需爬取，建议用 `tavily` skill）：
```bash
# 证监会公告
tavily web_search "证监会 site:csrc.gov.cn 最新"
# 央行公告
tavily web_search "中国人民银行 site:pbc.gov.cn 最新"
```

触发词: "政策"、"监管"、"证监会"、"央行"

### Raw 模式输出规则

- 将 JSON 结果整理为简洁的中文列表
- 每条包含：时间、标题、来源、链接（如有）
- 重要快讯标注 ⚡

---

## Mode 1: Market（宏观新闻聚合）

**运行**：`python3 skills/news-dashboard/scripts/macro_news_dashboard.py --lookback-days 3 --calendar-days 14 --watchlist SPY,QQQ,AAPL --output-dir /tmp/news`

**依赖**：环境变量 `FINNHUB_API_KEY`、`FRED_API_KEY`（已内置于 `shared/finnhub_client.py` 和 `shared/fred_client.py`）。输出 md + json 报告，含市场新闻聚合、板块新闻、经济日历、央行动态、影响力评分、话题聚类。

**如需修复：** 需补回 `skills/news-dashboard/shared/finnhub_client.py` + `fred_client.py`。

### 原执行命令（保留备查）

```bash
python3 skills/news-dashboard/scripts/macro_news_dashboard.py \
  --finnhub-key "$FINNHUB_API_KEY" --lang zh
```

可选参数: `--output-dir`, `--lookback-days 3`, `--calendar-days 14`, `--watchlist SPY,QQQ,AAPL,NVDA,JPM,XLE`

### 输出 4 板块

| # | 板块 | 内容 |
|---|------|------|
| 1 | 热点话题 | Finnhub 市场新闻聚类 + 影响力评分 |
| 2 | 央行动态 | Fed/ECB/BOJ/PBOC 关键词过滤 |
| 3 | 经济日历 | 未来 14 天高/中影响事件 |
| 4 | 板块新闻 | 按 watchlist ticker 分组 |

~8-12 Finnhub + 1 yfinance 调用。

---

## Mode 2: Deep（深度事件影响分析）

**来源:** WebSearch + WebFetch（无需 API Key）

6 步结构化工作流，分析过去 10 天重大事件对股市和大宗商品的影响。

### Step 1: 新闻收集

通过 WebSearch 并行搜索 6 类新闻：

| 类别 | 搜索关键词示例 |
|------|---------------|
| 货币政策 | FOMC meeting, Fed interest rate, ECB decision |
| 经济数据 | CPI inflation, NFP jobs report, GDP |
| 巨头财报 | NVIDIA earnings, Apple earnings |
| 地缘政治 | Middle East oil, Ukraine war, trade tariffs |
| 大宗商品 | oil prices, gold prices, OPEC meeting |
| 企业新闻 | M&A announcement, bankruptcy, credit downgrade |

**优先信源:** FederalReserve.gov, SEC.gov → Bloomberg, Reuters, WSJ → CNBC, MarketWatch

收集每条新闻：日期时间、事件类型、信源可信度、初始市场反应。

### Step 2: 加载知识库

根据收集到的新闻类型，按需加载 references/ 参考文件：

- **必加载:** `market_event_patterns.md`, `trusted_news_sources.md`
- **货币政策:** 参考央行政策事件模式
- **地缘政治/商品:** 加载 `geopolitical_commodity_correlations.md`
- **巨头财报:** 加载 `corporate_news_impact.md`

### Step 3: 影响力评分

三维评估框架：

**资产价格影响（主因子）：**
- 股指: Severe ±2%+ / Major ±1-2% / Moderate ±0.5-1%
- 商品: Oil Severe ±5%+ / Gold Severe ±3%+
- 债券: 10Y Severe ±20bps+

**影响广度（乘数）：**
- 系统性 3x → 跨资产 2x → 板块级 1.5x → 个股级 1x

**前瞻意义（修正）：**
- 体制转换 +50% / 趋势确认 +25% / 孤立事件 0% / 反向信号 -25%

**计算:** `Impact Score = (价格分 × 广度乘数) × (1 + 前瞻修正)`

### Step 4: 市场反应分析

对 Impact Score >5 的事件分析：
- **即时反应:** 方向、幅度、时段（盘前/盘中/盘后）、VIX
- **多资产联动:** 股市 → 债市 → 商品 → 外汇 → 衍生品
- **模式比对:** 与知识库历史模式对比 → Consistent / Amplified / Dampened / Inverse
- **异常标记:** 市场忽视重大利空、小消息过度反应、避险资产失效

### Step 5: 相关性与因果评估

多事件交互分析：
- **叠加事件:** 同向影响（非线性放大）
- **对冲事件:** 反向影响（判断哪个主导）
- **序列事件:** 路径依赖（累积效应）
- **传导机制:** 直接渠道 → 间接渠道 → 情绪渠道 → 反馈循环

### Step 6: 报告输出

```markdown
# 市场新闻分析报告 - [日期范围]

## 执行摘要
[3-4 句：分析周期、重大事件数、主导主题、最高影响事件]

## 影响力排名表
| 排名 | 事件 | 日期 | 得分 | 受影响资产类别 | 市场反应 |

## 逐事件深度分析
### [排名]. [事件名] (Impact Score: X)
- 事件摘要 / 市场反应（即时+后续）/ 模式比对 / 板块影响

## 主题综合
- 主导叙事 / 事件关联 / 风险偏好评估 / 板块轮动 / 异常与意外

## 大宗商品深度
- 能源 / 贵金属 / 基本金属 / 农产品

## 前瞻展望
- 市场定位洞察 / 即将到来的催化剂 / 风险情景（3-5 个）

## 数据来源与方法论
```

**分析原则:**
1. 影响优于噪音 — 过滤小事件
2. 多资产视角 — 跨市场联动
3. 模式识别 — 历史比对 + 异常捕捉
4. 因果纪律 — 区分相关与因果
5. 量化反应 — 用具体 %/bps，不用模糊词
6. 信源分层 — 官方 > Tier 1 > 专业媒体

**常见陷阱:** 过度归因、近因偏差、后见之明、单因素分析、忽视幅度差异。

## ⚠ 反模式
- ❌ 只推新闻标题，不提取结构化事件
- ❌ 个股新闻不关联股价影响
- ❌ A股数据（龙虎榜/资金流）不区分主力/散户
- ❌ 原始feeds不过滤重复内容
- ❌ 不把结构化事件输入research Scenarios

---

## Mode 3: Stock（个股新闻情绪）

**来源:** yfinance（无需 API Key）

### 执行

```bash
python3 skills/news-dashboard/scripts/news.py SYMBOL [--limit 10]
```

### 输出

返回 JSON：
- `articles` — 标题、来源、日期、链接
- `summary` — 整体情绪摘要

呈现关键标题，标注可能影响股价的重要新闻。

---

## Resources

### scripts/（可执行脚本）

| 脚本 | 用途 | 模式 |
|------|------|------|
| `macro_news_dashboard.py` | 宏观新闻主程序（收集+处理+报告） | market |
| `report_generator.py` | Markdown/JSON 报告生成 | market |
| `collectors/market_news_collector.py` | Finnhub 市场新闻收集 | market |
| `collectors/sector_news_collector.py` | Finnhub 板块新闻收集 | market |
| `collectors/fed_news_collector.py` | 央行新闻过滤 | market |
| `collectors/calendar_collector.py` | 经济日历收集 | market |
| `processors/news_classifier.py` | 新闻分类 | market |
| `processors/news_clusterer.py` | 新闻聚类 | market |
| `processors/impact_scorer.py` | 影响力评分 | market |
| `news.py` | 个股新闻获取（yfinance） | stock |

### references/（知识库，deep 模式按需加载）

| 文件 | 内容 |
|------|------|
| `market_event_patterns.md` | 央行/通胀/就业/GDP/地缘/财报/信用事件历史模式 |
| `geopolitical_commodity_correlations.md` | 地缘政治-商品相关性（能源/贵金属/基本金属/农产品/稀土） |
| `corporate_news_impact.md` | 巨头分析框架（Mag 7 + 金融/医疗/能源/消费/工业） |
| `trusted_news_sources.md` | 信源可信度分级（4 层） + 搜索策略 |

---

## Mode 5: A股数据端点（直连 akshare / 上游 API）

**数据源**：直连 akshare / 上游 API。

### 5.1 龙虎榜（直连 akshare）

```bash
python3 -c "
import akshare as ak, json
df = ak.stock_lhb_detail_em(start_date='20260428', end_date='20260430')
print(df[['代码','名称','上榜日','解读','涨跌幅','龙虎榜净买额','上榜原因']].head(20).to_string())
"
```
触发词：龙虎榜、机构买卖、游资席位

### 5.2 个股资金流向

**优先 futu**（实时性更好）：
```bash
python3 skills/futuapi/scripts/quote/get_capital_flow.py SH.600519 --json
```
**fallback akshare**：
```bash
python3 -c "
import akshare as ak
df = ak.stock_individual_fund_flow(stock='600519', market='sh')
print(df.tail(5).to_string())
"
```
触发词：资金、主力、北向

### 5.3 热门板块

**优先 futu**：
```bash
python3 skills/futuapi/scripts/quote/get_plate_list.py --market HK --type INDUSTRY --json
```
**fallback akshare**（A股板块）：
```bash
python3 -c "
import akshare as ak
df = ak.stock_board_industry_name_em()
print(df.sort_values('涨跌幅', ascending=False).head(10).to_string())
"
```
触发词：热门板块、板块涨幅、行业资金

### 5.4 IPO 日历

**优先 futu**（港股美股准确）：
```bash
python3 skills/futuapi/scripts/quote/get_ipo_list.py --market HK --json
```
**A股 fallback akshare**：
```bash
python3 -c "
import akshare as ak
df = ak.stock_xgsglb_em(symbol='全部')
print(df.head(20).to_string())
"
```
触发词：IPO、新股、申购

### 5.5 财报日历

**美股 fallback**（yfinance）：
```bash
python3 -c "
import yfinance as yf
print(yf.Ticker('AAPL').calendar)
"
```
**A股**：
```bash
python3 -c "
import akshare as ak
df = ak.stock_yjyg_em(date='20260331')  # 业绩预告
print(df.head(20).to_string())
"
```
触发词：财报、业绩、earnings

### 5.6 机构调研

```bash
python3 -c "
import akshare as ak
# 注意：调研日期需为有数据的工作日
df = ak.stock_jgdy_detail_em(date='20260428')
print(df.head(10).to_string())
"
```
若 NoneType 错误：换日期或用 `stock_jgdy_em(date=...)` 汇总版。

### 5.7 研报

```bash
python3 -c "
import akshare as ak
df = ak.stock_research_report_em(symbol='000001')
print(df.head(10).to_string())
"
```

### 5.8 限售解禁

```bash
python3 -c "
import akshare as ak
df = ak.stock_restricted_release_queue_em()
print(df.head(20).to_string())
"
```

### 5.9 市场情绪 / 恐慌贪婪

**推荐**直接用 `market-pulse` skill 或 CoinMarketCap 官方 MCP `cmc-mcp` 的免费 Fear & Greed / global metrics 能力。不要为新闻面板调用 CMC x402、私钥、pay-per-request 或付费历史端点。若 MCP 不可用，可临时用官方 REST latest 端点：
```bash
curl -sS -H "X-CMC_PRO_API_KEY: $CMC_PRO_API_KEY" \
  "https://pro-api.coinmarketcap.com/v3/fear-and-greed/latest" | jq '.data'
```
**A股情绪 fallback**：
```bash
python3 -c "
import akshare as ak
df = ak.stock_market_activity_legu()  # 涨跌停统计
print(df.to_string())
"
```

### 5.10 Polymarket / Kalshi 预测市场

直连（Polymarket Gamma / Kalshi API）：
```bash
# Polymarket
curl -sS "https://gamma-api.polymarket.com/events?closed=false&active=true&limit=20&order=volume" \
  | jq '.[] | {title, vol: .volume, end: .endDate}'

# Kalshi
curl -sS "https://api.elections.kalshi.com/trade-api/v2/markets?status=open&limit=20" \
  | jq '.markets[] | {ticker, title, yes_bid, no_bid}'
```

### 5.11 美股流动性（Net Liquidity / TGA / RRP）

```bash
# WALCL / TGA / RRP（FRED 直连）
for sid in WALCL WTREGEN RRPONTSYD; do
  curl -sS "https://api.stlouisfed.org/fred/series/observations?series_id=$sid&api_key=$FRED_API_KEY&limit=5&sort_order=desc&file_type=json" \
    | jq --arg s $sid '{series:$s, latest: .observations[0]}'
done
```

### 5.12 CoinMan 加密决策（已裁撤）

coinman skill 与 `coinman_score` 二进制已随 2026 上半年 declutter 移除（源码已不在仓内，
孤儿二进制 2026-07 清理）。加密盘面判断改用 `btc-guanfu` skill（guanfu 二进制）。

---


---

> 详见 [`references/shared-output-rules.md`](../references/shared-output-rules.md) — 中文输出规范、多市场 Ticker 识别、行情数据源优先级、Dashboard JSON 格式。
