---
name: hot-tickers
description: 网络热门标的借鉴——看"网上最近在热议哪些票"。聚合 3 个免费源:ApeWisdom(Reddit WSB/stocks 提及榜+24h动量)、StockTwits(交易者社区 trending+关注数)、followserenity(白毛股神@aleabitoreddit 的瓶颈论小盘观点)。跨源去重+复合热度(多源同时上榜=更热)。当用户问「网络热门/散户在聊啥/最近什么票火/reddit 热门票/wsb 热门/stocktwits 热门/social buzz/大家在买啥/热门标的借鉴/白毛股神」时触发。可 --ticker 查某票热度、--source 看单源。NOT for: 个股深度分析→us-stock-analysis;真实机构13F→institutional-flow-tracker;真实持仓→portfolio-manager;基本面选股→stock-screener/us-screener。⚠️仅社媒/散户讨论热度,非基本面、非交易信号、非真实持仓。NFA。
---

# Hot Tickers — 网络热门标的借鉴

看"网上最近在热议哪些票",作为找 idea 的**借鉴**(不是交易信号)。聚合 3 个免费源,跨源去重后按复合热度排序——**同时在多个源上榜的票更热**。

## 用法
```bash
python3 skills/hot-tickers/scripts/hot_tickers.py               # 跨源热度榜 top20
python3 skills/hot-tickers/scripts/hot_tickers.py --top 30
python3 skills/hot-tickers/scripts/hot_tickers.py --ticker NVDA    # 某票在各源的热度
python3 skills/hot-tickers/scripts/hot_tickers.py --source apewisdom  # 单源原始榜
```
每条:`$标的 热度 [N源] Reddit#排名(提及,24h动量) · StockTwits#排名(关注) · 白毛[conviction]`。

## 三个源
| 源 | 反映什么 | 端点(免费) |
|---|---|---|
| **ApeWisdom** | Reddit(WSB/stocks/investing…)ticker 提及聚合 + 24h 动量 | apewisdom.io/api |
| **StockTwits** | 交易者社区 trending symbols + 关注数 | api.stocktwits.com |
| **followserenity** | 白毛股神(@aleabitoreddit)瓶颈论小盘观点篮子(**1 个网红源;非真实13F**) | followserenity.com |

每源独立抓取,失败回退本地快照(`data/snap_*.json`);单源挂掉不影响其余。

## 复合热度
- 各源按排名归一到 0–100;ApeWisdom 叠加 24h 提及动量;followserenity 计入网红观点权重。
- **跨源乘子**:上榜源越多热度越高(1源→3源 = ×1.0→×1.8)。多源共振才是真"热"。

## 边界（重要）
- ⚠️ 这是**社媒/散户讨论热度**,不是基本面、不是交易信号、不是真实持仓/13F。**热 ≠ 该买**。
- followserenity 是公开帖抽取的观点、战绩自述未审计;多为小盘高波动。
- 正确用法:发现"最近大家在聊什么" → 再用 `us-stock-analysis`/`valuation` 自己深挖判断。
- 不照抄下单;NFA。

> followserenity 源的选股风格(AI 半导体供应链瓶颈论)见 `references/bottleneck-theory.md`。
