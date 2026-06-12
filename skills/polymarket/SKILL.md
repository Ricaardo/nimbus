---
name: polymarket
description: Polymarket 预测市场交易（官方 Polymarket/agents AI 框架）。能力：浏览市场/事件、拉相关新闻、超级预测者(superforecaster)分析、本地市场 RAG、LLM 问答、自主交易 agent、实际下单。当用户询问 'Polymarket / 预测市场 / 赌盘 / 概率 / prediction market / 大选概率 / 下单 Polymarket / 买预测合约 / superforecaster' 时触发。NOT for: 加密现货/合约行情 → CoinMarketCap 官方 MCP `cmc-mcp`（只用免费/基础行情，不用 x402/私钥/付费端点）；BTC 周期 → btc-guanfu。
---

# Polymarket — 官方 agents 框架

基于 [Polymarket/agents](https://github.com/Polymarket/agents)（官方 MIT AI 交易框架）。2026-05-21 用它替换了旧的 polyclaw + tracker 自制脚本。

## 运行方式

venv 在 `.venv/`（Python 3.10，uv 安装，175 包）。所有命令需 `PYTHONPATH=.`：

```bash
cd ~/.claude/skills/polymarket
PYTHONPATH=. .venv/bin/python scripts/python/cli.py <command> [--opt value]
```

## 命令（cli.py）

| 命令 | 作用 | 需要 |
|---|---|---|
| `get-all-markets --limit N --sort-by spread` | 浏览热门市场 | 私钥* |
| `get-all-events --limit N` | 浏览事件 | 私钥* |
| `get-relevant-news "keywords"` | 拉相关新闻 | NEWSAPI key |
| `ask-superforecaster "<event>" "<question>" "<outcome>"` | 超级预测者概率分析 | OPENAI key |
| `create-local-markets-rag <dir>` / `query-local-markets-rag <db> "<q>"` | 本地市场向量检索 | OPENAI key |
| `ask-llm "<input>"` / `ask-polymarket-llm "<input>"` | LLM 问答（带市场上下文） | OPENAI key |
| `run-autonomous-trader` | 自主交易 agent（自动找市场+下单） | 全部 key ⚠️ |

下单逻辑也可直接走 `agents/application/trade.py`。

> *注：本框架在 `cli.py` 导入时即实例化 `Polymarket()`，会用 `POLYGON_WALLET_PRIVATE_KEY` 派生 CLOB API 凭证——**即便只读命令也需先配钱包私钥**。

## 配置（.env，已建空模板，密钥由主人自己填）

```
POLYGON_WALLET_PRIVATE_KEY=""   # Polygon 钱包私钥，所有命令必需
OPENAI_API_KEY=""               # LLM 类命令必需
TAVILY_API_KEY=""               # 新闻/搜索（你已有 tavily MCP，此处是 raw API key）
NEWSAPI_API_KEY=""              # get-relevant-news 必需
```

`.env` 已被 `.gitignore` 覆盖，不会进 git。Cici 不代填密钥。

## ⚠️ 风险

- 真金白银下单，Polygon 链上结算，单合约 0–1 美元；流动性差的市场滑点大。
- `run-autonomous-trader` 会**自动决策并下单**，先用小额或在了解逻辑后再开。
- 美国 IP 受限，注意网络环境。
- 交易记录建议同步到 [[trade-journal]]；论点用 [[thesis-tracker]] 跟踪。
