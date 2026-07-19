---
name: value-perspective
description: 价值投资派大师的思维框架（Buffett/Klarman/Bogle/Templeton/Greenblatt/Lynch/Ackman + 段永平）。**仅在用户明确要求大师视角或使用价值派专属概念时触发**——不是默认的"分析这只股票"入口。明确触发：「用 Buffett/Klarman/Lynch... 的视角」「价值投资视角」「魔法公式」「安全边际」「护城河」「能力圈」「市场先生」「极度悲观」「tenbagger」「集中持仓」「催化事件」「不对称回报」「Bogleheads/被动投资」「段永平/本分/能力圈/不为清单/stop doing/A股港股价值」。NOT for: (1) 普通"AAPL 怎么样/分析这只股票" → 用 us-stock-analysis；(2) 宏观/周期/量化 → 用 macro-perspective；(3) 仅算 PE/PB/DCF → 用 valuation；(4) 短线/技术 → 用 technical-analysis。
---

# 价值投资合并视角 — 决策协议

不是一本介绍大师思想的书，而是**一套可执行的判断协议**。每位大师 = 一个独立的"检测器"（lens），输入标的/情境，输出 PASS / FAIL / NEUTRAL + 理由。

## 🔧 四步通用协议

无论触发哪位大师，遵循同一流程：

### Step 1: 数据预取（被动调用 worker skills）

根据问题类型先取数据：
- 个股 → 调 `valuation`（拿 PE/PB/ROIC/FCF 等）+ `market-data`（拿当前价/52w 范围）
- 宏观/市场情绪 → 调 `market-pulse`（拿 Fear&Greed/breadth/VIX）
- 板块/主题 → 调 `sector-analyst`

### Step 2: 选 lens

从下面核心大师里挑 1-3 位最相关的（见"何时调谁"决策表）。

### Step 3: 跑 lens 协议

每位大师有结构化协议：核心问句 → 量化门槛 → 5 步检查 → 失效条件。逐项打 ✅/❌/➖。

### Step 4: 输出

用大师本人语调（references 中有"表达 DNA"），按"输出模板"组织。**一定要包括失效条件**（什么情况下这个 lens 应该被放弃）。

---

## 🎯 何时调谁 — 决策表

| 用户问的形态 | 主 lens | 副 lens（可叠加） |
|---|---|---|
| "X 是不是好生意" / "护城河强不强" | Buffett | Lynch（分类）|
| "X 现在贵不贵" / "够不够便宜" | Klarman | Greenblatt |
| "我能用魔法公式选股吗" / "ROIC + EBIT/EV" | Greenblatt | — |
| "我看到 X 产品很火，能买吗" | Lynch | Buffett |
| "市场恐慌了，该不该买" / "全球哪里便宜" | Templeton | Klarman |
| "我该买主动还是指数 / 散户怎么办" | Bogle | — |
| "这股票值不值得重仓 / 有催化吗" | Ackman | Buffett |
| "A股/港股好生意" / "用段永平/本分视角" / "该不该长期拿一门中国消费·互联网生意" | 段永平 | Buffett（同源叠加）|

---

## 📚 核心大师协议（按调用频率排序）

### 1. Warren Buffett — 好生意检测器

**核心问句**：这家公司 10 年后是否还能以更高的 ROIC 复利？

**量化门槛（4 道闸）**：
1. **能力圈**：业务能否一句话讲清楚 → 不行 = FAIL
2. **护城河**：ROIC（剔除商誉）≥ 15% 且 5 年稳定 → 否则降级
3. **管理层**：股东信、回购/股息纪律、激励是否对齐 → 主观打分 1-5
4. **价格**：当前 owner earnings yield > 长期国债 yield + 安全溢价（≥ 3-4%）

**5 步检查**：
- [ ] **业务模型**：复印机式的可重复，还是项目制？
- [ ] **定价权**：能否每年提价 ≥ 通胀？
- [ ] **资本配置**：留存利润再投回 ROIC > 15% 的领域吗？
- [ ] **抗诱惑度**：管理层会不会乱并购、乱发股？
- [ ] **持有期**：愿意持 10 年再看吗？

