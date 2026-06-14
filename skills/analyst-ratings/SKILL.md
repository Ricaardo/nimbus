---
name: analyst-ratings
description: 查个股华尔街分析师评级共识与趋势（强买/买/持/卖家数 + 看多占比 + 环比变化）。数据来自 Finnhub 免费 recommendation。当用户问「X 分析师评级/华尔街怎么看/评级共识/多少家买入/评级变化/analyst rating」时触发。先把名字归一为美股 ticker。NOT for: 目标价(Finnhub 付费,本skill不含)；财报/估值→valuation/event-calendar；内部人→insider-tracker。非投资建议。
---

# Analyst Ratings — 分析师评级共识

```bash
python3 ~/.claude/skills/analyst-ratings/scripts/ratings.py NVDA
```
输出：当前共识（看多/中性/看空 + 买/持/卖家数 + 看多占比）+ 近 4 月趋势 + 环比方向。

## 边界
- Finnhub `/stock/recommendation`（免费、读环境 FINNHUB_API_KEY、仅美股）。
- **只有评级家数分布，不含目标价**（Finnhub 目标价付费）。
- 评级是滞后/羊群指标，趋势变化（环比上调/下调）比绝对值更有信息量。⚠️ 非投资建议。
