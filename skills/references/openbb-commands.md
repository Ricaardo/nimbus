# OpenBB 调用速查（nimbus 专用）

> OpenBB = **美股/宏观/filings 的免费 fallback**。A/H 不走它（仍 longbridge/futu 持牌优先）。
> 21 个 provider 已装；本表为 2026-07 实测结果，✅=可用，⚠️=偶尔 timeout（重试即可），❌=需付费 key。
> **照本表调用，别凭空猜 `obb.x.y` 路径。**

## 怎么调用（两种）

**① Python CLI（推荐，零 MCP 成本，任意对话环境）：**
```bash
~/nimbus-os/nimbus/.venv-openbb/bin/python -c "
from openbb import obb
r = obb.equity.fundamental.metrics('AAPL', provider='fmp')
print(r.to_df().T)   # DataFrame 输出
# r.results → pydantic 对象列表
"
```
- `r.to_df()` = pandas DataFrame；`r.results` = pydantic 列表，`.model_dump()` 转 dict。
- 不确定 provider：`obb.coverage.providers` → provider→命令映射。
- 对象型返回（options/cik/ref_rates）：`r.results[0]` 直接取。

**② MCP（仅交互式需要时）：** OpenBB 是**休眠 stdio MCP**，默认不加载。常规自动化用上面的 CLI。

---

## 实测可用性表

### 💰 个股基本面 / 估值

| 要什么 | 命令 | provider | 实测 |
|---|---|---|---|
| 实时报价 | `obb.equity.price.quote(T)` | cboe / fmp / yfinance | ✅ 三家全通 |
| 历史日K | `obb.equity.price.historical(T, start_date=, end_date=)` | yfinance / cboe / fmp | ✅ 三家全通 |
| 公司资料 | `obb.equity.profile(T)` | yfinance / fmp | ✅ |
| 股票搜索 | `obb.equity.search(T)` | cboe（5319 条） | ✅ |
| 关键财务指标 | `obb.equity.fundamental.metrics(T)` | **yfinance** / fmp / finviz | ✅ |
| 财务比率 | `obb.equity.fundamental.ratios(T)` | fmp | ✅ |
| 资产负债表 | `obb.equity.fundamental.balance(T)` | yfinance / fmp / sec | ✅ |
| 利润表 | `obb.equity.fundamental.income(T)` | yfinance / fmp / sec | ✅ |
| 现金流量表 | `obb.equity.fundamental.cash(T)` | yfinance / fmp / sec | ✅ |
| 分红历史 | `obb.equity.fundamental.dividends(T)` | yfinance (91 条) / fmp | ✅ |
| 历史 EPS | `obb.equity.fundamental.historical_eps(T)` | fmp | ❌ 需付费 fmp |
| 管理层 | `obb.equity.fundamental.management(T)` | yfinance / fmp | ✅ |
| 营收拆分（地域） | `obb.equity.fundamental.revenue_per_geography(T)` | fmp | ✅ |
| 营收拆分（业务线） | `obb.equity.fundamental.revenue_per_segment(T)` | fmp | ✅ |
| 市值历史 | `obb.equity.historical_market_cap(T)` | fmp | ✅ |
| 同行对比 | `obb.equity.compare.peers(T)` | fmp | ✅ |
| 股价表现 | `obb.equity.price.performance(T)` | finviz / yfinance | ❌ 需付费 finviz |
| 市场快照 | `obb.equity.market_snapshots` | fmp / yfinance | ❌ 需付费 key |

### 📊 股票筛选 & 发现

| 要什么 | 命令 | provider | 实测 |
|---|---|---|---|
| 涨幅榜 | `obb.equity.discovery.gainers` | fmp（50 条） | ✅ |
| 跌幅榜 | `obb.equity.discovery.losers` | fmp（50 条） | ✅ |
| 活跃榜 | `obb.equity.discovery.active` | fmp（50 条） | ✅ |
| 通用筛选器 | `obb.equity.screener` | yfinance（200 条）/ fmp / finviz | ✅ yfinance 免费 |
| FTD 失败交割 | `obb.equity.shorts.fails_to_deliver(T)` | sec | ✅ |
| 做空兴趣 | `obb.equity.shorts.short_interest(T)` | finra | ❌ finra 1s timeout（network 限） |
| 做空成交量 | `obb.equity.shorts.short_volume(T)` | stockgrid | ❌ 需付费 key |

### 📋 日历