**失效条件**：
- 行业被技术颠覆（柯达式）→ Buffett 也认错（IBM）
- ROIC 被会计游戏拉高（如 leverage）→ 不算真护城河
- "好生意但太贵"是常态，不下手不是 FAIL

**著名翻车**：IBM、Tesco、Salomon —— 能力圈外或对管理层判断错。

### 2. Seth Klarman — 安全边际检测器

**核心问句**：如果我错了，我亏多少？

**量化门槛**：
- 内在价值估算 vs 当前价 → **折扣 ≥ 30-50%** 才入场
- 三种"便宜来源"（必须能识别）：
  1. **Forced sellers**：基金赎回/指数剔除/破产清算
  2. **Complexity**：分拆/多业务/海外股
  3. **Hate**：负面叙事（监管/诉讼/事故）
- **现金即仓位**：找不到便宜货时持现金 ≥ 30%（与 Buffett 一致）

**5 步检查**：
- [ ] 至少 3 种估值方法交叉（DCF / 同行 / 资产清算）
- [ ] **下行情景**：最坏 case 我亏 ≤ 15-20%？
- [ ] 流动性是否足够，紧急时能撤？
- [ ] 这只股是否被 forced selling 创造了？
- [ ] 我是不是因为"它涨了"才看上的？（叙事陷阱）

**失效条件**：
- 估值都基于线性外推，未考虑结构性恶化
- "便宜"是因为生意在死

### 3. Joel Greenblatt — Magic Formula 系统

**核心公式**：`Rank(ROIC desc) + Rank(EBIT/EV desc)` → 总分最低 = 候选

**量化门槛**：
- 全市场扫，剔除：金融/公用事业/极小盘 (<$50M)
- 取 Top 30 → 持有 1 年 → 卖盈/亏分别处理税务
- **机械化**：3-5 年时间轴才有效，年内严重跑输是常态

**5 步检查**：
- [ ] 用 `valuation` 拉 ROIC 和 EBIT/EV
- [ ] Universe 是否够干净（剔除特殊行业）
- [ ] 持仓是否系统化、不情绪干预
- [ ] 时间轴 ≥ 3 年了吗？
- [ ] 是否还在做"特殊情况"补充（分拆/破产重组/SPAC）？

**特殊情况投资（Greenblatt 的另一招）**：
- **Spin-offs**：母公司剥离，强卖压 + 信息不透明 → 第一年溢价
- **破产重组（distressed）**：债转股后被 forced sell 的股票
- **Risk Arb**：并购套利

**失效条件**：
- 单年表现不能判断（理论上 3 年才稳定）
- Universe 出现行业泡沫时全样本失真

### 4. Peter Lynch — 6 类公司分类器

**核心问句**：这家公司属于哪一类？分类决定估值方法和持仓策略。

**6 类 + 特定指标**：

| 类别 | 特征 | 主指标 | 持仓策略 |
|---|---|---|---|
| **Slow Grower** | 5-10% Rev 增长，付股息 | 股息率 ≥ 4%、payout ratio | 收息为主，不超配 |
| **Stalwart** | 10-12% 增长、抗周期（KO/MCD） | PE < 15、PEG < 1 | 防御核心，回调买 |
| **Fast Grower** | ≥ 20% 增长，潜在 tenbagger | **PEG ≤ 1**、ROE > 15% | 集中重仓 |
| **Cyclical** | 周期股（汽车/航空/化工） | PE 低点是危险信号 ⚠ | 周期顶卖 PE 低、底买 PE 高 |
| **Turnaround** | 出问题正在修复 | 现金流转正、债务可控 | 高赔率小仓位 |
| **Asset Play** | 隐藏资产价值 | NAV 折扣、SOTP | 等市场识别 |

**量化门槛**：
- Fast Grower：**PEG ≤ 1** 是硬门槛
- Cyclical：**PE 反向看**（高 PE 时买，低 PE 时卖）
- Asset Play：当前价 vs SOTP 折扣 ≥ 30%

**5 步检查**：
- [ ] 先分类 → 用对应估值方法（用错就全错）
- [ ] **生活观察**：你/家人/朋友最近用过这家公司的产品吗？
- [ ] **1 分钟测试**：能否一句话说服朋友买？说不清就别买
- [ ] 散户优势在哪：你比华尔街早看到什么？
- [ ] 持仓数 ≤ 30（散户也能管理的上限）

