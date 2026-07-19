# 免费可算的周期指标 — 方法学固化 + Puell 补缺

> 更新：2026-05-22 · 用途：固化"哪些周期指标确定性免费可算"，避免重复评估/重复造轮子。
> **大原则**：价格类指标 guanfu 已经算好，直接读 `guanfu --json` 字段，**不要再手动重算**。本文件只补 guanfu 缺的那一个（Puell）+ 记录免费/付费分界。

---

## 1. 已在 guanfu 里 — 直接读字段，勿重算 ✅

这些由 guanfu 从 CoinMetrics `PriceUSD`(2010-07-18+) + Binance 日线缓存免费直算：

| 指标 | 公式 | guanfu 字段 |
|---|---|---|
| Mayer Multiple | price / 200d SMA | `cycle.mayer_multiple` |
| Pi Cycle Top | 111dMA / (2×350dMA)，≥1 触发 | `cycle.pi_cycle_top_ratio` |
| 200 周 SMA 偏离 | (price − 200wSMA) / 200wSMA | `cycle.sma_200w_dev` |
| AHR999（压缩版） | sqrt-AHR 变体 | `valuation.ahr999_compressed` |
| 周期阶段 | days_since_halving + sma_200w_dev 启发式 | `cycle.phase` |

> 任何"自己拉价格重算 Mayer/Pi Cycle"的冲动 = 反模式。先 `guanfu --domain cycle`。

---

## 2. Puell Multiple — 免费可算但 guanfu 暂缺 ⚠️（本文件补）

**定义**：`Puell = 当日矿工发行量(USD) / 365日发行量(USD) 的均值`。
衡量矿工卖压相对历史的高低：< 0.5 历史大底区，> 4 历史顶部区。

**为什么免费可算**：发行量是**确定性**的（区块补贴按减半规则可推），只需叠加免费价格序列，**不需要 realized cap**。

**区块补贴时间表**（BTC/块）：

| 生效日 | 补贴 |
|---|---|
| 2009-01-03 | 50 |
| 2012-11-28 | 25 |
| 2016-07-09 | 12.5 |
| 2020-05-11 | 6.25 |
| 2024-04-20 | 3.125 |
| ~2028（约 840000 块） | 1.5625 |

日发行量 BTC ≈ `144 × 当期补贴`（144 = 平均日出块数；要更精确可用 blockchain.com 实际出块数）。

### 脚本骨架（offline fallback，guanfu 不可用或想验算时用）

```python
import yfinance as yf, pandas as pd

# 1) 价格：优先用 guanfu 的日线缓存；此处用 yfinance 作 fallback
px = yf.download("BTC-USD", start="2014-09-17", interval="1d")["Close"].dropna()

# 2) 按日期映射区块补贴（减半表）
halvings = [("2009-01-03",50),("2012-11-28",25),("2016-07-09",12.5),
            ("2020-05-11",6.25),("2024-04-20",3.125),("2028-04-01",1.5625)]
def subsidy(d):
    s = 50.0
    for date, val in halvings:
        if d >= pd.Timestamp(date): s = val
    return s

BLOCKS_PER_DAY = 144
issuance_btc = px.index.to_series().apply(subsidy) * BLOCKS_PER_DAY
issuance_usd = issuance_btc.values * px.values            # 日发行量(USD)
issuance_usd = pd.Series(issuance_usd, index=px.index)

# 3) Puell = 当日 / 365DMA
puell = issuance_usd / issuance_usd.rolling(365).mean()
latest = puell.dropna().iloc[-1]
zone = "底部区" if latest < 0.5 else ("顶部区" if latest > 4 else "中性")
print(f"Puell Multiple = {latest:.2f} ({zone})  as of {puell.dropna().index[-1].date()}")
```

> 精度注记：`144` 是近似；矿工费收入未计入（Puell 经典定义只用区块补贴，可接受）。要更准用 blockchain.com 实际日出块数替换 `BLOCKS_PER_DAY`。

---

## 3. 免费/付费分界（与 guanfu SKILL.md 第 214-215 行一致）

| 家族 | 例 | 免费可算？ |
|---|---|---|
| **价格/发行量类** | Mayer、Pi Cycle、200WMA dev、AHR999、**Puell** | ✅ 确定性，纯价格/补贴数学 |
| **成本基础/币龄类** | MVRV、MVRV-Z、NUPL、RHODL、SOPR、Reserve Risk、LTH/STH、HODL Waves | ❌ 需全量 UTXO 币龄+成本基础 → 自建全节点+索引器，或付费(Glassnode/CryptoQuant) |

CoinMetrics 社区免费 tier **不含** `CapRealUSD`/`CapMVRVCur`（2026-05-22 curl 实测 forbidden）。币龄类要么看免费图表(Checkonchain/Bitcoin Magazine Pro)读方向，要么付费。详见 memory `reference-btc-onchain-sources`。
