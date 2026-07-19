---
name: macro-perspective
description: 宏观/周期/量化决策派 6 大师思维框架（Soros/Druckenmiller/Marks/Dalio/Simons/Mauboussin）。**仅在用户明确要求大师视角或使用宏观派专属概念时触发**——不是默认的市场分析入口。明确触发：「用 Soros/Druckenmiller/Marks/Dalio/Simons/Mauboussin 的视角」「宏观视角」「反身性」「钟摆理论」「第二层思维」「经济机器」「全天候组合」「债务周期」「基础率」「期望投资」「运气vs技能」「认错要快」。NOT for: (1) 普通"市场怎么样" → 用 market-pulse；(2) 价值投资/护城河 → 用 value-perspective；(3) 个股分析 → 用 us-stock-analysis；(4) 板块轮动 → 用 sector-analyst；(5) 回测策略 → 用 backtest-expert。
---

# 宏观/周期/量化决策视角 — 决策协议

不是介绍宏观大师的书，而是**3 个互补维度的判断协议**：宏观流动性 / 周期位置 / 概率-期望值。

## 🔧 通用协议

### Step 1: 数据预取
- 宏观流动性 → 调 `market-pulse`（Fed BS / yield curve / VIX / breadth）
- 个股环境 → 调 `market-data` + `sector-analyst`
- 历史基础率 → 调 `valuation` 或自查历史

### Step 2: 选维度

3 个维度对应 3 组大师，按问题特征切换：

| 用户问的形态 | 用哪一组 |
|---|---|
| "Fed 加息影响" / "为什么市场被流动性驱动" / "趋势/动量" | **Soros + Druckenmiller**（流动性/反身性派）|
| "市场到顶了吗" / "估值贵不贵" / "组合该多防御" | **Marks + Dalio**（周期/风险派）|
| "这个策略靠谱吗" / "胜率多少正常" / "运气 vs 技能" | **Simons + Mauboussin**（量化决策派）|

### Step 3: 跑 lens 协议
### Step 4: 输出 + 失效条件

---

## 维度一：Soros + Druckenmiller（流动性 / 反身性）

### Soros — 反身性 6 阶段循环

**核心问句**：当前是繁荣-崩溃循环的哪一阶段？

```
1️⃣ Unrecognized trend     基本面变化但市场没注意
2️⃣ Self-reinforcing       价格 → 改变基本面 → 进一步推高价格
3️⃣ Successful test         一次回调没破，市场更确信
4️⃣ Far-from-equilibrium   市场叙事远超基本面，泡沫成型
5️⃣ Twilight                顶部模糊，但仍有买家
6️⃣ Crash                   叙事崩塌，反向自我强化
```

**5 步检查**：
- [ ] 当前价格是否在改变基本面？（自我强化 = 反身性发生）
- [ ] 主流叙事是什么？这个叙事是否"自我应验"？
- [ ] 上次 sharp pullback 是吃掉了还是破了？
- [ ] **fertile fallacy** —— 一个有"半真半假"种子的错误叙事，正是 Soros 最爱做空的标的
- [ ] 我做多还是做空这个反身性循环？

**量化信号**：
- VIX 长期低于 15 + 杠杆增加 = 接近 4-5 阶段
- 信用利差异常窄 = 信贷反身性加速
- IPO 数量爆炸 + 无利润公司溢价 = 5 阶段晚期

**失效条件**：
- 强行识别反身性但其实是真实基本面 → 错过价值
- 高估自己抓阶段时点的能力（Soros 也常错）

**著名战役**：
- ✅ 1992 英镑（识别 ERM 反身性即将崩）
- ❌ 1987 黑色星期一（看错时机）

### Druckenmiller — 趋势 + 流动性 + 集中

**核心问句**：央行在做什么？市场跟着流动性走，所以**永远先看 Fed**。

**3 个铁律**：
1. **"Don't fight the Fed"** —— Fed 放水时做多，缩表时减仓
2. **判对了就下重注**（concentration）—— Druckenmiller 单笔 30-50% 不罕见
3. **认错要快** —— "我活着是因为我承认我错"（Soros 引）

**5 步检查**：
- [ ] Fed BS 在扩还是缩？（用 `market-pulse` mode=liquidity）
- [ ] 财政赤字方向？双重宽松 = 风险资产最佳环境
- [ ] 美元走势？强美元 = 全球流动性紧
- [ ] 我的 thesis 如果错，多久能识别？（< 5%-10% drawdown）
- [ ] 仓位是否反映我的确信度（避免均衡分散）

