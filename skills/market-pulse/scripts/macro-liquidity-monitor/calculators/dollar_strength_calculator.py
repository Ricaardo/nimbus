"""组件 5: 美元强弱 (权重 10%) — 反向指标
Fallback 链: Finnhub → Twelve Data → yfinance → [SEARCH_NEEDED]
"""

import logging

logger = logging.getLogger(__name__)


def calculate(finnhub_client=None, twelvedata_client=None, lookback_days=180):
    """Finnhub 优先获取 UUP 实时报价，TwelveData / yfinance 作 fallback"""

    # 方案 1: Finnhub quote（实时，不受 yfinance 限速）
    if finnhub_client:
        try:
            q = finnhub_client.get_quote("UUP")
            if q and q["price"] and q["prev_close"]:
                price = q["price"]
                change_pct = q.get("change_pct", 0) or 0
                # Finnhub 只有日涨跌幅，用作近似
                # 反向评分：美元走强=紧缩
                if change_pct < -0.5:
                    score = 75
                elif change_pct < -0.1:
                    score = 62
                elif change_pct < 0.1:
                    score = 50
                elif change_pct < 0.5:
                    score = 38
                else:
                    score = 22

                signal = "easing" if score >= 60 else "tightening" if score < 40 else "neutral"
                return {
                    "name": "美元强弱",
                    "weight": 0.10,
                    "score": score,
                    "signal": signal,
                    "data_available": True,
                    "data": {
                        "uup_price": price,
                        "day_change_pct": round(change_pct, 2),
                        "source": "finnhub",
                    },
                    "reasoning": f"UUP ${price:.2f} (日涨跌 {change_pct:+.2f}%)，美元{'走弱' if change_pct < 0 else '走强'}",
                }
        except Exception as e:
            logger.debug("Finnhub UUP 获取失败: %s", e)

    # 方案 2: Twelve Data
    if twelvedata_client:
        try:
            series = twelvedata_client.get_time_series("UUP", interval="1day", outputsize=30)
            if series and len(series) >= 20:
                current = series[-1]["close"]
                d30_ago = series[-22]["close"] if len(series) >= 22 else series[0]["close"]
                ret_30d = (current / d30_ago - 1) * 100
                return _score_from_return(current, ret_30d, "TwelveData", series[-1]["datetime"][:10])
        except Exception as e:
            logger.debug("TwelveData UUP 获取失败: %s", e)

    # 方案 3: yfinance（可能被限速）
    try:
        import yfinance as yf
        df = yf.download("UUP", period="6mo", progress=False)
        if df is not None and len(df) >= 20:
            close = df["Close"].values.flatten()
            current = float(close[-1])
            d30_ago = float(close[-22]) if len(close) >= 22 else float(close[0])
            ret_30d = (current / d30_ago - 1) * 100
            return _score_from_return(current, ret_30d, "yfinance", df.index[-1].strftime("%Y-%m-%d"))
    except Exception as e:
        logger.debug("yfinance UUP 获取失败: %s", e)

    return _empty("UUP 数据不可用（Finnhub + TwelveData + yfinance 均失败）",
                  search_hint="UUP US dollar index ETF price today")


def _score_from_return(current, ret_30d, source, as_of):
    """根据 30d 收益率评分"""
    if ret_30d < -3:
        score = 90
    elif ret_30d < -1:
        score = 75
    elif ret_30d < 0:
        score = 60
    elif ret_30d < 1:
        score = 45
    elif ret_30d < 3:
        score = 30
    else:
        score = 15

    signal = "easing" if score >= 60 else "tightening" if score < 40 else "neutral"
    return {
        "name": "美元强弱",
        "weight": 0.10,
        "score": score,
        "signal": signal,
        "data_available": True,
        "data": {
            "uup_price": round(current, 2),
            "return_30d_pct": round(ret_30d, 2),
            "source": source,
            "as_of": as_of,
        },
        "reasoning": f"UUP 30d {ret_30d:+.2f}%，美元{'走弱' if ret_30d < 0 else '走强'}",
    }


def _empty(reason, search_hint=""):
    return {
        "name": "美元强弱",
        "weight": 0.10,
        "score": 50,
        "signal": "neutral",
        "data_available": False,
        "data": {},
        "reasoning": reason,
        "search_hint": search_hint,
    }
