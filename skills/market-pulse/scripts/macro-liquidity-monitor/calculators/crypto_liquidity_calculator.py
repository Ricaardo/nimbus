"""组件 8: 加密风险偏好 (权重 10%) — BTC 30d/90d 动量
Fallback 链: Finnhub → OKX → Binance → Twelve Data → yfinance → [SEARCH_NEEDED]
"""

import logging
import os
import sys

logger = logging.getLogger(__name__)


def calculate(finnhub_client=None, twelvedata_client=None, lookback_days=90):
    shared_dir = os.path.join(os.path.dirname(__file__), "..", "..", "..", "shared")
    if shared_dir not in sys.path:
        sys.path.insert(0, shared_dir)

    # 方案 0: Finnhub quote（最快，不受限速）
    if finnhub_client:
        try:
            q = finnhub_client.get_quote("BINANCE:BTCUSDT")
            if q and q["price"] and q["price"] > 0:
                price = q["price"]
                change_pct = q.get("change_pct", 0) or 0
                # 用日涨跌幅近似评分
                if change_pct > 3:
                    score = 80
                elif change_pct > 1:
                    score = 65
                elif change_pct > -1:
                    score = 50
                elif change_pct > -3:
                    score = 35
                else:
                    score = 20
                signal = "easing" if score >= 60 else "tightening" if score < 40 else "neutral"
                return {
                    "name": "加密风险偏好",
                    "weight": 0.10,
                    "score": score,
                    "signal": signal,
                    "data_available": True,
                    "data": {
                        "btc_price": round(price, 0),
                        "day_change_pct": round(change_pct, 2),
                        "source": "finnhub",
                    },
                    "reasoning": f"BTC ${price:,.0f} (日涨跌 {change_pct:+.2f}%)",
                }
        except Exception as e:
            logger.debug("Finnhub BTC 获取失败: %s", e)

    # 方案 1: OKX（公开 API，无需 key）
    try:
        from okx_client import OKXClient
        okx = OKXClient()
        ticker = okx.get_ticker("BTC")
        if ticker and ticker["price"] > 0:
            candles = okx.get_candles("BTC", "1D", lookback_days)
            if candles is not None and len(candles) >= 30:
                close = candles["close"].values
                current = float(close[-1])
                d30 = float(close[-31]) if len(close) >= 31 else float(close[0])
                d90 = float(close[0])
                ret_30d = (current / d30 - 1) * 100
                ret_90d = (current / d90 - 1) * 100
                as_of = candles.iloc[-1]["date"].strftime("%Y-%m-%d") if hasattr(candles.iloc[-1]["date"], "strftime") else str(candles.iloc[-1]["date"])[:10]
                return _score(current, ret_30d, ret_90d, "OKX", as_of)
            else:
                # 只有 ticker 没有足够 K 线，用日涨跌
                price = ticker["price"]
                open_24h = ticker.get("open_24h", price)
                change_pct = ((price / open_24h) - 1) * 100 if open_24h > 0 else 0
                if change_pct > 3:
                    score = 80
                elif change_pct > 1:
                    score = 65
                elif change_pct > -1:
                    score = 50
                elif change_pct > -3:
                    score = 35
                else:
                    score = 20
                signal = "easing" if score >= 60 else "tightening" if score < 40 else "neutral"
                return {
                    "name": "加密风险偏好",
                    "weight": 0.10,
                    "score": score,
                    "signal": signal,
                    "data_available": True,
                    "data": {
                        "btc_price": round(price, 0),
                        "day_change_pct": round(change_pct, 2),
                        "source": "OKX",
                    },
                    "reasoning": f"BTC ${price:,.0f} (日涨跌 {change_pct:+.2f}%)",
                }
    except Exception as e:
        logger.debug("OKX BTC 获取失败: %s", e)

    # 方案 2: Binance 客户端（K线历史）
    try:
        from binance_client import BinanceClient
        client = BinanceClient()
        df = client.get_klines("BTC", "1d", lookback_days)
        if df is not None and len(df) >= 30:
            close = df["close"].values
            current = float(close[-1])
            d30 = float(close[-31]) if len(close) >= 31 else float(close[0])
            d90 = float(close[0])

            ret_30d = (current / d30 - 1) * 100
            ret_90d = (current / d90 - 1) * 100

            return _score(current, ret_30d, ret_90d, "Binance", df.iloc[-1]["date"].strftime("%Y-%m-%d") if hasattr(df.iloc[-1]["date"], "strftime") else str(df.iloc[-1]["date"])[:10])
    except Exception as e:
        logger.debug("Binance BTC 获取失败: %s", e)

    # 方案 3: Twelve Data
    if twelvedata_client:
        try:
            series = twelvedata_client.get_time_series("BTC/USD", interval="1day", outputsize=lookback_days)
            if series and len(series) >= 30:
                current = series[-1]["close"]
                d30 = series[-31]["close"] if len(series) >= 31 else series[0]["close"]
                d90 = series[0]["close"]
                ret_30d = (current / d30 - 1) * 100
                ret_90d = (current / d90 - 1) * 100
                return _score(current, ret_30d, ret_90d, "TwelveData", series[-1]["datetime"][:10])
        except Exception as e:
            logger.debug("TwelveData BTC 获取失败: %s", e)

    # 方案 4: yfinance fallback
    try:
        import yfinance as yf
        df = yf.download("BTC-USD", period="3mo", progress=False)
        if df is not None and len(df) >= 30:
            close = df["Close"].values.flatten()
            current = float(close[-1])
            d30 = float(close[-31]) if len(close) >= 31 else float(close[0])
            d90 = float(close[0])

            ret_30d = (current / d30 - 1) * 100
            ret_90d = (current / d90 - 1) * 100

            return _score(current, ret_30d, ret_90d, "yfinance", df.index[-1].strftime("%Y-%m-%d"))
    except Exception as e:
        logger.debug("yfinance BTC 获取失败: %s", e)

    return _empty("BTC 数据获取失败（Finnhub + OKX + Binance + TwelveData + yfinance 均失败）",
                  search_hint="BTC bitcoin price today USD")


def _score(price, ret_30d, ret_90d, source, as_of):
    # BTC strong momentum = liquidity abundant
    avg_ret = (ret_30d * 0.6 + ret_90d * 0.4)

    if avg_ret > 20:
        score = 95
    elif avg_ret > 10:
        score = 80
    elif avg_ret > 5:
        score = 65
    elif avg_ret > 0:
        score = 55
    elif avg_ret > -5:
        score = 40
    elif avg_ret > -15:
        score = 25
    else:
        score = 10

    signal = "easing" if score >= 60 else "tightening" if score < 40 else "neutral"

    return {
        "name": "加密风险偏好",
        "weight": 0.10,
        "score": score,
        "signal": signal,
        "data_available": True,
        "data": {
            "btc_price": round(price, 0),
            "return_30d_pct": round(ret_30d, 2),
            "return_90d_pct": round(ret_90d, 2),
            "source": source,
            "as_of": as_of,
        },
        "reasoning": f"BTC ${price:,.0f}，30d {ret_30d:+.1f}%，90d {ret_90d:+.1f}%",
    }


def _empty(reason, search_hint=""):
    return {
        "name": "加密风险偏好",
        "weight": 0.10,
        "score": 50,
        "signal": "neutral",
        "data_available": False,
        "data": {},
        "reasoning": reason,
        "search_hint": search_hint,
    }
