# Market Pulse — 12 子模块详解

> SKILL.md 是 MHS 评分 + 仓位 + alert 决策协议；本文档存放 12 个子模块的脚本调用与详细框架（债券/外汇/现金等）。

---

## 1. 流动性 / Fed Dashboard

```bash
python3 /Users/x/.claude/skills/market-pulse/scripts/macro-liquidity-monitor/<script>.py
```

8 因子：Fed BS、净流动性、收益率曲线、信用利差、美元、隔夜利率、商品、加密。

## 2. 宏观周期 Regime

```bash
python3 /Users/x/.claude/skills/market-pulse/scripts/macro-regime-detector/<script>.py
```

RSP/SPY、收益率曲线、信用、size 因子、股债比、行业轮动。

## 3. 中国宏观

直连 akshare，覆盖 6 大指标：

```bash
python3 -c "
import akshare as ak, json

# 1. CPI (消费者物价指数)
cpi = ak.macro_china_cpi_monthly()
print('=== CPI 同比 ===')
print(cpi.tail(6)[['日期','全国-当月','全国-同比增长']].to_string())

# 2. PPI (生产者物价指数)
ppi = ak.macro_china_ppi_yearly()
print('=== PPI ===')
print(ppi.tail(6).to_string())

# 3. PMI (采购经理指数)
pmi = ak.macro_china_pmi()
print('=== PMI ===')
print(pmi.tail(6)[['日期','制造业-数值','制造业-同比']].to_string())

# 4. M2 (广义货币供应量)
m2 = ak.macro_china_money_supply()
print('=== M2 同比 ===')
print(m2.tail(6)[['月份','货币和准货币(M2)-数量(万亿)','货币和准货币(M2)-同比增长']].to_string())

# 5. LPR (贷款市场报价利率)
lpr = ak.macro_china_lpr()
print('=== LPR ===')
print(lpr.tail(6).to_string())

# 6. GDP
gdp = ak.macro_china_gdp()
print('=== GDP ===')
print(gdp.tail(10).to_string())
"
```

| 指标 | 关键阈值 | 信号 |
|------|---------|------|
| PMI | >50 扩张 / <50 收缩 | 连续3月>50 → 经济复苏 |
| CPI | >3% 通胀 / <0% 通缩 | 0-2% 黄金区间 |
| M2 同比 | >12% 宽松 / <8% 偏紧 | 与名义GDP增速对比 |
| LPR 1Y | 下调 → 宽信用 | 与MLF同步观察 |

### 中国宏观 → MHS 联动

中国宏观不进 MHS 公式，但触发 alert：
- PMI < 48 连续 2 月 → 中国宏观风险警告 → MHS 上限 -5
- 出口增速 < -10% → 外需崩塌 → 关注政策刺激预期
- LPR 下调 + M2 加速 → 宽信用周期 → A股/港股有利

## 4. FRED 通用

利率、CPI、GDP、失业率、PCE 等 FRED 序列经 data-access facade 单一读路径获取
（`data_access.macro("DGS10")` 等）。Fed/流动性仪表盘见 §1（macro-liquidity-monitor）。

## 5. 市场情绪 Fear & Greed

### Crypto 情绪（CoinMarketCap Fear & Greed）

优先调用 CoinMarketCap 官方 MCP `cmc-mcp` 的免费/基础 Fear & Greed / global metrics 能力；不要调用 x402、私钥、pay-per-request 或付费历史端点。MCP 不可用时才用官方 REST latest 端点：

```bash
curl -sS -H "X-CMC_PRO_API_KEY: $CMC_PRO_API_KEY" \
  "https://pro-api.coinmarketcap.com/v3/fear-and-greed/latest" | jq '.data'
```

0-100（VIX、Put/Call、Junk Spread、Safe Haven、Momentum、Breadth、Volatility）。

### A股情绪（akshare 直连）

```bash
python3 -c "
import akshare as ak

# 1. 涨跌停统计 — 市场情绪核心
df = ak.stock_market_activity_legu()
print('=== 涨跌停情绪 ===')
print(df.to_string())

# 2. 涨跌家数（市场宽度）
df2 = ak.stock_zh_a_spot()
up = (df2['涨跌幅'] > 0).sum()
down = (df2['涨跌幅'] < 0).sum()
flat = len(df2) - up - down
total = len(df2)
print(f'上涨: {up} | 下跌: {down} | 平盘: {flat}')
print(f'上涨比率: {up/total*100:.1f}%')

# 3. 成交额变化
amount = df2['成交额'].sum() / 1e8
print(f'全A成交额: {amount:.0f}亿')
"
```

| A股情绪指标 | 冰点 | 正常 | 过热 |
|------------|------|------|------|
| 涨停数 | <30 | 50-150 | >200 |
| 跌停数 | >100 | 10-50 | <5 |
| 上涨比率 | <20% | 40-60% | >80% |
| 成交额(万亿) | <0.5 | 0.8-1.5 | >2.0 |