**量化门槛**：
- Fed BS YoY 变化超过 ±10% = 显著流动性事件
- 财政赤字 > GDP 5% + Fed QE = "印钞" 环境，做多风险资产
- 财政紧 + Fed QT = 流动性枯竭，防御

**失效条件**：
- 流动性宽松但**估值已经极端**（如 1999）→ 流动性也救不了
- 你的"确信"其实是 confirmation bias

---

## 维度二：Marks + Dalio（周期 / 风险）

### Howard Marks — 钟摆理论 + 第二层思维

**核心问句**：钟摆现在在哪？所有人在想什么？我的看法和他们的差异是什么？

**钟摆位置评分（-100 到 +100）**：
| 区间 | 状态 | 行动 |
|---|---|---|
| +60 ~ +100 | 极度乐观（buy）| 主动减仓、留现金 |
| +20 ~ +60 | 乐观 | 维持但不加 |
| -20 ~ +20 | 平衡 | 中性配置 |
| -60 ~ -20 | 悲观 | 慢慢加仓 |
| -100 ~ -60 | 极度悲观（fear）| All in 高质量便宜货 |

**钟摆位置的指标（多维共振才算定位）**：
- VIX 历史百分位（< 20 = 乐观，> 80 = 恐慌）
- 信用利差（HY spread）
- IPO/SPAC 活跃度
- 媒体叙事（"This time is different" = 极度乐观）
- Margin debt / Equity ratio

**第二层思维 — 必问 3 题**：
1. 第一层：X 是好/坏 → 大家都看到
2. **第二层**：X 比预期好/坏 → 价格反映的是什么预期？
3. 第三层：我的预期 vs 市场的预期，差异在哪？

**5 步检查**：
- [ ] 当前钟摆位置（多指标共振）
- [ ] 主流叙事是什么？已经 priced in 了吗？
- [ ] 我看到的什么是别人没看到的？（differentiated view）
- [ ] 风险是被低估还是被高估？（永远问"为什么这便宜"）
- [ ] 时间够吗？我能等钟摆反转吗？

**失效条件**：
- 钟摆判断没有多指标共振 → 单一指标会骗人
- "钟摆要回归"是 mean reversion fallacy，时间可以非常长

### Dalio — 经济机器 + 全天候

**核心问句**：现在是 4 种宏观环境的哪一种？我的组合在每种环境都不破产吗？

**4 象限（增长 × 通胀）**：

|  | **通胀↑** | **通胀↓** |
|---|---|---|
| **增长↑** | 大宗商品 / EM / 黄金 | 股票（成长）|
| **增长↓** | 黄金 / TIPS / 大宗 | 长债（duration）|

**全天候配置（理论参考，不是处方）**：
- 30% 股票
- 40% 长期国债
- 15% 中期国债
- 7.5% 黄金
- 7.5% 大宗商品

**3 个周期叠加（Dalio 的 lens）**：
1. **短期债务周期**（5-10 年）：信贷扩张 → 紧缩 → 衰退 → Fed 放水
2. **长期债务周期**（50-75 年）：去杠杆三选一（违约 / 通胀 / 紧缩）
3. **生产力增长**（长期上行）：技术 + 人口 + 创新

**5 步检查**：
- [ ] 当前 4 象限位置（用 GDP YoY + CPI YoY 简化）
- [ ] 短期债务周期阶段？（Fed 在加息还是降息？）
- [ ] 长期债务周期是否接近峰值？（debt/GDP > 100% 是警告区）
- [ ] 我的组合在最不利象限会怎样？（压力测试）
- [ ] **Pain + Reflection = Progress** —— 上次错在哪？写下来。

**量化门槛**：
- Debt/GDP > 100% + 利率 > 2% = 利息支出占 GDP > 2%，是结构性风险
- 实际利率 < -2% = 极宽松（黄金/大宗有利）

**失效条件**：
- 用 4 象限套个股选时机（错用，4 象限是组合层）
- 全天候在结构性通胀年代会输（如 2022）

---

## 维度三：Simons + Mauboussin（量化决策）

### Simons — 数据 > 直觉

**核心问句**：这个 edge 有 vs 没有的统计证据？

**Renaissance / Medallion 的核心方法论**：
- 寻找**小但稳定**的 edge（51-55% 胜率）
- **大量交易次数**复利
- **不在乎单笔**为什么涨跌（黑箱也行，只要 backtested 稳）
- **彻底排除人类直觉干扰**

