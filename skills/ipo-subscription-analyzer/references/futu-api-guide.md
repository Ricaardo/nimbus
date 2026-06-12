# Futu API 与数据源指南

> 当需要获取 IPO 原始数据或排查数据源问题时查阅此文件。

## 港股 IPO 数据源优先级

1. **futuapi（首选）** — 富途 OpenD 提供实时港股 IPO 基础数据，招股当天即可获取
2. **WebSearch** — futuapi 不可用时的 fallback

**futuapi 能提供的字段**：代码、名称、上市日、招股价区间、每手股数、入场费、认购状态、上市价
**futuapi 不提供的字段**：超额认购倍数、基石投资者、保荐人、暗盘价、首日涨幅、历史 IPO 数据

以上缺失字段全部通过 WebSearch 获取。

## 各市场数据源覆盖

| 市场 | 结构化 API | WebSearch | 说明 |
|------|-----------|-----------|------|
| **美股** | Finnhub `ipo_calendar` / FMP `ipo_calendar` | Nasdaq / IPOScoop | API 优先 |
| **A 股** | AKShare `stock_new_ipo_cninfo()` / `stock_zh_a_new_em()` | 东财 / 同花顺 | API 优先 |
| **港股** | **futuapi（富途 OpenD）** | 东财港股 / AAStocks / HKEX | **futuapi 首选** |

## futuapi 港股 IPO 用法

```python
from futu import *

quote_ctx = OpenQuoteContext(host='127.0.0.1', port=11111)

# 1. 获取港股 IPO 列表（核心）
ret, data = quote_ctx.get_ipo_list(Market.HK)
if ret == RET_OK:
    print(data)
    # 返回字段:
    #   code, name, list_time, ipo_price_min, ipo_price_max,
    #   list_price, lot_size, entrance_price, is_subscribe_status,
    #   apply_end_time

# 2. 获取已上市新股行情（首日价格）
ret, data = quote_ctx.get_market_snapshot(['HK.XXXX'])

# 3. 获取实时报价（暗盘时段可用）
ret, data = quote_ctx.get_stock_quote(['HK.XXXX'])

# 4. 美股 IPO
ret, data = quote_ctx.get_ipo_list(Market.US)

quote_ctx.close()
```

**前提**：OpenD 必须运行在 `127.0.0.1:11111`

## API 端点明细

| 数据源 | 市场 | 端点/函数 | 用途 |
|--------|------|----------|------|
| **futuapi** | **港股/美股** | `quote_ctx.get_ipo_list(Market.HK/US)` | **IPO 日历（首选）** |
| Finnhub | 美股 | `GET /calendar/ipo?from=YYYY-MM-DD&to=YYYY-MM-DD` | IPO 日历 |
| FMP | 美股 | `GET /api/v3/ipo_calendar?from=&to=&apikey=` | IPO 日历 + 招股书链接 |
| FMP | 美股 | `GET /api/v4/ipo-calendar-confirmed` | 已确认 IPO |
| AKShare | A 股 | `ak.stock_new_ipo_cninfo()` | A 股新股数据 |
| AKShare | A 股 | `ak.stock_zh_a_new_em()` | 新股实时行情 |

## WebSearch 查询模板（fallback）

| 市场 | 搜索查询模板 | 优先数据源 |
|------|-------------|-----------|
| 港股 | `"港股IPO 本周招股 {年月}"` | **futuapi** → 东财港股新股 → AAStocks → HKEX |
| 美股 | `"US IPO calendar this week {year}"` | **futuapi** → Finnhub/FMP → Nasdaq IPO Calendar |
| A 股 | `"A股新股申购 本周 {年月}"` | AKShare → 东方财富新股 → 同花顺新股 |
| 通用 | `"[公司名] 招股书 cornerstone investors"` | 各类研报、新闻 |

## Fallback 注意事项

港交所 HKEXnews PDF 公告有 1-3 天索引延迟，财经媒体报道通常延迟 0.5-2 天。应对策略：
- 多时间窗口查询
- 搜索 `site:hkexnews.hk`
- 搜索 `"[公司名]" 打新 入场费 孖展`
- 若仍搜索无果，标注"数据待更新，建议通过 futuapi 或券商 APP 确认"