### A股情绪 → MHS 修正

A股情绪不进 MHS，但触发 alert：
- 涨停 < 30 + 上涨比率 < 20% → A股情绪冰点 → 可关注反弹
- 涨停 > 200 + 上涨比率 > 80% → A股情绪过热 → 警惕回调
- 跌停 > 100 → A股恐慌 → 暂缓A股买入

覆盖 US / A股 / HK / Crypto。

## 6. 顶部检测（防御）

```bash
python3 /Users/x/.claude/skills/market-pulse/scripts/market-top-detector/<script>.py
```

战术（2-8w）：O'Neil 分布日 + Minervini + Monty 防御轮动。
战略：Minsky / Kindleberger 泡沫框架。

## 7. 底部确认（进攻）

```bash
python3 /Users/x/.claude/skills/market-pulse/scripts/ftd-detector/<script>.py
```

双指数（SPX + NDX）状态机：rally → FTD qualification → 后续健康度。

## 8. 市场宽度 Breadth

```bash
python3 /Users/x/.claude/skills/market-pulse/scripts/market-breadth/<script>.py --mode full
```

S&P 500 breadth + 行业上行率 (0-100)。

## 9. 地缘风险

```bash
python3 /Users/x/.claude/skills/market-pulse/scripts/geopolitical-risk-monitor/<script>.py
```

5 因子加权 (0-100)：新闻情绪、避险流、油价中断、波动率/信用、跨资产确认。

---

## 10. 债券 / 固定收益

**核心问题**：现在该配什么久期？信用风险值得承担吗？通胀预期方向？

### 收益率曲线分析

| 曲线形态 | 含义 | 股债配置 |
|---|---|---|
| **正常陡峭** (2s10s > 100bp) | 经济扩张预期 | 正常股债比，偏短久期 |
| **平坦** (2s10s < 50bp) | 周期后期 | 开始加长久期 |
| **倒挂** (2s10s < 0) | 衰退预警 | 延长久期、加 IG 信用 |
| **重新陡峭** (倒挂→转正) | 复苏 early cycle | 缩短久期、加股票 |

### 信用利差监控

| 指标 | 正常 | 警戒 | 危机 | 数据源 |
|---|---|---|---|---|
| IG OAS | < 100bp | 100-150bp | > 200bp | FRED `BAMLC0A0CM` |
| HY OAS | < 350bp | 350-500bp | > 700bp | FRED `BAMLH0A0HYM2` |
| 趋势 | 收窄 | 走阔 50bp+/月 | 走阔 100bp+/周 | — |

**信用利差走阔 → 减仓股票、加仓国债**（领先股市 1-3 个月）

### TIPS BEI（盈亏平衡通胀）

| BEI | 含义 |
|---|---|
| < 2.0% | 通缩/衰退 → 延长名义久期 |
| 2.0-2.5% | 正常 → 维持 |
| > 2.5% | 通胀升温 → 缩久期、加 TIPS / 商品 |

数据：FRED `T10YIE`（10y BEI）、`DFII10`（10y TIPS yield）

### 个人投资者债券决策树

```
2s10s 状态？
├─ 倒挂 (< 0)        → 延长久期 7-10y、买 IG（赌衰退债涨）
├─ 重新陡峭 (0-50bp) → 缩到 1-3y、转股票（复苏 → 长久期被打）
├─ 正常陡峭 (>100bp) → 1-3y / floating rate（Fed 可能加息）
└─ 平坦 (< 50bp)     → 逐步延长 3-7y（周期后期 → 降息有利长久期）
```

**信用敞口**：
- IG OAS < 100bp → 利差薄，不加
- IG OAS > 150bp → 折价，逐步加 IG/HY
- HY OAS > 500bp → 历史性机会（过去 20 年此后 12m 平均 +15%）

---

## 11. 外汇

**核心问题**：跨市场敞口隐含什么货币风险？要对冲吗？

### DXY 驱动力

| 因子 | 方向 | 解读 |
|---|---|---|
| 实际利差 (US - X) | ↑ → DXY ↑ | 美国实际利率领先 = 美元强 |
| 经济增长差 | US better → DXY ↑ | 基本面相对强 |
| 风险偏好 | Risk-off → DXY ↑ | 美元 = 避险 |
| 贸易条件 | US 进口通胀 ↓ → DXY ↑ | 买美国货便宜 |

### 多市场投资者货币敞口

| 持仓 | 隐含货币敞口 | 风险 |
|---|---|---|
| 美股 | USD（基准）| — |
| 港股 | HKD peg USD | 基本无 |
| A 股 | CNY/USD 波动 | **主要外汇风险** |
| 加密 | 全球定价 | — |

### CNY/USD 关键判断