| 要什么 | 命令 | provider | 实测 |
|---|---|---|---|
| 财报日历 | `obb.equity.calendar.earnings(start_date=, end_date=)` | **fmp** / seeking_alpha | ✅ fmp |
| 分红日历 | `obb.equity.calendar.dividend(start_date=, end_date=)` | fmp | ✅ |
| IPO 日历 | `obb.equity.calendar.ipo(start_date=, end_date=)` | fmp | ❌ 需付费 fmp |
| 事件日历 | `obb.equity.calendar.events(T, start_date=, end_date=)` | fmp | ❌ 需付费 fmp |
| 拆股日历 | `obb.equity.calendar.splits(T)` | fmp | ⚠️ 0 结果 |

### 📈 分析师预期

| 要什么 | 命令 | provider | 实测 |
|---|---|---|---|
| 分析师共识 | `obb.equity.estimates.consensus(T)` | yfinance / fmp | ✅ yfinance |
| 目标价 | `obb.equity.estimates.price_target(T)` | fmp / finviz / yfinance | ❌ 需付费 fmp/finviz |
| 前瞻 EPS | `obb.equity.estimates.forward_eps(T)` | seeking_alpha / fmp | ❌ 需付费 |
| 前瞻 EBITDA | `obb.equity.estimates.forward_ebitda(T)` | fmp | ❌ 需付费 fmp |

### 🔐 持仓 / 内部人

| 要什么 | 命令 | provider | 实测 |
|---|---|---|---|
| SEC 文件列表 | `obb.equity.fundamental.filings(T)` | **sec**（1000 条）/ fmp | ✅ sec 免费！ |
| 13F 持仓 | `obb.equity.ownership.form_13f(T)` | sec | ⚠️ 需用 CIK 查（非 ticker） |
| 内部人交易 | `obb.equity.ownership.insider_trading(T)` | sec / fmp / yfinance | ❌ 需付费 |
| 机构持仓 | `obb.equity.ownership.institutional(T)` | fmp / yfinance | ❌ 需付费 fmp |
| 主要持有人 | `obb.equity.ownership.major_holders(T)` | fmp | ❌ 需付费 fmp |
| MD&A 讨论分析 | `obb.equity.fundamental.management_discussion_analysis(T)` | sec | ✅ 返回对象 |
| 三表增长率 | `obb.equity.fundamental.balance_growth / .income_growth / .cash_growth(T)` | sec | ✅ 免费！ |

### 🟠 期权 / 期货

| 要什么 | 命令 | provider | 实测 |
|---|---|---|---|
| 期权链 | `obb.derivatives.options.chains(T)` | **cboe** 3488 / **yfinance** 2864 / deribit 874 | ✅ 全部有数据 |
| 波动率曲面 | `obb.derivatives.options.surface(data=T)` | cboe | ✅ 需要先拉取 chains |
| 期货曲线 | `obb.derivatives.futures.curve(S)` | yfinance / cboe / deribit | ✅ |
| 期货历史 | `obb.derivatives.futures.historical(S)` | yfinance / deribit | ✅ |
| 期货合约信息 | `obb.derivatives.futures.info(S)` | deribit（92 条） | ✅ |
| 期货品种列表 | `obb.derivatives.futures.instruments` | deribit | ✅ |

### 💎 加密货币

| 要什么 | 命令 | provider | 实测 |
|---|---|---|---|
| 历史 K 线 | `obb.crypto.price.historical(S)` | yfinance / fmp / cboe | ✅ yfinance |
| 交易对搜索 | `obb.crypto.search(S)` | fmp（4785 条）| ✅ |

### 💱 外汇

| 要什么 | 命令 | provider | 实测 |
|---|---|---|---|
| 历史汇率 | `obb.currency.price.historical(P)` | yfinance | ✅ |
| 央行参考汇率 | `obb.currency.reference_rates` | ecb | ✅ 返回对象 |
| 货币对搜索 | `obb.currency.search(S)` | cboe | ✅ |
| 汇率快照 | `obb.currency.snapshots` | cboe / fmp | ✅ cboe |

### 📊 指数

| 要什么 | 命令 | provider | 实测 |
|---|---|---|---|
| SP500 长期估值 | `obb.index.sp500_multiples` | multpl（**1867 条**） | ✅ |
| 指数行情 | `obb.index.price.historical(S)` | cboe / yfinance | ✅ VIX/SPX 均可 |
| 指数搜索 | `obb.index.search(S)` | cboe（1153 条） | ✅ |
| 指数快照 | `obb.index.snapshots` | cboe（796 条） | ✅ |
| 指数列表 | `obb.index.available` | cboe | ✅ |
| 指数成分股 | `obb.index.constituents(S)` | cboe | ⚠️ 部分指数无数据 |

