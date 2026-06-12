"""组件 7: 商品/通胀/油价冲击 (权重 10%) — GC=F (金), CL=F (油), BZ=F (布伦特)

Fallback 链: Finnhub → Twelve Data → yfinance 批量 → [SEARCH_NEEDED]

增强要点（参考 IMF / A1 Trading 研究）：
1. 权重从 5% → 10%（油价冲击是重要的流动性紧缩信号）
2. 油价涨幅分级：>15% 暴涨 = 供给冲击 / >30% = 严重冲击
3. IMF 规则：油价每涨 10% → 通胀 +40bp, GDP -0.1~0.2pp
4. 滞胀信号检测：金涨+油暴涨 = stagflation（最差组合）
5. 添加 60d 长周期趋势判断
"""

import logging
import time

logger = logging.getLogger(__name__)


def calculate(finnhub_client=None, twelvedata_client=None, lookback_days=90):
    gold = None
    oil = None

    # 方案 1: Finnhub quote 获取实时价格（快速，不受 yfinance 限速）
    fh_gold_price = None
    fh_oil_price = None
    fh_oil_change = None
    if finnhub_client:
        try:
            gld_q = finnhub_client.get_quote("GLD")  # Gold ETF (GC期货在Finnhub返回0)
            if gld_q and gld_q["price"]:
                fh_gold_price = gld_q["price"]
            cl_q = finnhub_client.get_quote("CL")  # Oil futures
            if cl_q and cl_q["price"]:
                fh_oil_price = cl_q["price"]
                fh_oil_change = cl_q.get("change_pct", 0) or 0
        except Exception as e:
            logger.debug("Finnhub 商品报价失败: %s", e)

    # 方案 2: Twelve Data 时间序列（比 yfinance 更稳定）
    if twelvedata_client:
        try:
            gold_series = twelvedata_client.get_time_series("XAU/USD", interval="1day", outputsize=65)
            oil_series = twelvedata_client.get_time_series("WTI/USD", interval="1day", outputsize=65)
            if gold_series and len(gold_series) >= 20 and oil_series and len(oil_series) >= 20:
                return _score_from_series(gold_series, oil_series, "TwelveData")
        except Exception as e:
            logger.debug("TwelveData 商品数据获取失败: %s", e)

    # 方案 3: yfinance 历史数据（用于计算 30d/60d 收益率）
    try:
        import yfinance as yf
        # 批量下载减少请求次数
        data = yf.download(["GC=F", "CL=F"], period="3mo", progress=False)
        if data is not None and len(data) >= 20:
            gold = data["Close"]["GC=F"].dropna() if "GC=F" in data["Close"].columns else None
            oil = data["Close"]["CL=F"].dropna() if "CL=F" in data["Close"].columns else None
    except Exception as e:
        logger.debug("yfinance 商品数据获取失败: %s", e)

    # 如果 yfinance 和 Finnhub 都没拿到数据
    if (gold is None or len(gold) < 20) and fh_oil_price is None:
        return _empty("商品数据不可用（Finnhub + TwelveData + yfinance 均失败）",
                      search_hint="gold price today XAU/USD, WTI crude oil price today")

    # 如果只有 Finnhub 实时报价（无历史），用简化评分
    if (gold is None or len(gold) < 20) and fh_oil_price:
        return _score_from_finnhub(fh_gold_price, fh_oil_price, fh_oil_change)

    if gold is None or len(gold) < 20 or oil is None or len(oil) < 20:
        return _empty("商品数据不足",
                      search_hint="gold price today XAU/USD, WTI crude oil price today")

    gold_close = gold["Close"].values.flatten()
    oil_close = oil["Close"].values.flatten()

    # 30 天收益率
    gold_ret_30d = (float(gold_close[-1]) / float(gold_close[-22]) - 1) * 100 if len(gold_close) >= 22 else 0
    oil_ret_30d = (float(oil_close[-1]) / float(oil_close[-22]) - 1) * 100 if len(oil_close) >= 22 else 0

    # 60 天收益率（更长趋势）
    gold_ret_60d = (float(gold_close[-1]) / float(gold_close[-44]) - 1) * 100 if len(gold_close) >= 44 else gold_ret_30d
    oil_ret_60d = (float(oil_close[-1]) / float(oil_close[-44]) - 1) * 100 if len(oil_close) >= 44 else oil_ret_30d

    # 油价当前水平（绝对价格也有意义）
    oil_price = float(oil_close[-1])
    gold_price = float(gold_close[-1])

    return _score_core(gold_price, gold_ret_30d, gold_ret_60d, oil_price, oil_ret_30d, oil_ret_60d, "yfinance")


def _score_from_series(gold_series, oil_series, source):
    """从时间序列数据计算评分"""
    gold_close = [d["close"] for d in gold_series]
    oil_close = [d["close"] for d in oil_series]

    gold_ret_30d = (gold_close[-1] / gold_close[-22] - 1) * 100 if len(gold_close) >= 22 else 0
    oil_ret_30d = (oil_close[-1] / oil_close[-22] - 1) * 100 if len(oil_close) >= 22 else 0

    gold_ret_60d = (gold_close[-1] / gold_close[-44] - 1) * 100 if len(gold_close) >= 44 else gold_ret_30d
    oil_ret_60d = (oil_close[-1] / oil_close[-44] - 1) * 100 if len(oil_close) >= 44 else oil_ret_30d

    oil_price = oil_close[-1]
    gold_price = gold_close[-1]

    return _score_core(gold_price, gold_ret_30d, gold_ret_60d, oil_price, oil_ret_30d, oil_ret_60d, source)