```
贬值压力（USDCNY ↑）：
- 中美利差走阔（US10y - CN10y > 250bp）→ 资本外流
- PBOC 宽松（降准/降息）→ 供给增加
- 出口弱 → 贸易盈余缩小

升值压力（USDCNY ↓）：
- 中美利差收窄
- PBOC 收紧或口头干预（"没有持续贬值基础"）
- 出口超预期 → 结汇需求增
```

**AI 行为**：
- A 股 + 中美利差 > 250bp → 提醒货币贬值风险
- USDCNY 逼近 7.35+ → 提醒 PBOC 干预
- 港股不受影响（HKD peg）

### 对冲决策

| 情境 | 建议 |
|---|---|
| A 股 + CNY 贬值 | 不对冲（A 股就是 CNY 资产）或转港股 |
| 美股 + USD 看跌 | 不对冲（美股本就是 USD 敞口） |
| 对冲 USD | 买黄金 GLD / 发达市场 ex-US（VEA）|
| 对冲 CNY | 增加海外敞口本身即对冲 |

> **散户原则**：除非有专门货币策略，否则不裸做多/空外汇。把货币敞口当组合成本，不是 alpha。

---

## 12. 现金 / 货币市场

**核心问题**：现金放哪里？通胀在吃我的现金吗？什么情况下现金不是垃圾？

### 现金 ≠ 无为 — 现金是一种配置

| 环境 | 现金价值 | 行动 |
|---|---|---|
| 高通胀 (CPI > 4%) | 每年贬 4%+ | 缩短现金、转 TIPS / 商品 / I-Bonds |
| 温和通胀 (CPI 2-3%) | 贬值可控 | 持 10-20% 储备 |
| 通缩 (CPI < 0) | 现金升值 | 现金为王 |
| 高利率 (Fed > 5%) | 5%+ 收益 | earning asset |
| 低利率 (Fed < 2%) | 无收益 | 仅交易/机会储备金 |

### 现金安置工具

| 工具 | 当前收益 | 流动性 | 风险 | 适合 |
|---|---|---|---|---|
| 货币基金 (VMFXX/SWVXX) | ~Fed Funds - 0.1% | T+1 | 极低 | 主力安置 |
| 短期国债 ETF (SGOV/BIL) | ~3m T-bill | 盘中 | 极低 | 替代货币基金 |
| T-Bill Ladder (4/8/13/26周) | 略高 | 到期取 | 无（政府）| 确定不立刻用 |
| HYSA | ~Fed - 0.5% | 即刻 | FDIC $250K | 紧急备用 |
| I-Bonds (US) | CPI 联动 | 锁 1y | 无 | 抗通胀长期 |
| 短 IG 债 ETF (PULS/JPST) | T-bill +50-80bp | 盘中 | 极低 | 安全边际内多赚 |

### 实际现金回报 = 名义 - 通胀

```
当前 (2026-04):
  Fed Funds ≈ 4.33% / CPI ≈ 2.5%
  实际 ≈ +1.83% ✅

对比 2021:
  Fed Funds ≈ 0.08% / CPI ≈ 7.0%
  实际 ≈ -6.92% ❌（负资产）
```

**散户规则**：
- 实际 > 0 → earning asset，可多持
- 实际 < -2% → 减现金，转 TIPS / 短债 / 商品
- 始终保留 5-10% 机会储备金

### 多货币现金管理

| 账户币种 | 安置 | 注意 |
|---|---|---|
| USD（美股）| VMFXX / SGOV | 最佳 |
| HKD（港股）| HKD 货币基金 / 定存 | HKD peg，无汇率风险 |
| CNY（A 股）| 逆回购 / 余额宝 / 零钱通 | CNY 贬值风险，别留过多 |
| USDT/USDC（加密）| 稳定币生息 / 赎回法币 | 平台 + depeg 风险 |

### 与 MHS 仓位表联动

MHS 表给"现金%"上限；具体安置由本模块决定：

| MHS | 现金% | 安置策略 |
|---|---|---|
| 80-100 | 10% | 全部货币基金 |
| 50-65 | 35% | 70% 货币基金 + 30% T-Bill ladder |
| 20-35 | 70% | 50% T-Bill + 30% 货币基金 + 20% I-Bonds |
| 0-20 | 80%+ | 主力国债短端 + TIPS（保购买力） |

---

## 周日标准 Market Pulse 流程（详细版）

```
1️⃣ 运行 9 模块（AI 自动选子集，不必每次全跑）
2️⃣ 计算 MHS（公式见 SKILL.md）
3️⃣ 对照仓位指导表
4️⃣ 检查 alert 阈值
5️⃣ 输出：
   📊 MHS: X / 100 → 状态
   💰 仓位上限: X%
   🎯 本周策略: [一句]
   🚨 Alert: [无 / 顶部关注 / 底部关注]
```
