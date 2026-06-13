---
name: congress-tracker
description: 追踪美国国会议员（众议院）股票交易披露——谁在买卖什么。数据来自 QuiverQuant 免费 live 端点（披露滞后数日，非实时）。当用户问「国会交易/议员持仓/佩洛西/Pelosi/谁在买X/国会谁动了NVDA/congress trading/政客炒股」时触发。可按议员名或标的筛选。NOT for: 13F 机构持仓→institutional-flow-tracker；内部人(高管)交易→insider-tracker；普通选股→ah-stock-screener。仅信息参考，非投资建议。
---

# Congress Tracker — 国会议员交易跟踪

跟踪美众议院议员的股票交易披露（STOCK Act 要求 45 天内披露）。免费、无需 key。

## 用法

```bash
python3 ~/.claude/skills/congress-tracker/scripts/congress.py            # 最新交易
python3 ~/.claude/skills/congress-tracker/scripts/congress.py --rep Pelosi    # 某议员(模糊匹配)
python3 ~/.claude/skills/congress-tracker/scripts/congress.py --ticker NVDA   # 某标的谁在动
python3 ~/.claude/skills/congress-tracker/scripts/congress.py --top 20
```

字段：日期 / 议员(党派) / 买卖 / 标的 / 金额区间 / 相对 SPY 超额收益。

## 数据源与边界
- QuiverQuant `/beta/live/congresstrading`（免费开放端点，最新 ~1000 条窗口）。
- **滞后**：议员披露本身滞后最多 45 天；端点再有数天延迟。**不是实时信号**。
- **参议院**单独端点需付费（401），本 skill 仅众议院。
- 成功后写本地快照 `data/congress_snapshot.json`，源故障时回退。
- ⚠️ 仅信息参考，非投资建议；不构成下单依据。
