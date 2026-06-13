---
name: serenity-tracker
description: 追踪「白毛股神」Serenity(@aleabitoreddit)的持仓观点/Thesis Tracker——AI 半导体供应链「瓶颈理论」选股（CPO/光通信/存储/太空等）。解析 followserenity.com 公开页(532+ thesis，含标的/收益/逻辑/conviction)。当用户问「白毛股神/Serenity/瓶颈理论/他看好什么/aleabitoreddit/SIVE AXTI 之类他的票」时触发。可按标的筛。NOT for: 个股深度分析→us-stock-analysis；通用价值选股→ah-stock-screener。⚠️自述战绩、未审计、非真实13F、非投资建议。
---

# Serenity Tracker — 白毛股神持仓观点

解析 followserenity.com 的 Thesis Tracker（@aleabitoreddit 公开帖抽取的观点篮子，**非真实 13F/持仓**）。

## 用法
```bash
python3 ~/.claude/skills/serenity-tracker/scripts/serenity.py            # 按收益排序的 thesis
python3 ~/.claude/skills/serenity-tracker/scripts/serenity.py --ticker NVDA   # 某标的他的观点
python3 ~/.claude/skills/serenity-tracker/scripts/serenity.py --top 20
```
每条：$标的 公司名 收益% [conviction] + 一句 thesis 逻辑。

## 数据源与边界
- followserenity.com（周期刷新静态页，HTML `<tr>` 表格行解析；成功写本地快照，失败回退）。
- 这是**公开帖抽取的观点**，不是真实持仓/13F；战绩自述、未审计。
- 风格：AI 半导体供应链「瓶颈理论」（CPO/硅光/InP 衬底/存储/Neocloud/太空），多为小盘高波动。
- ⚠️ 不照抄下单；非投资建议。NFA。
