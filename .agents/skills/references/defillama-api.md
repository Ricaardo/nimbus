# DeFiLlama 免费 API（共享 reference，非独立 skill）

> 更新：2026-05-22 · 全部 **免费、无 key、无地域限制** · 已实跑验证
> 定位：补 **L1 协议/宏观层**（TVL/收益/稳定币/费用）——OnchainOS 不做的那一层。
> 调用方式：本机无 DeFiLlama MCP，用 `WebFetch <url>` 拉 JSON；大响应用 `curl | jq`（见下方坑）。
> 官方文档兜底：https://defillama.com/docs/api

---

## 0. 谁该读这个文件

低频按需，主要给这些 skill 在需要 DeFi 宏观数据时引用：
`research`(Regime 流动性/链轮动) · `market-pulse`(稳定币流向当 risk-on/off 代理) · `btc-guanfu`(流动性域) · `valuation`(协议收入做基本面) · `sector-analyst`(赛道 TVL 流向)。

**只值得用的 3 个高价值场景**（其余端点边际效用低）：
1. **稳定币流向** = risk-on/off 代理 → `/stablecoincharts/all`
2. **链 TVL 轮动** → `/v2/chains`
3. **协议真实收入**（估值用） → `/overview/fees`、`/summary/fees/{slug}`

---

## 1. 五个 base host

| Host | 管什么 |
|---|---|
| `https://api.llama.fi` | TVL、协议、DEX 成交量、费用/收入、期权 |
| `https://coins.llama.fi` | 代币价格 |
| `https://stablecoins.llama.fi` | 稳定币流通量/分布 |
| `https://yields.llama.fi` | 收益率 / APY 池子 |
| `https://bridges.llama.fi` | 跨链桥流量 |

---

## 2. 怎么查一个具体协议（Aave / Pendle / Uniswap…）⭐

**第 1 步：拿到 slug。** slug = DeFiLlama 网页 URL 的最后一段：`defillama.com/protocol/<slug>`。
- 规律：小写、空格转 `-`、带版本号。已验证示例：`aave-v3`、`aave-v2`、`pendle`、`uniswap`、`uniswap-v3`、`gmx`、`lido`、`makerdao`。
- 不确定就先猜常见写法；猜错（404）再回查网页 URL 或文档。

**第 2 步：按需求选端点（注意大小，见坑 §8）：**

| 想要 | 端点 | 备注 |
|---|---|---|
| **当前 TVL（单个数字）** | `GET /tvl/{slug}` | 最轻，WebFetch 直接打 ✅ |
| 历史 TVL + 分链/分类明细 | `GET /protocol/{slug}` | **响应 >10MB，WebFetch 会失败**，用 `curl\|jq` |
| 费用 / 收入 | `GET /summary/fees/{slug}?dataType=dailyRevenue` | `dataType`: `dailyFees`/`dailyRevenue` |
| 成交量（若是 DEX） | `GET /summary/dexs/{slug}` | — |
| 该协议的收益池 | `GET /pools` 后本地筛 `project=="{slug}"` | 全表大，建议 `curl\|jq` |

**已验证实例（2026-05-22）：** `GET /tvl/aave-v3` → ~$14.19B；`GET /tvl/pendle` → ~$1.59B。

> Aave 有多个版本：聚合用 `aave`，具体用 `aave-v3` / `aave-v2`，分别查。

---

## 3. TVL / 协议（api.llama.fi）

| Endpoint | 用途 |
|---|---|
| `GET /protocols` | 所有协议 + 当前 TVL（大表，`curl\|jq` 筛） |
| `GET /protocol/{slug}` | 单协议历史 TVL + 明细（**大，curl\|jq**） |
| `GET /tvl/{slug}` | 单协议当前 TVL（单数字，最轻）✅ |
| `GET /v2/chains` | 所有链当前 TVL |
| `GET /v2/historicalChainTvl[/{chain}]` | 全链 / 单链历史 TVL |

## 4. 价格（coins.llama.fi）

ID 格式 `{chain}:{address}` 或 `coingecko:{id}`，逗号分隔。

| Endpoint | 用途 |
|---|---|
| `GET /prices/current/{coins}` | 当前价 |
| `GET /prices/historical/{ts}/{coins}` | 历史价 |
| `GET /chart/{coins}` | 价格序列 |
| `GET /percentage/{coins}` | 区间涨跌幅 |

> 主流币现价仍优先 `cmc-mcp`；这里用于长尾链上代币。

## 5. 稳定币（stablecoins.llama.fi）

| Endpoint | 用途 |
|---|---|
| `GET /stablecoins?includePrices=true` | 所有稳定币 + 流通量 |
| `GET /stablecoinchains` | 各链分布 |
| `GET /stablecoincharts/all` | 全市场历史（⭐ risk-on/off 代理） |
| `GET /stablecoincharts/{chain}` | 单链历史 |
| `GET /stablecoin/{id}` | 单稳定币分链明细 |

## 6. 收益率（yields.llama.fi）

| Endpoint | 用途 |
|---|---|
| `GET /pools` | 所有池 + APY + TVL（大表，本地筛 `symbol`/`chain`/`project`/`apy`） |
| `GET /chart/{pool}` | 单池历史 APY/TVL（pool 为 UUID） |

## 7. DEX量/费用/桥（api.llama.fi / bridges.llama.fi）

| Endpoint | 用途 |
|---|---|
| `GET /overview/dexs[/{chain}]` | DEX 成交量排名 |
| `GET /overview/fees` | 协议费用+收入总览（⭐ 谁在赚钱） |
| `GET /summary/fees/{slug}` | 单协议费用/收入 |
| `GET /overview/options` | 链上期权成交量 |
| `GET /bridgevolume/{chain}` | 单链桥流量 |

---

## 8. 坑 / 注记

- **WebFetch 有 10MB 上限**：`/protocol/{slug}`、`/protocols`、`/pools` 这类全量/历史端点会超限失败。
  → 对策：单数字用 `/tvl/{slug}`；大表用 Bash `curl -s '<url>' | jq '<filter>'` 本地裁剪后再读。
- TVL 为社区聚合口径，**偶有重复计算**，做绝对值判断时交叉验证。
- 免费公共 API 有**软性限流**，别高频轮询；批量端点拉一次本地缓存/过滤。
- Pro 端点（`pro-api.llama.fi`）需付费 key，**不用**。
- 联动：DeFiLlama 取宏观数 → 丢给 `research`/`market-pulse`/`btc-guanfu`/`valuation` 交叉验证，不单独下结论。
