"""美股贪恐指数 — 7 组件

1. VIX 波动率 (20%)
2. Put/Call Ratio (15%)
3. 市场广度 RSP/SPY (15%)
4. 价格动量 SPY vs 125MA (15%)
5. 避险需求 TLT/SPY (10%)
6. 垃圾债需求 HYG/LQD (10%)
7. VIX 期限结构 VIX/VIX3M (15%)
"""

import logging
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

MARKET_NAME = "美股"


def _empty(name, weight, reason, search_hint=""):
    return {
        "name": name,
        "weight": weight,
        "score": 50,
        "signal": "neutral",
        "data_available": False,
        "data": {},
        "reasoning": reason,
        "search_hint": search_hint,
    }


def _get_yf_data(ticker, period="3mo"):
    """yfinance 获取历史数据"""
    try:
        import yfinance as yf
        t = yf.Ticker(ticker)
        hist = t.history(period=period)
        if hist.empty:
            return None
        return hist
    except Exception as e:
        logger.debug("yfinance %s 失败: %s", ticker, e)
        return None


def _calc_vix(finnhub_client=None, twelvedata_client=None):
    """组件 1: VIX 波动率 (20%)"""
    name = "VIX 波动率"
    weight = 0.20

    vix = None

    # yfinance
    hist = _get_yf_data("^VIX", "1mo")
    if hist is not None and len(hist) > 0:
        vix = float(hist["Close"].iloc[-1])

    if vix is None:
        return _empty(name, weight, "VIX 数据不可用", "CBOE VIX index current level today")

    # VIX 越低→越贪婪 (score 越高)
    if vix < 12:
        score = 95
    elif vix < 15:
        score = 75
    elif vix < 20:
        score = 55
    elif vix < 25:
        score = 35
    elif vix < 30:
        score = 20
    else:
        score = max(5, 15 - (vix - 30))

    signal = "greed" if score >= 60 else "fear" if score < 40 else "neutral"

    return {
        "name": name,
        "weight": weight,
        "score": round(max(0, min(100, score))),
        "signal": signal,
        "data_available": True,
        "data": {"vix": round(vix, 2), "as_of": datetime.now().strftime("%Y-%m-%d")},
        "reasoning": f"VIX={vix:.2f}，{'恐慌情绪升温' if vix > 25 else '市场情绪稳定' if vix < 18 else '警惕情绪'}",
    }


def _calc_put_call(fred_client=None):
    """组件 2: Put/Call Ratio (15%)"""
    name = "Put/Call Ratio"
    weight = 0.15

    pc_ratio = None

    # FRED PCERATIO (CBOE equity put/call)
    if fred_client:
        try:
            start = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")
            series = fred_client.get_series("PCERATIO", start=start)
            if series:
                pc_ratio = series[-1]["value"]
        except Exception as e:
            logger.debug("FRED PCERATIO 失败: %s", e)

    if pc_ratio is None:
        return _empty(name, weight, "Put/Call 数据不可用", "CBOE equity put call ratio today")

    # P/C 越低→越贪婪（大量看涨期权）
    if pc_ratio < 0.60:
        score = 90
    elif pc_ratio < 0.70:
        score = 75
    elif pc_ratio < 0.85:
        score = 50
    elif pc_ratio < 1.0:
        score = 30
    else:
        score = max(5, 20 - (pc_ratio - 1.0) * 30)

    signal = "greed" if score >= 60 else "fear" if score < 40 else "neutral"

    return {
        "name": name,
        "weight": weight,
        "score": round(max(0, min(100, score))),
        "signal": signal,
        "data_available": True,
        "data": {"put_call_ratio": round(pc_ratio, 3), "as_of": datetime.now().strftime("%Y-%m-%d")},
        "reasoning": f"P/C={pc_ratio:.3f}，{'看涨期权过度→贪婪' if pc_ratio < 0.65 else '看跌保护需求高→恐惧' if pc_ratio > 0.9 else '期权市场中性'}",
    }


