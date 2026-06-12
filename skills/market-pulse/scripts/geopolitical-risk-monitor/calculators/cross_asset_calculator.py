"""组件 5: 跨资产确认 (权重 15%) — SPY, EFA, EEM
Fallback 链: Finnhub → Twelve Data → yfinance → [SEARCH_NEEDED]
"""

import logging

logger = logging.getLogger(__name__)


def calculate(finnhub_client=None, twelvedata_client=None, lookback_days=30):
    returns = {}

    # 方案 1: Finnhub quote（日涨跌近似）
    if finnhub_client:
        for ticker in ["SPY", "EFA", "EEM"]:
            try:
                q = finnhub_client.get_quote(ticker)
                if q and q["price"] and q["change_pct"] is not None:
                    returns[ticker] = round(q["change_pct"], 2)
            except Exception as e:
                logger.debug("Finnhub %s 获取失败: %s", ticker, e)

    # 方案 2: Twelve Data（填补缺失，月度收益率）
    if len(returns) < 3 and twelvedata_client:
        for ticker in ["SPY", "EFA", "EEM"]:
            if ticker in returns:
                continue
            try:
                series = twelvedata_client.get_time_series(ticker, interval="1day", outputsize=25)
                if series and len(series) >= 10:
                    ret = (series[-1]["close"] / series[0]["close"] - 1) * 100
                    returns[ticker] = round(ret, 2)
            except Exception as e:
                logger.debug("TwelveData %s 获取失败: %s", ticker, e)

    # 方案 3: yfinance fallback
    if len(returns) < 2:
        try:
            import yfinance as yf
            for ticker in ["SPY", "EFA", "EEM"]:
                if ticker in returns:
                    continue
                df = yf.download(ticker, period="1mo", progress=False)
                if df is not None and len(df) >= 10:
                    close = df["Close"].values.flatten()
                    ret = (float(close[-1]) / float(close[0]) - 1) * 100
                    returns[ticker] = round(ret, 2)
        except Exception as e:
            logger.error("跨资产数据获取失败: %s", e)

    if len(returns) < 2:
        return _empty("跨资产数据不足",
                      search_hint="SPY S&P500 ETF price today, EEM emerging markets ETF price, EFA developed markets ETF")

    spy_ret = returns.get("SPY", 0)
    efa_ret = returns.get("EFA", 0)
    eem_ret = returns.get("EEM", 0)

    # EM vs DM divergence: EM underperforming = regional risk
    em_dm_gap = eem_ret - spy_ret  # Negative = EM underperforming

    if em_dm_gap < -5:
        score = 80  # Large EM underperformance
    elif em_dm_gap < -3:
        score = 60
    elif em_dm_gap < -1:
        score = 40
    elif em_dm_gap < 1:
        score = 25
    else:
        score = 10  # EM outperforming = risk-on

    # Additional: if all markets falling together = systematic risk
    all_negative = all(r < -2 for r in returns.values() if r is not None)
    if all_negative:
        score = min(score + 20, 100)

    signal = "crisis" if score >= 60 else "elevated" if score >= 40 else "calm"

    return {
        "name": "跨资产确认",
        "weight": 0.15,
        "score": score,
        "signal": signal,
        "data_available": True,
        "data": {
            "returns": returns,
            "em_dm_gap": round(em_dm_gap, 2),
            "all_negative": all_negative,
        },
        "reasoning": f"SPY {spy_ret:+.1f}%, EEM {eem_ret:+.1f}%, EM-DM 差 {em_dm_gap:+.1f}%",
    }


def _empty(reason, search_hint=""):
    return {
        "name": "跨资产确认",
        "weight": 0.15,
        "score": 25,
        "signal": "calm",
        "data_available": False,
        "data": {},
        "reasoning": reason,
        "search_hint": search_hint,
    }
