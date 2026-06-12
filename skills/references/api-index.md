# API 索引

> 最后更新：2026-04-26

---

## 一、MCP (Model Context Protocol) 服务器

### 1. Alpaca (美股交易)
| 工具 | 用途 |
|---|---|
| `mcp__alpaca__get-assets` | 获取可交易资产列表 |
| `mcp__alpaca__get-market-days` | 查询交易日历 |
| `mcp__alpaca__get-news` | 获取市场新闻 |
| `mcp__alpaca__get-stock-bars` | 获取历史 K 线 |

### 2. CoinMarketCap 官方 MCP（加密行情 / 市场指标）
| 能力 | 用途 |
|---|---|
| Search Cryptocurrencies | 搜索加密货币，解决 symbol/slug 歧义 |
| Live Quotes | 实时报价、市值、成交量、涨跌幅 |
| Global Market Metrics | 总市值、24h 成交量、BTC/ETH dominance、Fear & Greed、Altcoin Season 等 |
| Crypto Info / Latest News / Trending Narratives | 币种信息、基础新闻、热门叙事（免费/基础可用范围内） |

**凭证**: `X-CMC-MCP-API-KEY` (MCP server config) — [获取](https://pro.coinmarketcap.com/login)

**边界**: 默认只用免费/基础能力；不要调用 CMC x402、私钥、pay-per-request 或明确付费/高级历史端点。

### 3. Tavily (网络搜索)
| 工具 | 用途 |
|---|---|
| `mcp__tavily__tavily_search` | 网页搜索 |
| `mcp__tavily__tavily_research` | 深度研究 |
| `mcp__tavily__tavily_crawl` | 网页爬取 |
| `mcp__tavily__tavily_extract` | 内容提取 |
| `mcp__tavily__tavily_map` | 站点地图 |

### 4. Grok Search (removed)

`grok-search` MCP is not configured locally as of 2026-05-22. Use `websearch`, Tavily, or the relevant domain skill instead.

### 5. Google Workspace
| 工具 | 用途 |
|---|---|
| `mcp__claude_ai_Gmail__authenticate` | Gmail 认证 |
| `mcp__claude_ai_Gmail__complete_authentication` | 完成 Gmail 认证 |
| `mcp__claude_ai_Google_Calendar__authenticate` | Google 日历认证 |
| `mcp__claude_ai_Google_Calendar__complete_authentication` | 完成日历认证 |
| `mcp__claude_ai_Google_Drive__authenticate` | Google Drive 认证 |
| `mcp__claude_ai_Google_Drive__complete_authentication` | 完成 Drive 认证 |

### 6. Candid (身份认证)
| 工具 | 用途 |
|---|---|
| `mcp__claude_ai_Candid__authenticate` | Candid 认证 |
| `mcp__claude_ai_Candid__complete_authentication` | 完成认证 |

---

## 二、Skill 内嵌 API（按领域分类）

### 行情与数据

| Skill | API / 数据源 | 凭证 |
|---|---|---|
| **market-data** | futu OpenAPI → CoinMarketCap 官方 MCP (`cmc-mcp`, 免费/基础 crypto market data) → CoinGecko/AKShare/yfinance fallback | OpenD 本地 + CMC MCP key |
| **futuapi** | 富途 OpenAPI (行情+交易) `127.0.0.1:11111` | OpenD |
| **cmc-mcp** | CoinMarketCap 官方 HTTP MCP（quotes/global metrics/F&G/trending/category 基础数据）| `X-CMC-MCP-API-KEY`；免费/基础能力优先，禁用 x402/私钥/pay-per-request/付费端点 |
| **market-pulse** | FRED, Finnhub, yfinance, AKShare | `FRED_API_KEY` |
| **event-calendar** | FMP API (财报/经济日历) | `FMP_API_KEY` |
| **news-dashboard** | Finnhub, 金十, BlockBeats, 证监会 RSS | `FINNHUB_API_KEY` |
| **institutional-flow-tracker** | SEC 13F filings (via FMP) | `FMP_API_KEY` |
| **rootdata-crypto** | RootData (Web3 项目/投资人/融资) | `ROOTDATA_SKILL_KEY` |
| **polymarket** | Polymarket Gamma API (预测市场) | Polymarket 账户 |
| **ipo-subscription-analyzer** | 港股/美股 IPO 公开数据 | — |
| **DeFiLlama**（共享 reference，非 skill）| L1 DeFi 宏观：TVL/收益/稳定币/费用/桥；`WebFetch` 直连 api.llama.fi 等 5 host；查协议见 `references/defillama-api.md` | 无 key、无地域限制 |

### 技术分析

| Skill | API / 数据源 | 凭证 |
|---|---|---|
| **technical-analysis** | pandas-ta + futu/yfinance/AKShare | — |

### 交易执行

| Skill | API / 数据源 | 凭证 |
|---|---|---|
| **futuapi** | 富途 OpenAPI 交易 (模拟/正式) | OpenD |
| **hyperliquid-cli** | Hyperliquid DEX 永续合约 | `hl` CLI 钱包 |
| **polymarket** | Polymarket CLOB + split 下单 | Polymarket 钱包 |
| **okx-dex** | OKX DEX 聚合器 (500+ 流动性源) | OKX 钱包 |
| **okx-wallet** | OKX 钱包 (多链余额/交易广播) | OKX 钱包 |
| **trade-execution** | 纯计算 (不调用外部 API) | — |

### 筛选

| Skill | API / 数据源 | 凭证 |
|---|---|---|
| **stock-screener** | futu + AKShare + yfinance + FMP | `FMP_API_KEY` |
| **options-strategy-advisor** | futu + yfinance (期权链/Greeks) | — |

### 组合管理

| Skill | API / 数据源 | 凭证 |
|---|---|---|
| **portfolio-manager** | Alpaca MCP (持仓/组合) + futu | Alpaca API key |
| **trade-journal** | 本地 YAML (无外部 API) | — |
| **thesis-tracker** | 本地文件 (无外部 API) | — |

### 估值与基本面

| Skill | API / 数据源 | 凭证 |
|---|---|---|
| **valuation** | Yahoo Finance, SEC EDGAR, AKShare | — |
| **us-stock-analysis** | futu + yfinance + FMP + valuation | `FMP_API_KEY` |

### 宏观/策略视角

| Skill | API / 数据源 | 凭证 |
|---|---|---|
| **macro-perspective** | market-pulse + market-data + sector-analyst (聚合) | — |
| **value-perspective** | valuation + market-pulse + sector-analyst (聚合) | — |
| **sector-analyst** | TraderMonty CSV + futu + yfinance + EIA/COMEX | — |

---

## 三、社交与通讯 API

| Skill | API / 协议 | 凭证 |
|---|---|---|
| **x** | X (Twitter) API v2 (读+写) | OAuth 2.0 token |
| **discord** | Discord HTTP API (Bot) | `DISCORD_BOT_TOKEN` |
| **binance-square** | Binance Square OpenAPI `POST /bapi/composite/v1/public/pgc/openApi/content/add` | `X-Square-OpenAPI-Key` |
| **bluebubbles** | BlueBubbles 服务端 (iMessage) | 服务器 URL + 密码 |
| **himalaya** | IMAP/SMTP (邮件) | `~/.config/himalaya/config.toml` |
| **voice-call** | Twilio / Telnyx / Plivo | 提供商 API key |

---

## 四、生产力 API

| Skill | API / CLI | 凭证 |
|---|---|---|
| **notion** | Notion REST API | `~/.config/notion/api_key` |
| **trello** | Trello REST API | `TRELLO_API_KEY` + `TRELLO_TOKEN` |
| **things-mac** | Things 3 CLI (本地 SQLite) | — |
| **obsidian** | obsidian-cli (本地 Markdown) | — |
| **apple-notes** | memo CLI (本地 Apple Notes) | — |
| **github** | gh CLI → GitHub API | `GH_TOKEN` |
| **tmux** | tmux (本地终端) | — |
| **1password** | op CLI → 1Password | 桌面应用已解锁 |

---

## 五、AI / 多媒体 API

| Skill | API / CLI | 凭证 |
|---|---|---|
| **openai-image-gen** | OpenAI Images API | `OPENAI_API_KEY` |
| **openai-whisper** | Whisper CLI (本地) | — |
| **sag** | ElevenLabs TTS API | `ELEVENLABS_API_KEY` |
| **websearch** | 内置 websearch + Tavily MCP（grok-search 已于 2026-05-22 移除）| MCP 已配置 |

---

## 六、其他工具 API

| Skill | API / CLI | 凭证 |
|---|---|---|
| **weather** | wttr.in / Open-Meteo | — |
| **spotify-player** | Spotify Web API (via spogo) | Spotify Premium |
| **blogwatcher** | blogwatcher CLI (RSS/Atom) | — |
| **browser-use** | browser-use CLI (Playwright) | — |
| **session-logs** | 本地 JSONL (~/.claude/sessions/) | — |

---

## 七、外部 API Key 汇总

| Key | 用途 | 配置位置 |
|---|---|---|
| `ANTHROPIC_AUTH_TOKEN` | DeepSeek API | settings.json env |
| `ANTHROPIC_BASE_URL` | `https://api.deepseek.com/anthropic` | settings.json env |
| `FMP_API_KEY` | 财报/经济日历/13F/筛选 | 环境变量 |
| `FINNHUB_API_KEY` | 新闻/宏观 | 环境变量 |
| `FRED_API_KEY` | 美联储经济数据 | 环境变量 |
| `OPENAI_API_KEY` | 图片生成 | 环境变量 |
| `ELEVENLABS_API_KEY` | 语音合成 | 环境变量 |
| `DISCORD_BOT_TOKEN` | Discord Bot | 环境变量 |
| `ROOTDATA_SKILL_KEY` | Web3 数据 | 环境变量 |
| `TRELLO_API_KEY` / `TRELLO_TOKEN` | Trello | 环境变量 |
| `X-CMC-MCP-API-KEY` | CoinMarketCap | MCP servers config |
| Alpaca API Key | 美股交易+组合 | MCP servers config |
| X Bearer Token | Twitter | skill 内部 |
| Binance Square API Key | 币安广场 | memory |
| Polymarket 钱包 | 预测市场交易 | skill 内部 |
| OKX 钱包 | DEX/链上 | skill 内部 |
| 1Password | 密码管理 | macOS keychain |