def _calc_breadth():
    """组件 3: 市场广度 RSP/SPY (15%)"""
    name = "市场广度"
    weight = 0.15

    rsp = _get_yf_data("RSP", "3mo")
    spy = _get_yf_data("SPY", "3mo")

    if rsp is None or spy is None or len(rsp) < 20 or len(spy) < 20:
        return _empty(name, weight, "RSP/SPY 数据不足", "RSP SPY relative performance 1 month")

    # RSP (等权) vs SPY (市值权) 20 日相对表现
    rsp_ret_20d = (float(rsp["Close"].iloc[-1]) / float(rsp["Close"].iloc[-20]) - 1) * 100
    spy_ret_20d = (float(spy["Close"].iloc[-1]) / float(spy["Close"].iloc[-20]) - 1) * 100
    relative = rsp_ret_20d - spy_ret_20d  # 正=广度好, 负=集中度高

    # 相对表现 → 评分
    if relative > 3:
        score = 90
    elif relative > 1:
        score = 70
    elif relative > -1:
        score = 50
    elif relative > -3:
        score = 30
    else:
        score = 10

    signal = "greed" if score >= 60 else "fear" if score < 40 else "neutral"

    return {
        "name": name,
        "weight": weight,
        "score": round(max(0, min(100, score))),
        "signal": signal,
        "data_available": True,
        "data": {
            "rsp_return_20d": round(rsp_ret_20d, 2),
            "spy_return_20d": round(spy_ret_20d, 2),
            "relative_pct": round(relative, 2),
            "as_of": datetime.now().strftime("%Y-%m-%d"),
        },
        "reasoning": f"RSP 20日={rsp_ret_20d:+.2f}% vs SPY={spy_ret_20d:+.2f}%，相对={relative:+.2f}%{'，广度健康→贪婪' if relative > 1 else '，集中度过高→恐惧' if relative < -1 else ''}",
    }


def _calc_momentum():
    """组件 4: 价格动量 SPY vs 125MA (15%)"""
    name = "价格动量"
    weight = 0.15

    spy = _get_yf_data("SPY", "1y")
    if spy is None or len(spy) < 125:
        return _empty(name, weight, "SPY 历史数据不足", "S&P 500 current price vs 125 day moving average")

    current = float(spy["Close"].iloc[-1])
    ma125 = float(spy["Close"].iloc[-125:].mean())
    pct_above = (current / ma125 - 1) * 100

    # 偏离 125MA 程度
    if pct_above > 10:
        score = 95
    elif pct_above > 5:
        score = 78
    elif pct_above > 0:
        score = 58
    elif pct_above > -5:
        score = 35
    elif pct_above > -10:
        score = 18
    else:
        score = 5

    signal = "greed" if score >= 60 else "fear" if score < 40 else "neutral"

    return {
        "name": name,
        "weight": weight,
        "score": round(max(0, min(100, score))),
        "signal": signal,
        "data_available": True,
        "data": {
            "spy_price": round(current, 2),
            "ma125": round(ma125, 2),
            "pct_above_ma125": round(pct_above, 2),
            "as_of": datetime.now().strftime("%Y-%m-%d"),
        },
        "reasoning": f"SPY={current:.2f}，125MA={ma125:.2f}，偏离{pct_above:+.2f}%{'→强势上涨' if pct_above > 5 else '→趋势疲弱' if pct_above < 0 else ''}",
    }


def _calc_safe_haven():
    """组件 5: 避险需求 TLT/SPY (10%)"""
    name = "避险需求"
    weight = 0.10

    tlt = _get_yf_data("TLT", "3mo")
    spy = _get_yf_data("SPY", "3mo")

    if tlt is None or spy is None or len(tlt) < 20 or len(spy) < 20:
        return _empty(name, weight, "TLT/SPY 数据不足", "TLT vs SPY relative performance 20 days")

    tlt_ret = (float(tlt["Close"].iloc[-1]) / float(tlt["Close"].iloc[-20]) - 1) * 100
    spy_ret = (float(spy["Close"].iloc[-1]) / float(spy["Close"].iloc[-20]) - 1) * 100
    relative = spy_ret - tlt_ret  # 正=SPY跑赢→贪婪

    if relative > 5:
        score = 90
    elif relative > 2:
        score = 72
    elif relative > -2:
        score = 50
    elif relative > -5:
        score = 28
    else:
        score = 10

    signal = "greed" if score >= 60 else "fear" if score < 40 else "neutral"

    return {
        "name": name,
        "weight": weight,
        "score": round(max(0, min(100, score))),
        "signal": signal,
        "data_available": True,
        "data": {
            "tlt_return_20d": round(tlt_ret, 2),
            "spy_return_20d": round(spy_ret, 2),
            "relative_pct": round(relative, 2),
            "as_of": datetime.now().strftime("%Y-%m-%d"),
        },
        "reasoning": f"SPY 20日={spy_ret:+.2f}% vs TLT={tlt_ret:+.2f}%，{'资金流向风险资产→贪婪' if relative > 2 else '避险需求上升→恐惧' if relative < -2 else '避险中性'}",
    }


