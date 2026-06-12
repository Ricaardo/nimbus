"""组件 3: 石油供应中断 (权重 15%) — CL=F, BZ=F
Fallback 链: Finnhub → Twelve Data → yfinance → [SEARCH_NEEDED]
"""

import logging

logger = logging.getLogger(__name__)


def calculate(finnhub_client=None, twelvedata_client=None, lookback_days=30):
    wti_close = None
    brent_close = None

    # 方案 1: Finnhub quote（简化，仅日涨跌）
    if finnhub_client:
        try:
            cl_q = finnhub_client.get_quote("CL")
            if cl_q and cl_q["price"] and cl_q["price"] > 0:
                price = cl_q["price"]
                change_pct = cl_q.get("change_pct", 0) or 0
                # 仅日涨跌，近似 5d
                if change_pct > 5:
                    score = 90
                elif change_pct > 3:
                    score = 70
                elif change_pct > 1:
                    score = 45
                elif change_pct > -1:
                    score = 25
                else:
                    score = 10
                signal = "crisis" if score >= 60 else "elevated" if score >= 40 else "calm"
                return {
                    "name": "石油供应中断",
                    "weight": 0.15,
                    "score": score,
                    "signal": signal,
                    "data_available": True,
                    "data": {
                        "wti_price": round(price, 2),
                        "day_change_pct": round(change_pct, 2),
                        "source": "finnhub",
                    },
                    "reasoning": f"WTI ${price:.0f} (日 {change_pct:+.1f}%)",
                }
        except Exception as e:
            logger.debug("Finnhub 原油报价失败: %s", e)

    # 方案 2: Twelve Data 时间序列
    if twelvedata_client:
        try:
            wti_series = twelvedata_client.get_time_series("WTI/USD", interval="1day", outputsize=25)
            if wti_series and len(wti_series) >= 6:
                wti_close = [d["close"] for d in wti_series]
                # 尝试 Brent
                bz_series = twelvedata_client.get_time_series("BZ/USD", interval="1day", outputsize=25)
                if bz_series and len(bz_series) >= 6:
                    brent_close = [d["close"] for d in bz_series]
                return _score_from_prices(wti_close, brent_close, "TwelveData")
        except Exception as e:
            logger.debug("TwelveData 原油数据获取失败: %s", e)

    # 方案 3: yfinance
    try:
        import yfinance as yf
        wti = yf.download("CL=F", period="1mo", progress=False)
        brent = yf.download("BZ=F", period="1mo", progress=False)
    except Exception as e:
        logger.error("原油数据获取失败: %s", e)
        return _empty("yfinance 不可用",
                      search_hint="WTI crude oil price today, Brent crude oil price")

    if wti is None or len(wti) < 5:
        return _empty("原油数据不足",
                      search_hint="WTI crude oil price today, Brent crude oil price")

    wti_close = list(wti["Close"].values.flatten())
    brent_close = None
    if brent is not None and len(brent) >= 6:
        brent_close = list(brent["Close"].values.flatten())

    return _score_from_prices(wti_close, brent_close, "yfinance")


def _score_from_prices(wti_close, brent_close, source):
    """根据价格序列计算评分"""
    wti_5d = (float(wti_close[-1]) / float(wti_close[-6]) - 1) * 100 if len(wti_close) >= 6 else 0
    wti_20d = (float(wti_close[-1]) / float(wti_close[0]) - 1) * 100

    brent_5d = 0
    if brent_close and len(brent_close) >= 6:
        brent_5d = (float(brent_close[-1]) / float(brent_close[-6]) - 1) * 100

    # Scoring: oil spike = supply disruption risk
    max_5d = max(wti_5d, brent_5d)

    if max_5d > 10:
        score = 90
    elif max_5d > 5:
        score = 70
    elif max_5d > 3:
        score = 55
    elif max_5d > 0:
        score = 30
    elif max_5d > -3:
        score = 20
    else:
        score = 10  # Oil falling = no disruption

    signal = "crisis" if score >= 60 else "elevated" if score >= 40 else "calm"

    return {
        "name": "石油供应中断",
        "weight": 0.15,
        "score": score,
        "signal": signal,
        "data_available": True,
        "data": {
            "wti_price": round(float(wti_close[-1]), 2),
            "wti_5d_pct": round(wti_5d, 2),
            "wti_20d_pct": round(wti_20d, 2),
            "brent_5d_pct": round(brent_5d, 2),
            "source": source,
        },
        "reasoning": f"WTI 5天 {wti_5d:+.1f}%，Brent 5天 {brent_5d:+.1f}%",
    }


def _empty(reason, search_hint=""):
    return {
        "name": "石油供应中断",
        "weight": 0.15,
        "score": 25,
        "signal": "calm",
        "data_available": False,
        "data": {},
        "reasoning": reason,
        "search_hint": search_hint,
    }