**失效条件**：
- 类别看错（最常见错误）
- "故事"投资但不验证基本面（Lynch 也会被骗）

### 5. John Bogle — 被动投资者

**核心问句**：你能持续战胜 60/40 指数吗？大概率不能。

**量化门槛**：
- 基金 expense ratio **必须 < 0.20%**（Vanguard VTI/VOO 标准）
- 持有期 ≥ 10 年
- 任何时候**不择时**

**协议**：
- [ ] 90% 资金 = 全市场指数（VTI / VTSAX）
- [ ] 10% 资金 = 国际指数（VXUS）或债券（BND）
- [ ] 每年再平衡 1 次
- [ ] **永远不卖**（除非生活需要现金）

**适用前提（这是 Bogle 的硬要求）**：
- 你不打算花 10+ 小时/周研究投资
- 你已经接受"自己跑不赢市场"

**失效条件**：
- 用户**已经主动选股**且想问视角 → Bogle lens 在这里几乎只能说"你应该停下"，不要硬套

### 6. John Templeton — 极度悲观检测器

**核心问句**：现在是不是"最大悲观点"？

**量化门槛（多指标共振）**：
- 大盘 / 标的 drawdown ≥ 40-50%
- 媒体头条充满"X 之死"叙事
- VIX > 35（市场恐慌）
- **内部人买入** > 卖出（看 Form 4）
- 估值 PE < 10 或 P/B < 1（牛市价值股）

**全球价值（Templeton 的另一招）**：
- 比较各国 CAPE 比率 → 选最低的 1-3 个
- 当前 CAPE 极低（< 10）= 通常是机会但需要催化

**5 步检查**：
- [ ] 多指标都在悲观 → ✅
- [ ] 是结构性下降还是情绪挤压 → 必须分清
- [ ] 内部人 / smart money 在不在买（用 `institutional-flow-tracker`）
- [ ] 我能等 3-5 年情绪反转吗
- [ ] 仓位是否分散（不押单一 cycle）

**失效条件**：
- "便宜"是因为生意/国家在死（俄罗斯 2022、土耳其超通胀）
- 没有催化等到情绪反转 = 价值陷阱

### 7. Bill Ackman — 催化激进派

**核心问句**：是不是 8-12 个最高确信仓位之一？

**量化门槛**：
- 仅持 8-12 只 → 每只权重 8-12%
- **不对称**：下行 ≤ 1×、上行 ≥ 3-5×
- 必须有**可识别催化**：管理层换人 / 分拆 / 资本回报 / 政策

**5 步检查**：
- [ ] 这是质优生意吗（Buffett filter 通过）
- [ ] 当前价格相对内在价值有 ≥ 30% 折扣
- [ ] 12-24 个月内有可命名的催化
- [ ] 我能否影响公司（如果不能，催化是被动等还是有人推）
- [ ] 错误时下行有限（用 collar 或 OTM put 保护）

**著名案例**：
- ✅ 2020 CDS（3 周赚 $26B）：极度不对称 + 明确催化（疫情）
- ❌ Valeant：管理层判断错 + 估值未给安全边际

**失效条件**：
- 没有明确催化时间表 → 转变为 "Buffett-style hold"，不是 Ackman trade
- 重仓但没有 hedge → 不符合"不对称"

### 8. 段永平 — 本分 + 能力圈检测器（A股/港股首选，与 Buffett 同源）

**核心问句**：这是不是一门我真懂、文化正、能长期"多赚久赚"的好生意？买它就是买这家公司。

**量化门槛（先做减法 stop doing，再做加法）**：
1. **能力圈**：这门生意能一句话讲清且我真懂吗 → 不懂 = 直接 FAIL（不碰）
2. **商业模式**：差异化 + 持续高自由现金流 + 不靠烧钱/高杠杆 → 看现金流的"久"和"多"
3. **企业文化**：管理层是否"本分"（做对的事、诚信、长期、不乱并购/不乱发股）→ 主观打分 1-5
4. **价格**：相对内在价值有安全边际；DCF 是思维方式不是公式（看大方向，别精算）
5. **拿得住**：仓位与确信度匹配，能无视短期波动长期持有吗

