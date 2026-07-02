---
name: insider-tracker
description: 查个股"谁在买卖"——内部人(高管/董事/10%股东，SEC Form 4) + 国会议员(QuiverQuant)。内部人数据来自 Finnhub 免费端点、国会来自 QuiverQuant 免费端点。当用户问「X 内部人/高管增减持/内部人交易/insider trading/谁在买卖X/国会交易/Pelosi 买了什么/议员持仓/谁在动NVDA」时触发。需先把公司名/中文名归一为美股 ticker。NOT for: 13F 机构→institutional-flow-tracker；资金流/主力→futu-anomaly。仅信息参考，非投资建议。
---

# Insider Tracker — 内部人交易（SEC Form 4）

高管/董事/大股东的法定买卖披露。免费（Finnhub），读环境 `FINNHUB_API_KEY`。

## 用法
```bash
# 内部人(高管/董事 Form 4)
python3 ~/.claude/skills/insider-tracker/scripts/insider.py NVDA            # 近6月
python3 ~/.claude/skills/insider-tracker/scripts/insider.py AAPL --months 3 --top 10

# 国会议员
python3 ~/.claude/skills/insider-tracker/scripts/congress.py                # 最新值得注意
python3 ~/.claude/skills/insider-tracker/scripts/congress.py --ticker NVDA  # 谁在动
python3 ~/.claude/skills/insider-tracker/scripts/congress.py --rep Pelosi   # 某议员
```

## 边界
- 内部人仅美股（SEC）。先把「英伟达/腾讯」等归一为 ticker（港股/A股无 SEC Form4）。
- transactionPrice=0 多为期权行权/授予类，非公开市场买卖，解读时注明。
- 国会交易披露滞后数日、非实时；仅信息参考、不是跟单信号。QuiverQuant 免费端点可能需认证(2026-07 起 401)；脚本内置快照兜底(成功拉过则回退)。
- 与 institutional-flow-tracker(13F) 互补。
- ⚠️ 非投资建议。
