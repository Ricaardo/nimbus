# Warren Buffett — 股东信原文 RAG 索引

用途：给 `value-perspective` 和每日大师研习提供可检索的原文锚点。这里不搬运整封股东信，只保留主源链接、极短原话、中文提炼和检索关键词；需要全文时去 Berkshire 官方页面读原件。

## 主源入口

- Berkshire Hathaway Annual & Interim Reports: https://www.berkshirehathaway.com/reports.html
- 2024 Chairman's Letter PDF: https://www.berkshirehathaway.com/letters/2024ltr.pdf
- 1989 Chairman's Letter HTML: https://www.berkshirehathaway.com/letters/1989.html
- 其他年份通常可按 `https://www.berkshirehathaway.com/letters/<year>ltr.pdf` 或报告页链接定位。

## 精选原文锚点

### 1983 — 商誉、经济商誉、owner earnings

- 主题：会计利润不等于真实经济收益；优秀企业的经济商誉会随时间扩大。
- RAG 关键词：owner earnings, accounting goodwill, economic goodwill, See's Candies, capital-light, pricing power, 经济商誉, 真实收益, 提价权。
- 用法：分析消费品牌、软件订阅、支付网络等轻资产公司时，先问“账面资产少是否反而说明资本效率强”。
- 误用：把高 ROE 一律当护城河。Buffett 的重点不是高 ROE 本身，而是低增量资本下能否持续提价和扩张。

### 1989 — 错误清单与能力圈

- 极短原话："It's far better to buy a wonderful company..."
- 主题：从 Graham 式便宜烟蒂转向 Munger 式“好生意 + 合理价”；公开复盘 Berkshire、Dexter Shoe 等错误。
- RAG 关键词：mistakes, wonderful company, fair price, cigar butt, Dexter Shoe, textile mistake, opportunity cost, 能力圈, 错误复盘。
- 用法：当用户问“便宜股能不能买”时，先拆成“便宜来源”和“生意质量”两个问题。
- 误用：把这句话理解为“好公司任何价格都能买”。原文强调的是 wonderful 与 fair price 的组合。

### 2007 — 护城河与经济城堡

- 主题：好 CEO 经营一个“有护城河的经济城堡”，并持续加宽护城河。
- RAG 关键词：moat, economic castle, widen the moat, low-cost producer, brand, network effect, switching cost, 护城河, 管理层。
- 用法：评价平台、品牌、保险、铁路、公用事业时，把护城河拆成类型、证据、持续性和资本再投入回报。
- 误用：把规模大当护城河。规模只有转化为成本、网络、渠道或监管优势才算。

### 2014 — 五十周年、Berkshire 模型与文化

- 主题：Berkshire 的核心不是“投资组合”，而是保险浮存金、去中心化经营、长期股东文化和资本配置。
- RAG 关键词：50th anniversary, float, decentralized, culture, capital allocation, Berkshire system, 保险浮存金, 去中心化, 股东文化。
- 用法：分析控股公司、平台型集团、保险公司时，区分业务质量、资本配置质量和组织文化质量。
- 误用：只看持仓列表复制交易，忽略 Berkshire 独特的税务、浮存金和治理结构。

### 2024 — 认错、长期持有与管理层

- 极短原话："Mistakes - Yes, We Make Them"
- 主题：承认资本配置与用人错误；延迟纠错是大罪；长期持有的前提是业务和人持续正确。
- RAG 关键词：mistake, thumb-sucking, Greg Abel, operating earnings, long-term holdings, correction of mistakes, 认错, 纠错, 管理层。
- 用法：当 thesis 变差时，用 Buffett 的“错误必须行动”约束长期持有，避免把长期主义变成不复盘。
- 误用：只引用“forever holding period”，却忽略他反复公开讨论错误和卖出。

## Digest 使用规则

- 每次引用 Buffett 原话时，优先选一条短句，不要堆砌名言。
- 今日新闻若是高估值成长股：用 1989 + 2007，先好生意，再价格。
- 今日新闻若是控股公司、保险、现金、回购：用 2014 + 2024。
- 今日新闻若是“便宜但烂”：用 1989 的范式转换提醒，不要回到烟蒂陷阱。
