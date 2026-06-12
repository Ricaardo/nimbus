"""组件 2: 避险资金流 (权重 25%) — GLD, FXY, FXF, GS10
Fallback 链: Finnhub → Twelve Data → yfinance → [SEARCH_NEEDED]
"""

import logging

logger = logging.getLogger(__name__)


def calculate(fred_client=None, finnhub_client=None, twelvedata_client=None, lookback_days=30):
    # yfinance: GLD (gold), FXY (yen), FXF (franc)
    haven_returns = {}

    # 方案 1: Finnhub quote（快速）
    if finnhub_client:
        for ticker in ["GLD", "FXY", "FXF"]:
            try:
                q = finnhub_client.get_quote(ticker)
                if q and q["price"] and q["change_pct"] is not None:
                    haven_returns[ticker] = round(q["change_pct"], 2)
            except Exception as e:
                logger.debug("Finnhub %s 获取失败: %s", ticker, e)

    # 方案 2: Twelve Data（填补 Finnhub 缺失）
    if len(haven_returns) < 3 and twelvedata_client:
        for ticker in ["GLD", "FXY", "FXF"]:
            if ticker in haven_returns:
                continue
            try:
                series = twelvedata_client.get_time_series(ticker, interval="1day", outputsize=25)
                if series and len(series) >= 5:
                    ret = (series[-1]["close"] / series[0]["close"] - 1) * 100
                    haven_returns[ticker] = round(ret, 2)
            except Exception as e:
                logger.debug("TwelveData %s 获取失败: %s", ticker, e)

    # 方案 3: yfinance fallback
    if len(haven_returns) < 3:
        try:
            import yfinance as yf
            for ticker in ["GLD", "FXY", "FXF"]:
                if ticker in haven_returns:
                    continue
                df = yf.download(ticker, period="1mo", progress=False)
                if df is not None and len(df) >= 5:
                    close = df["Close"].values.flatten()
                    ret = (float(close[-1]) / float(close[0]) - 1) * 100
                    haven_returns[ticker] = round(ret, 2)
        except Exception as e:
            logger.warning("避险资产数据获取失败: %s", e)

    # FRED: GS10 (10yr yield direction)
    yield_falling = False
    gs10_change = None
    if fred_client:
        try:
            from datetime import datetime, timedelta
            start = (datetime.now() - timedelta(days=60)).strftime("%Y-%m-%d")
            series = fred_client.get_series("GS10", start=start)
            if series and len(series) >= 5:
                current = series[-1]["value"]
                prev = series[-5]["value"]
                gs10_change = round(current - prev, 3)
                yield_falling = current < prev
        except Exception as e:
            logger.warning("GS10 获取失败: %s", e)

    if not haven_returns:
        return _empty("避险资产数据不可用",
                      search_hint="GLD gold ETF price today, FXY yen ETF price, FXF franc ETF price")

    # Scoring: all havens rising + yields falling = high risk
    rising_count = sum(1 for r in haven_returns.values() if r > 0.5)
    avg_return = sum(haven_returns.values()) / len(haven_returns)

    base = 0
    if rising_count == 3:
        base = 70 + min(avg_return * 5, 20)
    elif rising_count == 2:
        base = 50 + min(avg_return * 3, 15)
    elif rising_count == 1:
        base = 30 + min(avg_return * 2, 10)
    else:
        base = 10 + max(avg_return * 2, 0)

    if yield_falling:
        base += 10

    score = max(0, min(100, round(base)))
    signal = "crisis" if score >= 60 else "elevated" if score >= 40 else "calm"

    # 标注数据来源
    sources = set()
    if finnhub_client:
        sources.add("Finnhub")
    if twelvedata_client:
        sources.add("TwelveData")
    sources.add("yfinance")

    return {
        "name": "避险资金流",
        "weight": 0.25,
        "score": score,
        "signal": signal,
        "data_available": True,
        "data": {
            "haven_returns": haven_returns,
            "rising_count": rising_count,
            "avg_return": round(avg_return, 2),
            "gs10_change": gs10_change,
            "yield_falling": yield_falling,
        },
        "reasoning": f"避险资产 {rising_count}/3 上涨，均值 {avg_return:+.2f}%，国债{'下行' if yield_falling else '上行'}",
    }


def _empty(reason, search_hint=""):
    return {
        "name": "避险资金流",
        "weight": 0.25,
        "score": 25,
        "signal": "calm",
        "data_available": False,
        "data": {},
        "reasoning": reason,
        "search_hint": search_hint,
    }