def _calc_junk_bond():
    """组件 6: 垃圾债需求 HYG/LQD (10%)"""
    name = "垃圾债需求"
    weight = 0.10

    hyg = _get_yf_data("HYG", "3mo")
    lqd = _get_yf_data("LQD", "3mo")

    if hyg is None or lqd is None or len(hyg) < 20 or len(lqd) < 20:
        return _empty(name, weight, "HYG/LQD 数据不足", "HYG vs LQD relative performance junk bond demand")

    hyg_ret = (float(hyg["Close"].iloc[-1]) / float(hyg["Close"].iloc[-20]) - 1) * 100
    lqd_ret = (float(lqd["Close"].iloc[-1]) / float(lqd["Close"].iloc[-20]) - 1) * 100
    relative = hyg_ret - lqd_ret  # 正=HYG跑赢→风险偏好→贪婪

    if relative > 2:
        score = 88
    elif relative > 0.5:
        score = 70
    elif relative > -0.5:
        score = 50
    elif relative > -2:
        score = 30
    else:
        score = 12

    signal = "greed" if score >= 60 else "fear" if score < 40 else "neutral"

    return {
        "name": name,
        "weight": weight,
        "score": round(max(0, min(100, score))),
        "signal": signal,
        "data_available": True,
        "data": {
            "hyg_return_20d": round(hyg_ret, 2),
            "lqd_return_20d": round(lqd_ret, 2),
            "relative_pct": round(relative, 2),
            "as_of": datetime.now().strftime("%Y-%m-%d"),
        },
        "reasoning": f"HYG 20日={hyg_ret:+.2f}% vs LQD={lqd_ret:+.2f}%，{'高收益债受追捧→风险偏好→贪婪' if relative > 0.5 else '避开垃圾债→信用恐慌→恐惧' if relative < -0.5 else '信用市场中性'}",
    }


def _calc_vix_term():
    """组件 7: VIX 期限结构 VIX/VIX3M (15%)"""
    name = "VIX 期限结构"
    weight = 0.15

    vix = _get_yf_data("^VIX", "1mo")
    vix3m = _get_yf_data("^VIX3M", "1mo")

    if vix is None or vix3m is None or len(vix) == 0 or len(vix3m) == 0:
        return _empty(name, weight, "VIX/VIX3M 数据不可用", "VIX VIX3M term structure contango backwardation")

    vix_val = float(vix["Close"].iloc[-1])
    vix3m_val = float(vix3m["Close"].iloc[-1])

    if vix3m_val == 0:
        return _empty(name, weight, "VIX3M 为零")

    ratio = vix_val / vix3m_val

    # ratio < 1 = contango (正常/贪婪), ratio > 1 = backwardation (恐慌)
    if ratio < 0.80:
        score = 92  # 深度 contango → 极贪
    elif ratio < 0.90:
        score = 75
    elif ratio < 1.0:
        score = 58
    elif ratio < 1.10:
        score = 32
    else:
        score = 10  # 深度 backwardation → 极恐

    signal = "greed" if score >= 60 else "fear" if score < 40 else "neutral"

    return {
        "name": name,
        "weight": weight,
        "score": round(max(0, min(100, score))),
        "signal": signal,
        "data_available": True,
        "data": {
            "vix": round(vix_val, 2),
            "vix3m": round(vix3m_val, 2),
            "ratio": round(ratio, 3),
            "structure": "contango" if ratio < 1 else "backwardation",
            "as_of": datetime.now().strftime("%Y-%m-%d"),
        },
        "reasoning": f"VIX/VIX3M={ratio:.3f}，{'Contango（正常期限结构）→贪婪' if ratio < 1 else 'Backwardation（恐慌结构）→恐惧'}",
    }


def calculate(fred_client=None, finnhub_client=None, twelvedata_client=None):
    """计算美股贪恐指数全部 7 组件"""
    components = [
        _calc_vix(finnhub_client, twelvedata_client),
        _calc_put_call(fred_client),
        _calc_breadth(),
        _calc_momentum(),
        _calc_safe_haven(),
        _calc_junk_bond(),
        _calc_vix_term(),
    ]
    return {"market": MARKET_NAME, "market_en": "US", "components": components}