**stop doing 铁律（任一触犯 = FAIL）**：做空 / 借钱(margin) / 碰看不懂的题材 / 因"别人在赚"而追

**5 步检查**：
- [ ] 在我能力圈内吗（不懂就停，回到不为清单）
- [ ] 商业模式能"多赚 + 久赚"吗
- [ ] 文化够本分吗（管理层做对的事）
- [ ] 价格有安全边际吗
- [ ] 我拿得住吗（拿不住 = 没真懂或仓位过大）

**失效条件**：
- "便宜/抄底"但生意或文化在恶化（GE 式能力圈外的错）
- 把"长期持有"当躺平，看错了不认错快改
- 借段之名做空/加杠杆/追热点 —— 与其 stop doing 铁律相悖

**著名案例**：网易抄底（能力圈+逆向，约百倍）/ 苹果（消费+生态+文化长持）/ 茅台（好生意原型）/ GE（能力圈外认错）
**最适用**：A股/港股消费白马 + 中国互联网平台；与 Buffett 同源，可叠加。

---

## 🔁 综合（多 lens 三角验证）

用户问大问题（如"我该不该重仓 NVDA"）时，**串行**调 3 个 lens：

```
Buffett (好生意？) → Klarman (够便宜？) → Ackman (催化够强？)
```

输出格式：

```
🎯 [TICKER] — 价值视角综合判断

📌 一句话结论：[BUY / WAIT / AVOID] + 主要原因

🔍 多 lens 交叉

✅ Buffett (好生意检测): PASS — ROIC 35%, 护城河强
❌ Klarman (安全边际): FAIL — 当前 PE 80x，无折扣
➖ Ackman (催化): NEUTRAL — 长期 AI 故事但无 12-24 月明确事件

⚠ 失效条件 (任一发生需重评估):
  - ROIC 跌破 20%
  - PE 上 100 (估值崩塌风险)
  - 出现技术替代品（半导体周期）

📊 我看到的什么是市场没看到的: [insight 或 "无 differentiated view → 用 Bogle，买指数]
```

---

---

## 📖 Worked Examples（完整流程示范）

### 例 1：美股 — NVDA 三 lens 综合（2025）

**用户问**："我该不该重仓 NVDA？"

**Step 1 — 数据预取**
- `valuation` 拉：PE ~50x, ROIC ~80%, FCF margin ~45%
- `market-data`：当前价 vs 52w 范围 ~95% 高位
- `market-pulse`：MHS 60+，偏乐观

**Step 2 — 选 3 个 lens**
- Buffett（好生意？）
- Klarman（够便宜？）
- Ackman（催化够强？）

**Step 3 — 跑协议**

✅ **Buffett — PASS**
- 能力圈：可以一句话讲清（GPU + CUDA 软件栈双护城河）
- 护城河：CUDA 是 17 年累积的开发者生态，竞争对手切换成本极高
- ROIC 80% 远超 15% 门槛
- 管理层：Jensen 长期对齐 + 资本配置纪律
- ❌ 价格：owner earnings yield ~ 2%，远低于"国债 + 安全溢价"

❌ **Klarman — FAIL**
- 三种"便宜来源"都不存在（forced selling? 无；complexity? 故事简单；hate? 全市场最 loved）
- 当前价 vs 内在价值无 30%+ 折扣
- 下行情景估算：如果 AI capex 2026 减半 → 估值压缩 40-50%

➖ **Ackman — NEUTRAL**
- 是质优生意（Buffett filter PASS）
- 但当前无 30% 折扣
- 12-24 月催化：Blackwell 周期 ✅；但已 priced in
- 不对称失败：下行可能 -40%，上行 +50%，赔率不到 1.5x

**Step 4 — 输出**

```
🎯 NVDA — 价值视角综合判断

📌 一句话结论：WAIT — 生意一流，价格透支预期

🔍 多 lens 交叉
✅ Buffett (好生意): PASS — 护城河+ROIC 历史顶级
❌ Klarman (安全边际): FAIL — 无可识别便宜来源
➖ Ackman (催化): NEUTRAL — 催化已 priced in，赔率 < 1.5x

⚠ 重评估触发条件:
  - 股价回撤 ≥ 30%（出现安全边际窗口）
  - AI capex 数据走弱（Buffett 护城河可能动摇）
  - 出现新的非共识 catalysts

📊 differentiated view: 
  - 共识：AI capex 持续 → NVDA 受益
  - 我的视角：缺乏 → 默认 Bogle，买 SPY/QQQ 替代单押
```

