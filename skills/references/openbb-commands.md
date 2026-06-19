# OpenBB 调用速查（nimbus 专用）

> OpenBB = **美股/宏观/filings 的免费 fallback**。A/H 不走它（仍 longbridge/futu 持牌优先）。
> 21 个 provider 已装；下面命令均在本机实测可用。命令面很大，**照本表调用，别凭空猜 `obb.x.y` 路径**。

## 怎么调用（两种，优先 CLI）

**① Python CLI（推荐，任意对话零 MCP 成本）：**
```bash
~/nimbus-stack/nimbus/.venv-openbb/bin/python -c "
from openbb import obb
r = obb.equity.fundamental.metrics('AAPL', provider='fmp')
print(r.to_df().T)   # 或 r.results
"
```
- 输出 DataFrame：`r.to_df()`；原始：`r.results`（pydantic 列表，`.model_dump()` 转 dict）。
- 不确定某命令支持哪些 provider：`obb.coverage.providers`（provider→命令）。

**② MCP（仅交互式需要时）：** OpenBB 是**休眠 stdio MCP**，默认不加载。该轮 run 需显式 `mcpAllow:['openbb']` 才暴露工具；常规自动化用上面的 CLI。

## 命令 → provider 映射（实测）

### 个股基本面 / 估值
| 要什么 | 命令 | provider |
|---|---|---|
| 关键财务指标 | `obb.equity.fundamental.metrics(T, provider=)` | **fmp** / finviz / yfinance |
| 财务比率 | `obb.equity.fundamental.ratios(T, provider='fmp')` | fmp |
| 历史 EPS | `obb.equity.fundamental.historical_eps(T, provider='fmp')` | fmp |
| 报价 / 历史价 | `obb.equity.price.quote / .historical(T, provider=)` | fmp / yfinance / cboe |
| 前瞻预期(EPS/sales) | `obb.equity.estimates.forward_eps / forward_sales(T, provider=)` | **seeking_alpha** / fmp |

### SEC 文件 / 财报会
| 要什么 | 命令 | provider |
|---|---|---|
| SEC filings 列表 | `obb.equity.fundamental.filings(T, provider='sec')` | **sec** / fmp |
| 最新财报全文 | `obb.equity.discovery.latest_financial_reports(provider='sec')` | sec |
| 财报电话会 transcript | `obb.equity.fundamental.transcript(T, year=, provider='fmp')` | fmp |
| 财报日历 | `obb.equity.calendar.earnings(provider=)` | seeking_alpha / fmp |
| 失败交割(FTD) | `obb.equity.shorts.fails_to_deliver(T, provider='sec')` | sec |

### 期权 / 波动率 / 做空
| 要什么 | 命令 | provider |
|---|---|---|
| 期权链 | `obb.derivatives.options.chains(T, provider=)` | **cboe** / yfinance / deribit(加密) |
| VIX / 指数历史 | `obb.index.price.historical('VIX', provider='cboe')` | cboe |
| 做空兴趣 | `obb.equity.shorts.short_interest(T, provider='finra')` | finra |
| 做空量 | `obb.equity.shorts.short_volume(T, provider='stockgrid')` | stockgrid |

### 宏观 / 估值锚 / 持仓
| 要什么 | 命令 | provider |
|---|---|---|
| **Shiller CAPE/PE** | `obb.index.sp500_multiples(series_name='shiller_pe_month', provider='multpl')` | multpl |
| FRED 任意序列 | `obb.economy.fred_series('DGS10', provider='fred')` | fred |
| CPI | `obb.economy.cpi(country='united_states', provider=)` | fred / oecd / imf |
| GDP | `obb.economy.gdp.real / .nominal(provider=)` | econdb / oecd |
| 美债利率 | `obb.fixedincome.government.treasury_rates(provider='federal_reserve')` | federal_reserve |
| **COT 持仓报告** | `obb.cftc.cot(provider='cftc')` / `obb.cftc.cot_search('gold')` | cftc(keyless) |
| 能源(原油/天然气) | `obb.commodity.short_term_energy_outlook(provider='eia')` | eia |
| ECB 利率/收益率 | `obb.currency.reference_rates / obb.fixedincome.government.yield_curve(provider='ecb')` | ecb |

## provider 选择原则
- 有 **fmp**(有key) 的优先 fmp；纯免费场景用 keyless（sec/cboe/yfinance/multpl/cftc/finra…）。
- **A/H 标的不要用 OpenBB**（覆盖差）→ 走 longbridge/futu。
- 报错 "Input should be 'x','y'…" = 该命令不支持你给的 provider，换表里列的。