def _score_core(gold_price, gold_ret_30d, gold_ret_60d, oil_price, oil_ret_30d, oil_ret_60d, source):
    """核心评分逻辑"""
    # === 评分逻辑 ===
    # 核心思想：油价暴涨 = 通胀冲击 = 流动性紧缩
    # 金价上涨 = 宽松预期，但如果同时油暴涨 = 滞胀信号

    score = 50  # 基准中性

    # 第一层：油价冲击检测（最重要）
    if oil_ret_30d > 30:
        # 严重供给冲击（如战争导致）
        score = 5
        oil_desc = "严重供给冲击"
    elif oil_ret_30d > 20:
        score = 15
        oil_desc = "重大油价冲击"
    elif oil_ret_30d > 15:
        score = 22
        oil_desc = "显著油价冲击"
    elif oil_ret_30d > 10:
        score = 30
        oil_desc = "油价快速上涨"
    elif oil_ret_30d > 5:
        score = 38
        oil_desc = "油价温和上涨"
    elif oil_ret_30d > 0:
        score = 48
        oil_desc = "油价小幅上涨"
    elif oil_ret_30d > -5:
        score = 55
        oil_desc = "油价稳定/小跌"
    elif oil_ret_30d > -10:
        score = 60
        oil_desc = "油价下跌（减压）"
    else:
        score = 65
        oil_desc = "油价大幅下跌（需求忧虑）"

    # 第二层：金价调整
    if gold_ret_30d > 5:
        # 金价强涨 = 宽松预期 / 避险需求
        if oil_ret_30d > 15:
            # 金涨+油暴涨 = 滞胀信号（最坏情况），不加分反扣分
            score -= 5
            gold_desc = "滞胀信号（金油齐涨）"
        else:
            score += 8
            gold_desc = "金价强势（宽松预期）"
    elif gold_ret_30d > 2:
        score += 4
        gold_desc = "金价温和上涨"
    elif gold_ret_30d < -3:
        score -= 5
        gold_desc = "金价下跌（鹰派预期）"
    else:
        gold_desc = "金价平稳"

    # 第三层：长期趋势修正
    if oil_ret_60d > 25:
        score -= 5  # 持续上涨趋势额外扣分
    elif oil_ret_60d < -15:
        score += 5  # 持续下跌额外加分

    # 绝对价格水平修正
    if oil_price > 100:
        score -= 3  # 高油价本身是经济负担
    elif oil_price < 50:
        score += 3  # 低油价有利

    score = max(0, min(100, round(score)))
    signal = "easing" if score >= 60 else "tightening" if score < 40 else "neutral"

    reasoning = f"{oil_desc}：油价 ${oil_price:.0f} (30d {oil_ret_30d:+.1f}%, 60d {oil_ret_60d:+.1f}%)，{gold_desc}：金价 ${gold_price:.0f} (30d {gold_ret_30d:+.1f}%)"

    return {
        "name": "商品/油价冲击",
        "weight": 0.10,
        "score": score,
        "signal": signal,
        "data_available": True,
        "data": {
            "gold_price": round(gold_price, 2),
            "gold_30d_return_pct": round(gold_ret_30d, 2),
            "gold_60d_return_pct": round(gold_ret_60d, 2),
            "oil_price": round(oil_price, 2),
            "oil_30d_return_pct": round(oil_ret_30d, 2),
            "oil_60d_return_pct": round(oil_ret_60d, 2),
            "oil_shock_desc": oil_desc,
            "source": source,
        },
        "reasoning": reasoning,
    }


def _score_from_finnhub(gold_price, oil_price, oil_day_change_pct):
    """仅用 Finnhub 实时报价评分（无历史趋势，精度较低但有数据总比没有好）"""
    score = 50

    if oil_day_change_pct is not None:
        if oil_day_change_pct > 3:
            score = 20
        elif oil_day_change_pct > 1:
            score = 35
        elif oil_day_change_pct > -1:
            score = 50
        elif oil_day_change_pct > -3:
            score = 60
        else:
            score = 70

    # 绝对价格修正
    if oil_price and oil_price > 100:
        score -= 5
    elif oil_price and oil_price < 50:
        score += 5

    score = max(0, min(100, round(score)))
    signal = "easing" if score >= 60 else "tightening" if score < 40 else "neutral"

    parts = []
    if oil_price:
        parts.append(f"油价 ${oil_price:.0f} (日 {oil_day_change_pct:+.1f}%)")
    if gold_price:
        parts.append(f"金 ${gold_price:.0f}")

    return {
        "name": "商品/油价冲击",
        "weight": 0.10,
        "score": score,
        "signal": signal,
        "data_available": True,
        "data": {
            "gold_price": gold_price,
            "oil_price": oil_price,
            "oil_day_change_pct": oil_day_change_pct,
            "source": "finnhub",
        },
        "reasoning": "（Finnhub实时）" + "，".join(parts),
    }


def _empty(reason, search_hint=""):
    return {
        "name": "商品/油价冲击",
        "weight": 0.10,
        "score": 50,
        "signal": "neutral",
        "data_available": False,
        "data": {},
        "reasoning": reason,
        "search_hint": search_hint,
    }