### 📈 ETF

| 要什么 | 命令 | provider | 实测 |
|---|---|---|---|
| ETF 基本信息 | `obb.etf.info(S)` | yfinance / fmp | ✅ yfinance |
| ETF 历史净值 | `obb.etf.historical(S)` | yfinance / fmp | ✅ yfinance |
| ETF 持仓 | `obb.etf.holdings(S)` | fmp / yfinance | ❌ 需付费 key |
| ETF 搜索 | `obb.etf.search(S)` | fmp / yfinance | ❌ 需付费 |
| ETF 涨跌榜 | `obb.etf.discovery.gainers / .losers / .active` | wsj（10 条） | ✅ |
| ETF 行业/国家分布 | `obb.etf.sectors / .countries(S)` | fmp | ❌ 需付费 |

### 🏛 宏观经济

| 要什么 | 命令 | provider | 实测 |
|---|---|---|---|
| **Shiller CAPE/PE** | `obb.index.sp500_multiples(series_name='shiller_pe_month')` | multpl | ⭐ 1867 个月 |
| CPI | `obb.economy.cpi(country='united_states')` | **fred** / oecd / imf | ✅ |
| GDP（实际） | `obb.economy.gdp.real` | oecd / econdb | ✅ 317 条 |
| GDP（名义） | `obb.economy.gdp.nominal` | econdb / oecd | ✅ 313 条 |
| GDP 预测 | `obb.economy.gdp.forecast` | oecd | ✅ |
| 失业率 | `obb.economy.unemployment(country='united_states')` | oecd / fred | ✅ 857 条 |
| 利率 | `obb.economy.interest_rates(country='united_states')` | oecd / fred | ✅ 744 条 |
| FRED 序列搜索 | `obb.economy.fred_search(query=)` | fred（488 条） | ✅ |
| 风险溢价 | `obb.economy.risk_premium(start_date=, end_date=)` | fmp | ✅ 192 条 |
| GDP 平减指数 | `obb.economy.retail_prices / .pce / .money_measures` | fred | ✅ 需要点耐心 |
| BLS 序列 | `obb.economy.survey.bls_series / .bls_search` | bls | ❌ timeout |

**FRED 序列（需要 FRED API key — 已配）：**
```bash
# SOFR / EFFR / IORB 等基准利率
obb.fixedincome.rate.sofr / .effr / .iorb(...) provider='fred'
# 收益率曲线
obb.fixedincome.government.yield_curve(date=) provider='fred'
# TIPS 收益率
obb.fixedincome.government.tips_yields provider='fred'
# 商业票据 / HQM / 即期利率
obb.fixedincome.corporate.commercial_paper / .hqm / .spot_rates provider='fred'
# 利差
obb.fixedincome.spreads.tcm / .tcm_effr / .treasury_effr provider='fred'
# 债券/按揭指数
obb.fixedincome.bond_indices / .mortgage_indices provider='fred'
# 调查（SLOOS/密歇根/芝加哥/纽约/德州/非农）
obb.economy.survey.nonfarm_payrolls / .sloos / .university_of_michigan(...) provider='fred'
# 大宗商品现货（天然气可用，原油偶尔 timeout）
obb.commodity.price.spot(commodity='natural_gas') provider='fred'
```
> ⚠️ 注意：OpenBB 内置 FRED client 有 5s timeout。个别命令有时超时（`fred_series`、`treasury_rates`、`crude_oil`），**重试一次即可**。直连 key 是通的：`curl -s "https://api.stlouisfed.org/fred/series/observations?series_id=DGS10&api_key=4f133c688c8be7b094b31c67e10f1d24&file_type=json&limit=3"`
>
> **FRED 重试包装器**（绕过 5s timeout）：
> ```python
> from references.fred_wrapper import fred_series
> df = fred_series("DCOILWTICO")  # 原油现货，自动重试+15s timeout
> print(df.to_string())
> ```
> 从 `nimbus-os/nimbus/skills/` 目录运行，或 `sys.path` 加上该路径。
> 先试 openbb 快路径，超时自动 fallback 到 requests 直连 FRED API（15s timeout）。

### 🛢 大宗商品

| 要什么 | 命令 | provider | 实测 |
|---|---|---|---|
| 天然气现货 | `obb.commodity.price.spot(commodity='natural_gas')` | fred（742 条） | ✅ |
| 原油现货 | `obb.commodity.price.spot(commodity='crude_oil')` | fred | ⚠️ 多次 timeout（用 FRED 包装器 `mod.fred_series('DCOILWTICO')` 可绕过） |
| EIA 石油报告 | `obb.commodity.petroleum_status_report` | eia（132K 条） | ✅ |
| EIA 短期能源展望 | `obb.commodity.short_term_energy_outlook` | eia（9360 条） | ✅ |