**5 步检查**：
- [ ] 这个交易/策略有多少历史样本？(N < 100 → 不可靠)
- [ ] 胜率统计显著吗？（t-test、Sharpe）
- [ ] 信号是否衰减？（半年/1年/2年滚动 Sharpe）
- [ ] 我的"直觉"和数据冲突时，听谁的？→ 数据
- [ ] 我能否将策略系统化（无人为干预）

**失效条件**：
- 过拟合（参数过多、样本太少）→ Renaissance 也避之不及
- 流动性约束（你不是 Medallion）→ 公开策略很快 alpha 消失

### Mauboussin — 运气-技能 + 基础率 + 期望投资

**核心问句 1：这个结果是运气还是技能？**

**技能-运气连续谱**：
```
纯运气                                          纯技能
彩票 ── 21 点 ── 扑克 ── 投资 ── 国际象棋 ── 下围棋
            (60% 运气)              (5% 运气)
```

**运气检测**：
- 同一个赢家是否连续多年赢？（10 年 → 大概率技能；2 年 → 大概率运气）
- 表现是否对随机扰动敏感？（情况越随机越是运气）
- **Reversion to the mean** —— 优秀表现长期会向均值回归

**核心问句 2：基础率告诉我什么？**

**基础率思维 — 必问 3 题**：
1. **outside view（外部视角）**：这类 case 历史平均结果是什么？
2. **inside view**：我手上的这个 case 有多特殊？
3. 我的 inside view 能否压过 outside view？（通常不能）

**例子**：
- IPO 第一年表现：基础率是跑输大盘（这是历史平均）
- 你的"这家 IPO 不一样"叙事 → 90% 是 inside view 错觉

**核心问句 3：当前价格反映了什么预期？**

**Expectations Investing**（Mauboussin 的方法）：
- 不要预测股价，而是**反推市场当前的预期是什么**
- 你的预期 vs 市场的预期，差异 = alpha source

**5 步检查**：
- [ ] 这个判断是 outside view 还是 inside view 主导？
- [ ] 历史 base rate 是多少（IPO 跑输/收购溢价/财报后漂移）
- [ ] 当前价格 implied expectation 是什么？
- [ ] 我的 expectation 和市场差异够大吗？
- [ ] 这个 edge 是技能还是运气？看历史 N

**失效条件**：
- 极端事件（黑天鹅）—— 基础率不适用
- 结构性变化 —— 基础率本身在变

---

## 🔁 三维度交叉应用

用户问大问题（如"现在该不该减仓"）时，串 3 个维度：

```
1️⃣ Druckenmiller (Fed 在做什么) → 流动性方向
2️⃣ Marks (钟摆在哪) → 估值/情绪位置
3️⃣ Mauboussin (基础率) → 历史上类似环境平均回报
```

输出模板：

```
🌍 宏观环境综合判断 — [日期]

📌 一句话结论：[加仓 / 持平 / 减仓 / 防御]

🔍 三维度交叉

1️⃣ 流动性 (Druckenmiller)
   - Fed 状态：[QT / QE / hold]
   - 财政方向：[赤字扩 / 收]
   - 净结论：风险资产 [友好 / 中性 / 不利]

2️⃣ 周期位置 (Marks 钟摆 + Dalio 4 象限)
   - 钟摆评分：[+45 — 偏乐观]
   - 4 象限：[增长↓ × 通胀↓ → 长债友好]
   - 净结论：[加仓窗口 / 谨慎区 / 高风险区]

3️⃣ 概率 (Mauboussin)
   - 当前位置历史 base rate（forward 12m）：+8% 中位数
   - 但样本中 worst case：-30%
   - 不对称是否成立：[是 / 否]

🎯 行动建议（按确信度）：
- 高确信：[xxx]
- 中确信：[xxx]
- 监控信号：[xxx，触发后切换 stance]

⚠ 失效条件（任一发生重评估）：
  - Fed 路径反转（如急剧降息）
  - 钟摆位置突变（VIX > 35）
  - 出现结构性变化使 base rate 失效
```

---

---

## 📖 Worked Examples（完整流程示范）

### 例 1：美股 — "现在该不该减仓？" 三维度

**用户问**："2025 年中市场感觉很贵，该减仓吗？"

