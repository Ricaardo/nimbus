# Shared Output Rules

**Import**: 所有需要中文输出的投资分析 skill 引用此文件，不再在每个 SKILL.md 尾部重复。

---

## 中文输出

- 所有分析报告、摘要、建议使用**中文**输出
- 保留英文的情况：ticker 代码（AAPL, 600519.SH）、专有名词首次出现时附英文（市盈率 P/E）、数据源名称
- 数字格式：使用国际通用格式（1,234.56），不使用中文万/亿换算（除非用户要求）

---

## 多市场 Ticker 识别

根据输入的 ticker 格式自动识别市场并选择数据源：

| 格式 | 示例 | 市场 | 数据源 |
|---|---|---|---|
| 1-5 位大写字母 | AAPL, MSFT | 美股 | futuapi / yfinance / FMP |
| 6位数字.SH/.SZ | 600519.SH, 000858.SZ | A 股 | futuapi / AKShare |
| 4-5位数字.HK | 00700.HK, 09988.HK | 港股 | futuapi / AKShare |
| BTC, ETH 等 | BTC, ETH, SOL | 加密货币 | CoinMarketCap 官方 MCP (`cmc-mcp`, 免费/基础能力) / CoinGecko fallback |
| XAU, XAG | XAU, GLD | 贵金属 | AKShare |

---

## 行情数据源优先级（全市场统一）

**获取实时报价 / 历史 K 线时，优先使用 futu helpers（本地 OpenD，零延迟）**：

```bash
# 实时报价（支持批量，自动映射 ticker）
python3 /Users/x/.claude/skills/futuapi/scripts/helpers/get_price.py AAPL 600519.SH 00700.HK ^HSI

# 历史 OHLCV
python3 /Users/x/.claude/skills/futuapi/scripts/helpers/get_ohlcv.py AAPL --period 1y --format csv
```

Ticker 自动识别：`AAPL` / `600519.SH` / `000858.SZ` / `00700.HK` / `^HSI` / `^GSPC`（美股指数自动用 ETF 代理：^GSPC→SPY / ^IXIC→QQQ / ^DJI→DIA）。

**覆盖范围**：美股 / 港股 / A股 / 指数（ETF 代理） — futu 覆盖
**不覆盖**：加密货币 / 商品期货 → CoinGecko / yfinance / AKShare

**Fallback 链（各市场）**：

| 市场 | 优先级 |
|---|---|
| 美股 | futuapi → IBKR MCP → yfinance → FMP |
| 港股 | futuapi → AKShare → WebSearch |
| A 股 | futuapi → AKShare → 东方财富 |
| 加密 | CoinMarketCap 官方 MCP (`cmc-mcp`: quotes/global metrics/F&G/trending/category 基础数据) → CoinGecko fallback → AKShare；避免 CMC x402/私钥/pay-per-request/付费历史端点 |
| 贵金属 | AKShare → yfinance |

调用策略：futu 失败（返回 error 字段或抛异常）再 fallback。

---

## Dashboard JSON 输出（可选）

当用户请求 dashboard 格式时，在报告末尾额外输出 Recharts 兼容 JSON：

```json
{
  "title": "分析标题",
  "generated_at": "ISO8601时间戳",
  "charts": [
    {"id": "chart_1", "type": "line|bar|area|pie|heatmap", "title": "图表标题", "data": [...], "xKey": "date", "yKeys": ["value"]}
  ],
  "metrics": [
    {"label": "指标名", "value": "数值", "change": "+5.2%", "trend": "up|down|flat"}
  ],
  "summary": "一句话结论"
}
```

保存为 `reports/<skill_name>_dashboard_YYYYMMDD.json`