### 例 2：港股 — 腾讯 0700 三 lens 综合

**用户问**："腾讯现在算便宜吗？用 Buffett + Klarman 视角看"

**Step 1 — 数据预取**
- `valuation` (futuapi)：PE ~15x, FCF yield ~6%, 持有的投资组合（美团/拼多多/京东）市值 > 自身 30%
- `market-pulse`：港股恒指处于 -50% drawdown 中后期

**Step 2 — Lens**

✅ **Buffett — PASS（条件性）**
- 能力圈：微信 / 游戏 / 投资组合 + 云
- 护城河：微信 13 亿 MAU，社交 + 支付双护城河；游戏 IP（王者 / PUBG-M）持续现金流
- ROIC ~25%（剔除投资组合后）
- ❌ 不确定项：监管政治风险（这是 Buffett 不擅长的领域）

✅ **Klarman — PASS**
- "Hate" 来源识别：监管打压叙事 + 中概股恐慌 + 港股流动性枯竭
- 估值 SOTP：核心业务 PE ~10x（剔除投资组合后），相对历史 -50%
- 下行情景：监管再加码 → 估值再压 20%，但概率 < 30%
- 三角验证：DCF / 同行可比（Meta PE ~25x 对比）/ SOTP 都指向 30-50% 折扣

➖ **Ackman — NEUTRAL**
- 12-24 月催化：游戏版号 + 回购加速 + AI 商业化 ✅
- 但 Ackman 偏好"可识别名字的催化"（CEO 换人 / 分拆等），腾讯催化更弥散
- Ackman lens 适用度低于 Klarman / Buffett

**Step 4 — 输出**

```
🎯 腾讯 0700.HK — 价值视角综合判断

📌 一句话结论：BUY — Klarman "hate + complexity" 折扣窗口，Buffett 护城河完整

🔍 多 lens 交叉
✅ Buffett (好生意): PASS — 微信 + 游戏护城河完整，但加监管不确定项
✅ Klarman (安全边际): PASS — 30-50% SOTP 折扣，"hate" 来源明确
➖ Ackman (催化): WEAK — 有但弥散

⚠ 重评估触发条件:
  - 监管再升级（如游戏总量管控）→ Buffett 护城河转弱
  - 投资组合大幅减值（拼多多 / 美团）
  - 港币与人民币联系汇率风险（结构性，需独立监控）

📊 differentiated view:
  - 共识：中概股政治风险大于回报
  - 我的视角：核心业务持续生现金 + SOTP 折扣已极端 + 回购加速
  - 用 `thesis-tracker` 登记，季度复查
```

### 例 3：A 股 — 茅台 600519 Lynch lens（生活观察 → Stalwart 估值）

**用户问**："我天天喝茅台，能用 Lynch 视角分析吗？"

**Step 1 — 分类**
Lynch 6 类 → 茅台 = **Stalwart**（10-12% 增长、抗周期、品牌型现金牛）

**Step 2 — 标准对应估值**
- Stalwart 标准：PE < 15、PEG < 1
- 茅台当前 PE ~25x（高于 Stalwart 标准）
- 但 ROIC 30%+、毛利率 90%+ 是非典型 Stalwart（接近 Buffett 的 wonderful business）

**Step 3 — Lynch 5 步检查**
- ✅ 生活观察：喝过 + 朋友送 + 商务场景刚需
- ✅ 1 分钟测试：能讲清（高端白酒 + 品牌锚定 + 政商礼品文化）
- ⚠ 散户优势：A 股茅台基本是机构 loved 标的，散户 edge 不明显
- ✅ 持仓数：组合允许（Stalwart 防御核心）
- ❌ PE > 15 不符合 Lynch 标准（但符合 Buffett "wonderful at fair price"）

**Step 4 — Lens 切换建议**

Lynch lens 在茅台上**部分失效**（PE 太高），应该叠加 Buffett lens：
- Buffett 视角：好生意 ✅，长期复利 ✅，但当前 PE 25x → 需要 5+ 年持有摊薄入场成本
- 结论：**HOLD 或回调买**，不是 Lynch 经典 PEG 入场点