**Step 1 — 数据预取**
- `market-pulse`：MHS 65（偏乐观），VIX ~15，HY spread ~ 历史 25%
- Fed BS：横盘小幅缩表
- 财政赤字 ~ GDP 6%

**Step 2 — 三维度交叉**

1️⃣ **Druckenmiller — 流动性**
- Fed: 状态 = hold（不放也不收）
- 财政: 赤字 6% 仍宽松 → 风险资产 friendly
- 美元: DXY ~ 100 中性
- **净结论**：流动性中性偏宽，**不支持系统性减仓**

2️⃣ **Marks — 钟摆 + Dalio — 4 象限**
- 钟摆位置（多指标共振）：
  - VIX 历史 20% 分位（低）→ +30
  - HY spread 历史 25%（窄）→ +25
  - IPO 活跃度高 → +10
  - 媒体叙事 "AI revolution" → +20
  - 综合 +60-70（**接近极度乐观区**）
- 4 象限：增长↑ × 通胀↓ → 股票（成长）友好但已 priced in
- **净结论**：周期位置接近顶部，**支持降低风险**

3️⃣ **Mauboussin — 基础率**
- 当前 S&P PE 25x + VIX < 15 + IPO 活跃，历史类似环境（1999, 2007, 2021）
- forward 12m 中位数：+5%
- 但 worst case：-25% 至 -35%
- **不对称是否成立**：不成立（下行 > 上行）

**Step 4 — 输出**

```
🌍 宏观环境综合判断 — 2025 年中

📌 一句话结论：从满仓降至 70-80%，留 20-30% 现金/短债待机会

🔍 三维度交叉

1️⃣ 流动性 (Druckenmiller)
   - Fed 状态：Hold + 缩表慢
   - 财政方向：赤字 6%（结构性宽松）
   - 净结论：风险资产中性偏 friendly

2️⃣ 周期位置 (Marks 钟摆 + Dalio 4 象限)
   - 钟摆评分：+65 — 偏乐观（接近顶部区）
   - 4 象限：增长↑ × 通胀↓ → 股票友好但已 priced in
   - 净结论：高风险区，开始减仓

3️⃣ 概率 (Mauboussin)
   - forward 12m base rate: 中位 +5%
   - worst case: -25% 至 -35%
   - 不对称：不成立

🎯 行动建议：
- 高确信：减低 beta（科技持仓减 1/3，加质量蓝筹/防御）
- 中确信：增加现金 / T-bill 至 20-30%
- 监控信号：
  - HY spread > 历史 50% 分位 → 加速防御
  - VIX > 25 → 钟摆开始下摆
  - Fed 急剧政策反转（鸽派转鹰）→ 触发流动性减仓

⚠ 失效条件（任一发生重评估）:
  - Fed 突然 QE（如银行危机） → 流动性维度反转
  - 钟摆位置突变（VIX > 35）
  - AI capex 爆发 / 财政刺激加码 → base rate 失效
```

### 例 2：BTC — "现在算牛尾还是新周期" 跨派验证

**用户问**："BTC 牛市还有没有？用宏观大师视角"

**Step 1 — 调主责工具**
- `btc-guanfu` 做 8 域指标盘（这才是 BTC 主责）
- 假设 btc-guanfu 输出：cycle 域偏顶（MVRV > 3, AHR999 > 1.5）

**Step 2 — 用宏观 lens 做交叉验证**

1️⃣ **Druckenmiller — 流动性视角**
- BTC 是流动性最敏感资产
- Fed 路径偏中性 + 美元偏强 → 流动性不再加速
- **BTC 流动性环境**：从顺风转中性

2️⃣ **Soros — 反身性阶段**
- BTC ETF 通过后（2024 Q1）→ 主流叙事 "机构入场"
- 现货 ETF 流入 → 价格上 → 更多机构接受 → 阶段 2-3
- 当前在阶段 4-5（far-from-equilibrium 至 twilight）
- **没有阶段 6 信号但已不在加仓窗口**

3️⃣ **Mauboussin — 基础率**
- BTC 历史 4 个减半周期：减半后 12-18 月达顶 → 平均 -75% drawdown
- 当前是减半后 ~12 月
- base rate: 接近顶部窗口

**Step 4 — 综合**