### 📰 新闻 / SEC / 监管

| 要什么 | 命令 | provider | 实测 |
|---|---|---|---|
| 公司新闻 | `obb.news.company(T, limit=)` | yfinance（10 条）/ fmp | ✅ |
| 全球新闻 | `obb.news.world(limit=)` | fmp | ❌ 需付费 |
| CIK 映射（ticker→CIK） | `obb.regulators.sec.cik_map(symbol=T)` | sec | ✅ AAPL→0000320193 |
| 机构搜索 | `obb.regulators.sec.institutions_search(query=)` | sec（853 条） | ✅ |
| SIC 行业代码 | `obb.regulators.sec.sic_search(sic=)` | sec | ✅ |
| CIK 映射（反向） | `obb.regulators.sec.symbol_map(symbol=T)` | sec | ✅ |
| SEC 文件头部 | `obb.regulators.sec.filing_headers(url=)` | sec | ✅ 需传 SEC filing URL |
| SEC 文件 HTML | `obb.regulators.sec.htm_file(url=)` | sec | ✅ 需传 SEC filing URL |
| COT 持仓搜索 | `obb.cftc.cot_search(query=)` | cftc（18 条） | ✅ |
| COT 持仓报告 | `obb.cftc.cot(report_type=)` | cftc | ❌ 超大数据集 timeout |

### 🌐 IMF / 国际贸易

| 要什么 | 命令 | provider | 实测 |
|---|---|---|---|
| IMF 数据流列表 | `obb.imf_utils.list_dataflows` | imf（67 条） | ✅ |
| IMF 数据表 | `obb.imf_utils.list_tables / .presentation_table` | imf | ✅ |
| 贸易方向 | `obb.economy.direction_of_trade(country='US')` | imf | ⚠️ 偶发 timeout |
| 航运港口信息 | `obb.economy.shipping.port_info / .port_volume / .chokepoint_info / .chokepoint_volume` | imf | ⚠️ timeout |

---

## 新装扩展（2026-07-17）

### 📐 Fama-French 因子模型
```python
obb.famafrench.breakpoints                       # 规模/价值切分点
obb.famafrench.factors(period=)                   # 三/五因子数据
obb.famafrench.country_portfolio_returns           # 国家组合收益
obb.famafrench.regional_portfolio_returns          # 区域组合收益
obb.famafrench.international_index_returns         # 国际指数收益
obb.famafrench.us_portfolio_returns                # 美国组合收益
```
全部 keyless 免费，用于组合归因/因子暴露分析。

### 📊 量化分析
```python
obb.quantitative.capm(x, y)                      # CAPM beta/alpha
obb.quantitative.performance(x)                   # 绩效指标（夏普/最大回撤等）
obb.quantitative.stats(x)                         # 描述统计
obb.quantitative.rolling(x, target, window=)      # 滚动统计
obb.quantitative.normality(x)                     # 正态性检验
obb.quantitative.summary(x)                       # 综合统计摘要
obb.quantitative.unitroot_test(x)                 # 单位根检验（ADF）
```

### 📈 技术指标
完整 27 个指标，与已有的 technical-analysis skill 互补（需传 DataFrame）：
```python
obb.technical.sma / .ema / .hma / .wma / .zlma   # 均线族
obb.technical.macd / .rsi / .stoch / .adx        # 动量
obb.technical.bbands / .kc / .donchian            # 波动率通道
obb.technical.aroon / .cci / .cg / .fisher        # 趋势/反转
obb.technical.obv / .ad / .adosc                  # 量价
obb.technical.atr / .fib / .ichimoku / .vwap      # 其他
obb.technical.relative_rotation                    # RRG 板块轮动
obb.technical.clenow                               # Clenow 趋势强度
obb.technical.cones                                # 波动率锥
obb.technical.demark                               # Demark 计数
```

### 🔬 计量经济
```python
obb.econometrics.ols_regression(y, x)              # OLS 回归
obb.econometrics.ols_regression_summary(model)       # 回归摘要
obb.econometrics.cointegration(y, x)                # 协整检验
obb.econometrics.causality(y, x)                    # Granger 因果
obb.econometrics.correlation_matrix(data)           # 相关矩阵
obb.econometrics.autocorrelation(y)                 # 自相关
obb.econometrics.residual_autocorrelation(model)    # 残差自相关
obb.econometrics.unit_root(y)                       # 单位根检验
obb.econometrics.variance_inflation_factor(x)       # VIF 多重共线性
obb.econometrics.panel_*(...)                       # 面板模型（pooled/fixed/random/等）
```

