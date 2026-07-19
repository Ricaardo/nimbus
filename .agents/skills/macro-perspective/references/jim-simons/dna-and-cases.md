# Jim Simons — 表达 DNA + 案例库

## 🎙 表达 DNA

1. **极度低调**：相比所有其他大师，Simons 几乎不公开谈交易
2. **数学语言**：他的极少公开发言用数学家口吻（统计显著、信噪比、p-value）
3. **结果导向**：不解释 why，只展示 what works
4. **拒绝叙事**：明确反对"故事驱动"投资
5. **科学家文化**：Renaissance 招的全是 PhD（数学/物理/统计），没有 MBA / 金融背景

**典型句式**：
- "We don't override the model."
- "If you trade often enough, you don't need to be right that often."
- "I don't know why the model works, and I don't care."
- "Past performance is the best predictor of success in trading."

## 📚 经典里程碑

### Renaissance Technologies (1982 创立)
- 1988 Medallion Fund 启动
- 1988-2018 Medallion 平均**毛回报 66%**，**净回报 39%**（费后）
- 行业有史以来最强表现，无人接近
- Medallion 1993 起对外部封闭，仅员工持有

### 数据驱动方法论
- 完全机械化，不允许人为干预
- 寻找小但稳定的 edge（51-55% 胜率）
- 高频 + 大量交易次数 → 复利
- 据传整体策略组合包含数千个独立信号

### Medallion 的不可复制性
- 容量有限（~$10B 上限）
- 高换手 = 高摩擦，需要极致执行
- 公开基金（RIEF, RIEF）表现远不如 Medallion，证明策略本身有规模上限

## 📕 局限

### 公开基金表现平庸
- RIEF / RIDA 长期跑输标普
- 证明 Medallion 是低容量、高频策略
- 散户不可能用 Renaissance 方法（数据 + 算力 + 容量都达不到）

### 2020 COVID 期间公开基金大亏
- RIEF 单年 -19%
- RIDA -33%
- Medallion 同期 +76%（员工独享）
- 显示同一个公司不同策略的容量差异

### Simons 离世后 Renaissance 仍在
- 2024 年 Simons 去世
- 接任者 Peter Brown / Robert Mercer 继续运营
- Medallion 仍是封闭基金

## 🧠 思维模式

**核心方法论 5 条**：
1. **小 edge + 大频次**：51% 胜率 × 1000 笔 > 60% 胜率 × 10 笔
2. **机械执行**：无人干预，避免情绪干扰
3. **黑箱可接受**：不需要懂为什么，只需要回测稳
4. **统计严格**：t-test、Sharpe、滚动稳定性都要满足
5. **复合多信号**：单信号弱无所谓，组合后效果非线性放大

**Renaissance 招聘哲学**：
- 不要金融人
- 要 PhD（数学、物理、统计、CS）
- 要能写代码 + 懂统计 + 不带先入观

**"为什么这有用" 的反直觉**：
- 市场被人类情绪驱动 → 留下统计可识别的模式
- 这些模式不需要"经济解释"，只需要稳定
- 反而"有故事"的策略往往是过拟合

**容量是核心约束**：
- 更高 alpha → 更小容量（Medallion ~$10B）
- 更大资金 → 更低 alpha（RIEF $20B+，但 Sharpe < 1）

## ⚠ 常见误用

- **"我也能搞 Simons 量化"** — 几乎不可能。需要 PhD 级数学 + 数据 + 算力 + 风控
- **"过去回测好就买"** — 过拟合是头号敌人。Simons 自己最警惕
- **认为单信号就够了** — Renaissance 是数千信号组合
- **"Medallion 公开过策略"** — 没有。Renaissance 是金融业最严密的保密体系
- **把"高 Sharpe = Renaissance 风格"** — 错。Sharpe 还需要长期稳定 + 滚动稳定 + 不同市场环境验证

## 📖 必读

- Gregory Zuckerman《The Man Who Solved the Market》（2019, Simons 唯一权威传记）
- MIT Simons 演讲（2010, YouTube, 仅讲数学/早期生活，不讲交易）
- Numerai / Two Sigma / D.E. Shaw 等量化基金的公开方法论作为补充

注：Simons 几乎没有可靠的交易访谈。其他声称"Simons 说..."的内容多为二手转述。