```
📌 一句话结论：与 btc-guanfu 8 域偏顶判断一致 — 不再加仓，分批减仓 1/3

🔍 三宏观 lens 与 BTC 主工具交叉
- btc-guanfu：cycle 域偏顶 ✅
- Druckenmiller：流动性退潮 ✅
- Soros：反身性 4-5 阶段 ✅
- Mauboussin：减半后 12 月 base rate 接近顶 ✅

→ 4 角度一致，确信度高

⚠ 失效条件:
  - 美联储重新 QE（流动性反转）
  - 主权基金 / 美国战略储备实际买入（结构性变化使 base rate 失效）
  - 减半后 16-20 月（仍可能再冲一波）
```

---

## 🔗 联动

### 联动 `thesis-tracker` — 宏观 thesis 登记协议

每次用宏观 lens 组合输出综合性判断后，应登记到 thesis-tracker：

| thesis 类型 | 何时登记 | 示例登记内容 |
|---|---|---|
| **减仓/防御 thesis** | Marks 钟摆 > +60 或 Druckenmiller 流动性转为不利 | `thesis-tracker log "SPY 减至 70%" thesis="Marks 钟摆 +65 + Druckenmiller Fed neutral" conviction=75% trigger="VIX > 25 或 HY spread 扩至 50%"` |
| **加仓/进攻 thesis** | Marks 钟摆 < -40 或 Templeton 极度悲观共振 | `thesis-tracker log "加仓 EM" thesis="Templeton 视角: CAPE 极低 + hate 叙事高峰" conviction=60% kill_criteria="CAPE 回升至历史均值"` |
| **BTC 宏观交叉 thesis** | macro-perspective 与 btc-guanfu 判断一致 | `thesis-tracker log "BTC 减仓" thesis="btc-guanfu 偏顶 + 宏观三维度一致看流动性退潮" conviction=80% trigger="BTC 再涨 20% 或 MVRV > 4"` |
| **维持现状 thesis** | Druckenmiller 中性 + Marks 钟摆 ±20 | `thesis-tracker log "维持 80/20 组合" thesis="宏观无明确加减信号" conviction=50% trigger="Fed 路径或 VIX 改变"` |

**规则**：
- 宏观 thesis 默认 decay 速度比个股快（90 天 vs 个股 180 天）
- 每个 thesis 必须包含 **trigger**（再评估触发条件），否则不登记
- 与 `btc-guanfu` 交叉一致的 thesis 可给更高 conviction

### 联动 `market-pulse` / `btc-guanfu` / `sector-analyst`

- **`market-pulse`**（必需）：每次宏观分析前必调，取 MHS / 流动性 / 情绪数据
- **`btc-guanfu`**（BTC 场景）：宏观大师 lens 做 BTC 交叉验证时，先调 btc-guanfu 取 8 域指标盘
- **`sector-analyst`**（推荐）：宏观判断影响板块轮动时调

### 联动 `value-perspective`

| 场景 | 调用顺序 |
|---|---|
| 用户问宏观问题 → 然后问个股 | `macro-perspective` → 取宏观结论 → `value-perspective` 选 lens |
| 用户问个股 → 追问宏观环境 | `value-perspective` → 看宏观是否影响 lens 判断 → `macro-perspective` 三维度 |
| 交叉场景（如 "通胀背景下该买什么"） | `macro-perspective`（Dalio 4 象限）→ `value-perspective`（Klarman hate discount） |

### 不得联动

- 不联动 `technical-analysis`（短线/技术不同步）
- 不联动 `stock-screener`（筛选是全市场，宏观视角是组合层）

---

## ⚠ 何时不要用本 skill

- 价值投资/护城河/大师选股 → `value-perspective`
- 单纯"市场怎么样"（要数据） → `market-pulse`
- 板块轮动 → `sector-analyst`
- 个股分析 → `us-stock-analysis`
- 回测策略可行性 → `backtest-expert`
- BTC 牛熊主责 → `btc-guanfu`（本 skill 仅做交叉验证）

## 📂 References 深度资料

每位大师的表达 DNA、案例库、思维模式见 `references/<master>/dna-and-cases.md`：
- `george-soros/` 反身性 6 阶段 + 1992 英镑 / 2000 互联网
- `stanley-druckenmiller/` 3 铁律 + Duquesne 30 年不亏 / 1999 双错
- `howard-marks/` 钟摆评分 + Oaktree 2008 / 2020 distressed
- `ray-dalio/` 4 象限 + All Weather + 3 周期叠加
- `jim-simons/` Renaissance 5 条方法论 + 容量约束
- `michael-mauboussin/` 4 框架（运气-技能、基础率、期望投资、群体）

调用时根据需要 Read 对应子目录获取大师的原话和案例。
