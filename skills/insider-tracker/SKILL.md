---
name: insider-tracker
description: 查个股内部人(高管/董事/10%股东)买卖披露(SEC Form 4)——谁在增减持、净方向。数据来自 Finnhub 免费端点。当用户问「X 内部人/高管增减持/内部人交易/insider trading/高管在买还是卖」时触发。需先把公司名/中文名归一为美股 ticker。NOT for: 国会议员→congress-tracker；13F 机构→institutional-flow-tracker；资金流/主力→futu-capital-anomaly。仅信息参考，非投资建议。
---

# Insider Tracker — 内部人交易（SEC Form 4）

高管/董事/大股东的法定买卖披露。免费（Finnhub），读环境 `FINNHUB_API_KEY`。

## 用法
```bash
python3 ~/.claude/skills/insider-tracker/scripts/insider.py NVDA            # 近6月
python3 ~/.claude/skills/insider-tracker/scripts/insider.py AAPL --months 3 --top 10
```
输出：净增/减持汇总 + 最近明细（日期/姓名/增减/股数/价格）。

## 边界
- 仅美股（SEC）。先把「英伟达/腾讯」等归一为 ticker（港股/A股无 SEC Form4）。
- transactionPrice=0 多为期权行权/授予类，非公开市场买卖，解读时注明。
- 与 congress-tracker(国会)、institutional-flow-tracker(13F) 互补。
- ⚠️ 非投资建议。
