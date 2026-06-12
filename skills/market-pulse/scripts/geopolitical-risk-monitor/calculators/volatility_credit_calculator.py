"""组件 4: 波动率 & 信用 (权重 15%) — ^VIX, BAMLH0A0HYM2
Fallback 链 (VIX): Finnhub → Twelve Data → yfinance → [SEARCH_NEEDED]
HY OAS: FRED only
"""

import logging

logger = logging.getLogger(__name__)


def calculate(fred_client=None, finnhub_client=None, twelvedata_client=None, lookback_days=30):
    vix_level = None
    vix_5d_change = None

    # 方案 1: Finnhub VIX quote
    if finnhub_client:
        try:
            # Finnhub 不直接支持 ^VIX，尝试 CBOE:VIX
            q = finnhub_client.get_quote("CBOE:VIX")
            if q and q["price"] and q["price"] > 0:
                vix_level = q["price"]
        except Exception as e:
            logger.debug("Finnhub VIX 获取失败: %s", e)

    # 方案 2: Twelve Data VIX
    if vix_level is None and twelvedata_client:
        try:
            series = twelvedata_client.get_time_series("VIX", interval="1day", outputsize=10)
            if series and len(series) >= 2:
                vix_level = series[-1]["close"]
                if len(series) >= 6:
                    vix_5d_change = series[-1]["close"] - series[-6]["close"]
        except Exception as e:
            logger.debug("TwelveData VIX 获取失败: %s", e)

    # 方案 3: yfinance VIX
    if vix_level is None:
        try:
            import yfinance as yf
            df = yf.download("^VIX", period="1mo", progress=False)
            if df is not None and len(df) >= 5:
                close = df["Close"].values.flatten()
                vix_level = float(close[-1])
                vix_5d_change = float(close[-1]) - float(close[-6]) if len(close) >= 6 else 0
        except Exception as e:
            logger.warning("VIX 获取失败: %s", e)

    # FRED: HY OAS
    hy_oas = None
    hy_change = None
    if fred_client:
        try:
            from datetime import datetime, timedelta
            start = (datetime.now() - timedelta(days=90)).strftime("%Y-%m-%d")
            series = fred_client.get_series("BAMLH0A0HYM2", start=start)
            if series and len(series) >= 5:
                hy_oas = series[-1]["value"]
                hy_change = round(series[-1]["value"] - series[-5]["value"], 1)
        except Exception as e:
            logger.warning("HY OAS 获取失败: %s", e)

    if vix_level is None and hy_oas is None:
        return _empty("VIX/HY 数据不可用",
                      search_hint="VIX volatility index today, high yield bond spread OAS")

    # Scoring
    vix_score = 50
    if vix_level is not None:
        if vix_level > 35:
            vix_score = 90
        elif vix_level > 25:
            vix_score = 70
        elif vix_level > 20:
            vix_score = 50
        elif vix_level > 15:
            vix_score = 30
        else:
            vix_score = 10

    hy_score = 50
    if hy_oas is not None:
        if hy_oas > 700:
            hy_score = 95
        elif hy_oas > 500:
            hy_score = 70
        elif hy_oas > 400:
            hy_score = 50
        elif hy_oas > 300:
            hy_score = 30
        else:
            hy_score = 10

    # Combine: VIX 60%, HY 40%
    if vix_level is not None and hy_oas is not None:
        score = round(vix_score * 0.6 + hy_score * 0.4)
    elif vix_level is not None:
        score = vix_score
    else:
        score = hy_score

    signal = "crisis" if score >= 60 else "elevated" if score >= 40 else "calm"

    return {
        "name": "波动率 & 信用",
        "weight": 0.15,
        "score": score,
        "signal": signal,
        "data_available": True,
        "data": {
            "vix": vix_level,
            "vix_5d_change": round(vix_5d_change, 2) if vix_5d_change is not None else None,
            "hy_oas_bp": hy_oas,
            "hy_change_bp": hy_change,
        },
        "reasoning": f"VIX {vix_level or 'N/A'}，HY OAS {hy_oas or 'N/A'}bp",
    }


def _empty(reason, search_hint=""):
    return {
        "name": "波动率 & 信用",
        "weight": 0.15,
        "score": 25,
        "signal": "calm",
        "data_available": False,
        "data": {},
        "reasoning": reason,
        "search_hint": search_hint,
    }
