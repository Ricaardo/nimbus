---
name: news-bridge
description: 读取 news 平台落盘到 ~/nimbus/workspace/feed/ 的结构化实时数据——机构13F持仓变动、A股扫描候选、突发新闻(trump/bwe/finnhub，含中文译文+简评)。当用户问「最近有什么大事/突发对我持仓什么影响/今日13F变动/A股候选/news feed/有什么机会」或 opportunity 引擎需要实时事件上下文时触发。让投顾基于 news 的实时 feed 推理。NOT for: 个股新闻解读→futu-stock-digest；通用搜新闻→news-dashboard/websearch。
---

# News Bridge — news 平台实时数据桥

读 `~/nimbus/workspace/feed/`（news 平台落盘）：
- `breaking.jsonl` — 突发(trump/bwe/finnhub)，含标的/中文译文/利好利空简评，近 24h
- `13f-latest.json` — 机构 13F 当前持仓/变动（11 只名基金）
- `ashare-candidates.json` — A 股扫描候选

## 用法
```bash
python3 ~/.claude/skills/news-bridge/scripts/feed.py all                 # 全部
python3 ~/.claude/skills/news-bridge/scripts/feed.py breaking --hours 12 # 近12h突发
python3 ~/.claude/skills/news-bridge/scripts/feed.py breaking --tickers NVDA,AAPL  # 只看相关持仓
python3 ~/.claude/skills/news-bridge/scripts/feed.py 13f
```

## 配合 opportunity 引擎
每日机会扫描时读 `breaking.jsonl × 真实持仓` → 「这条突发影响你的 X 持仓」。
feed 由 news 平台写入；news 故障时此桥仅显示「无数据」，不影响 nimbus 其它能力（进程隔离）。