```
📌 一句话结论：好生意 + 当前估值不极端便宜，回调至 PE 18x 以下加仓

⚠ 重评估触发：
  - 国内消费降级持续（量价同跌）
  - 监管对高端白酒新规
  - 海外文化输出失败（茅台国际化 thesis 退化）
```

---

## 🔗 联动

### 联动 `thesis-tracker` — 大师 lens 登记协议

每次用大师 lens 输出 PASS/FAIL 后，若产生可追踪的 thesis，都应登记到 thesis-tracker：

| thesis 类型 | 何时登记 | 示例登记内容 |
|---|---|---|
| **买入 thesis** | Klarman PASS（安全边际） 或 Ackman PASS（催化） | `thesis-tracker log "NVDA" thesis="AI capex 周期: 等待 30% 回调" conviction=70% trigger="回撤 > 30%"` |
| **持有 thesis** | Buffett PASS（好生意）但 Klarman FAIL（不够便宜） | `thesis-tracker log "NVDA" thesis="best-in-class business but priced for perfection" conviction=50% trigger="PE < 35x"` |
| **卖出 thesis** | Buffett FAIL（护城河弱化）或 Marks 钟摆极端乐观成交 | `thesis-tracker log "SPY 减仓" thesis="Marks 钟摆 +65, 多指标共振顶部" conviction=75% trigger="VIX < 12 或 HY spread 新低"` |
| **反驳 thesis** | 用户决定不采纳 lens 结论 | `thesis-tracker log "茅台" thesis="Lynch lens FAIL PE 25x 但持有" conviction=30% kill_criteria="PE > 30x 或 EPS 增速 < 8%"` |

**规则**：
- 每个 thesis 必须有明确的 **trigger / kill criteria**（触发什么条件再评估）
- thesis-tracker 的 decay check 机制会自动提醒复查

### 联动 `market-pulse` / `market-data` / `valuation`

见 Step 1 数据预取协议。

### 不得联动

- 不联动 `technical-analysis`（短线/技术不同步，大师 lens 不适用短期指标）
- 不联动 `sector-analyst`（除非有 sector rotation 问题，但那是 macro-perspective 职责）

---

## ⚠ 何时不要用本 skill

- 短线技术 → `technical-analysis`
- 宏观/流动性/Fed → `macro-perspective`
- 加密 meme / 量化策略 → `okx-dex` 或专门工具
- 用户没有指定大师视角，只想要数据综合 → `us-stock-analysis`

## 📂 References 深度资料

每位大师的原始研报、表达 DNA、案例库见 `references/<master>/dna-and-cases.md`：
- `warren-buffett/` 4 道筛选闸门 + See's/IBM 等案例
- `seth-klarman/` 3 种便宜来源 + Lehman 债权案例
- `john-bogle/` Bogleheads 4 法则 + 成本数学
- `john-templeton/` 极度悲观共振 + 1939 战时经典
- `joel-greenblatt/` Magic Formula + Spin-off 4 类
- `peter-lynch/` 6 类公司分类 + Magellan 实战
- `bill-ackman/` 5 条标准 + COVID hedge / Valeant 失败
- `charlie-munger/` 逆向 + 心智模型格栅 + 25 误判心理 + See's/Costco/BYD/阿里认错
- `benjamin-graham/` 安全边际源头 + Mr.Market + net-net + 防御vs进取 + GEICO
- `philip-fisher/` scuttlebutt + 15 要点 + 成长质量 + Motorola 长持 + 卖出三理由
- `nick-sleep/` 规模经济共享 SES + 目的地分析 + Costco/Amazon 飞轮 + 极低换手
- `duan-yongping/` 本分 + 能力圈 + 买公司不是买股票 + 网易/苹果/茅台 + DCF思维 + A股港股首选视角

调用时根据需要 Read 对应子目录获取大师的原话和案例。若用户要求"原话/原文/出处",优先读取该大师 `sources/**/primary-source-map.md`。补充的 4 位（Munger/Graham/Fisher/Sleep）是深度档,未纳入上方决策表,但同样可作 lens 参考；段永平已纳入决策表(A股/港股首选 lens,含完整协议)。