### 🏛 美国国会委员会
```python
obb.uscongress.bills(...)                          # 法案列表/搜索
obb.uscongress.bill_info(...)                      # 法案详情
obb.uscongress.bill_text(...)                      # 法案全文
obb.uscongress.amendments(...)                     # 修正案
obb.uscongress.committee_info(chamber='house', committee_code='hspw', provider='congress_gov')
                                                     # 返回 markdown_content + raw_data（含成员列表/系统代码/chamber）
                                                     # 用 r.results.markdown_content 取可读正文
                                                     # 用 r.results.raw_data['members'] 取结构化成员列表
```

## openbb-worker HTTP 端点（端口 8824）

后台常驻 worker（`~/nimbus-os/services/openbb-worker/worker.py`），免 Python 冷启动。

| 端点 | 参数 | 返回 |
|---|---|---|
| `/health` | 无 | 进程状态 + openbb/yfinance 加载状态 |
| `/yahoo/quote` | `symbol=` | 实时报价（last_price/market_cap 等） |
| `/yahoo/history` | `symbol=` `limit=` | 历史日K，limit 默认 30 |
| `/yahoo/short` | `symbol=` | 做空数据（shortRatio/shortPercentOfFloat 等） |
| `/yahoo/quotes` | `symbols=AAPL,MSFT,GOOGL` | 批量报价 |
| `/openbb/fred` | `series=` `limit=` | FRED 时序（DGS10/SP500 等） |
| `/openbb/sec-filings` | `symbol=` `limit=` | SEC 文件列表 |
| `/openbb/analyst-rating` | `symbol=` `limit=` | 分析师评级/目标价 |
| `/cn_hsgt_flow` | 无 | 沪深港通北向/南向资金流 |
| `/cn_margin` | `limit=` | 融资融券余额 |
| `/cn_breadth` | 无 | A 股涨跌家数 |
| `/cn_ah_premium` | 无 | AH 股溢价 |
| `/akshare/quote` | `symbol=`（CN:600519）| A 股实时行情（腾讯数据源） |

调用示例：
```bash
# 省略 Python 冷启动，毫秒级返回
curl -s "http://127.0.0.1:8824/yahoo/quote?symbol=AAPL"
curl -s "http://127.0.0.1:8824/openbb/sec-filings?symbol=AAPL&limit=3"
```

## openbb-mcp MCP 配置

已配到 `~/.claude/settings.local.json`，以 **stdio** 模式接入 Claude Code：

```json
{
  "mcpServers": {
    "openbb-mcp": {
      "command": "/Users/x/nimbus-os/nimbus/.venv-openbb/bin/python3",
      "args": ["-m", "openbb_mcp_server", "--transport", "stdio"]
    }
  }
}
```

MCP 模式默认启用**动态发现**（`enable_tool_discovery=True`），启动时只暴露 4 个管理工具：
- `available_categories` — 列出所有可用类别
- `available_tools` — 列出某类别下的工具
- `activate_tools` / `activate_category` — 按需激活

Claude 需要用到 OpenBB 数据时，先 call 管理工具发现并激活对应类别，再调用具体工具。比 Python CLI 慢一些（MCP 协议开销），但胜在对话内自然集成。

---

## Provider 选择原则

1. **有免费 keyless 的优先**：yfinance / cboe / sec / oecd / multpl / cftc / wsj / eia
2. **有 fmp key 的次选**（`PKq92Y...`，免费版，部分端点受限）
3. **有 fred key 的第三选**（`4f133c...`，5s timeout 限制，重试可解）
4. **要付费的跳过**：seeking_alpha / finviz premium / stockgrid / polygon / intrinio
5. **A/H 标的不用 OpenBB** → 走 longbridge/futu

## 报错处理

- `[Error] -> Input should be 'x','y'…` = 该命令不支持你给的 provider，换表里列的。
- `object of type 'X' has no len()` = 命令执行成功，返回的是对象而非列表——直接访问 `.results[0]` 或 `.results.field_name`。
- `ReadTimeout`（finra） = finra 的 1s timeout 太短，本机网络延迟高，不可避免。
- 空 Error（FRED） = 5s timeout 超时，重试一次大概率成功。<｜end▁of▁thinking｜>

<｜｜DSML｜｜tool_calls>
<｜｜DSML｜｜invoke name="Echo">
<｜｜DSML｜｜parameter name="content" string="true">Done