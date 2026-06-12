"""加密货币贪恐指数 — 4 组件

1. Alternative.me 恐慌贪婪指数 (30%)
2. 资金费率 (25%)
3. BTC 主导率变化 (25%)
4. 价格动量 BTC 30d/90d (20%)
"""

import logging
from datetime import datetime

logger = logging.getLogger(__name__)

MARKET_NAME = "加密货币"


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


def _calc_alt_fear_greed():
    """组件 1: Alternative.me Fear & Greed Index (30%)"""
    name = "Alternative.me 贪恐指数"
    weight = 0.30

    try:
        import requests
        resp = requests.get("https://api.alternative.me/fng/?limit=1", timeout=10)
        data = resp.json()
        if "data" in data and len(data["data"]) > 0:
            score = int(data["data"][0]["value"])
            classification = data["data"][0].get("value_classification", "")

            signal = "greed" if score >= 60 else "fear" if score < 40 else "neutral"

            return {
                "name": name,
                "weight": weight,
                "score": round(max(0, min(100, score))),
                "signal": signal,
                "data_available": True,
                "data": {
                    "index": score,
                    "classification": classification,
                    "as_of": datetime.now().strftime("%Y-%m-%d"),
                },
                "reasoning": f"Alternative.me 指数={score} ({classification})",
            }
    except Exception as e:
        logger.debug("Alternative.me API 失败: %s", e)

    return _empty(name, weight, "Alternative.me API 不可用", "crypto fear and greed index today alternative.me")


def _calc_funding_rate():
    """组件 2: 资金费率 (25%)"""
    name = "资金费率"
    weight = 0.25

    # Binance 永续合约资金费率
    try:
        import requests
        resp = requests.get(
            "https://fapi.binance.com/fapi/v1/fundingRate",
            params={"symbol": "BTCUSDT", "limit": 1},
            timeout=10,
        )
        data = resp.json()
        if data and len(data) > 0:
            rate = float(data[0]["fundingRate"])
            rate_pct = rate * 100

            # 正费率高→多头过度→贪婪; 负费率→空头主导→恐惧
            if rate_pct > 0.1:
                score = 92
            elif rate_pct > 0.05:
                score = 78
            elif rate_pct > 0.01:
                score = 62
            elif rate_pct > -0.01:
                score = 48
            elif rate_pct > -0.05:
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
                    "btc_funding_rate_pct": round(rate_pct, 4),
                    "as_of": datetime.now().strftime("%Y-%m-%d"),
                },
                "reasoning": f"BTC 资金费率={rate_pct:+.4f}%，{'多头拥挤→贪婪' if rate_pct > 0.05 else '空头主导→恐惧' if rate_pct < -0.01 else '费率中性'}",
            }
    except Exception as e:
        logger.debug("Binance 资金费率失败: %s", e)

    # OKX fallback
    try:
        import requests
        resp = requests.get(
            "https://www.okx.com/api/v5/public/funding-rate",
            params={"instId": "BTC-USDT-SWAP"},
            timeout=10,
        )
        data = resp.json()
        if data.get("data"):
            rate = float(data["data"][0]["fundingRate"])
            rate_pct = rate * 100

            if rate_pct > 0.1:
                score = 92
            elif rate_pct > 0.05:
                score = 78
            elif rate_pct > 0.01:
                score = 62
            elif rate_pct > -0.01:
                score = 48
            elif rate_pct > -0.05:
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
                    "btc_funding_rate_pct": round(rate_pct, 4),
                    "source": "OKX",
                    "as_of": datetime.now().strftime("%Y-%m-%d"),
                },
                "reasoning": f"BTC 资金费率={rate_pct:+.4f}% (OKX)，{'多头拥挤→贪婪' if rate_pct > 0.05 else '空头主导→恐惧' if rate_pct < -0.01 else '费率中性'}",
            }
    except Exception as e:
        logger.debug("OKX 资金费率失败: %s", e)

    return _empty(name, weight, "资金费率数据不可用", "BTC funding rate perpetual swap today")


def _calc_btc_dominance():
    """组件 3: BTC 主导率变化 (25%)"""
    name = "BTC 主导率变化"
    weight = 0.25

    try:
        import yfinance as yf
        btc = yf.Ticker("BTC-USD").history(period="3mo")
        eth = yf.Ticker("ETH-USD").history(period="3mo")

        if btc is not None and eth is not None and len(btc) > 20 and len(eth) > 20:
            # BTC vs ETH 相对强弱近似主导率变化
            btc_ret = (float(btc["Close"].iloc[-1]) / float(btc["Close"].iloc[-20]) - 1) * 100
            eth_ret = (float(eth["Close"].iloc[-1]) / float(eth["Close"].iloc[-20]) - 1) * 100
            relative = btc_ret - eth_ret

            # BTC 主导率上升→避险情绪→恐惧; 下降→山寨币活跃→贪婪
            if relative < -15:
                score = 92  # ALT 暴涨→极贪
            elif relative < -5:
                score = 75
            elif relative < 5:
                score = 50
            elif relative < 15:
                score = 28
            else:
                score = 10  # BTC 独涨→极恐

            signal = "greed" if score >= 60 else "fear" if score < 40 else "neutral"

            return {
                "name": name,
                "weight": weight,
                "score": round(max(0, min(100, score))),
                "signal": signal,
                "data_available": True,
                "data": {
                    "btc_20d_ret": round(btc_ret, 2),
                    "eth_20d_ret": round(eth_ret, 2),
                    "btc_minus_eth": round(relative, 2),
                    "as_of": datetime.now().strftime("%Y-%m-%d"),
                },
                "reasoning": f"BTC 20日={btc_ret:+.1f}% vs ETH={eth_ret:+.1f}%，相对差={relative:+.1f}%{'→山寨币活跃→贪婪' if relative < -5 else '→BTC 独涨避险→恐惧' if relative > 5 else ''}",
            }
    except Exception as e:
        logger.debug("BTC 主导率计算失败: %s", e)

    return _empty(name, weight, "BTC 主导率数据不可用", "BTC dominance rate today crypto market cap")


def _calc_btc_momentum():
    """组件 4: BTC 价格动量 (20%)"""
    name = "BTC 价格动量"
    weight = 0.20

    try:
        import yfinance as yf
        hist = yf.Ticker("BTC-USD").history(period="6mo")

        if hist is not None and len(hist) >= 90:
            current = float(hist["Close"].iloc[-1])
            price_30d = float(hist["Close"].iloc[-22])  # ~30 trading days
            price_90d = float(hist["Close"].iloc[-66])  # ~90 trading days

            ret_30d = (current / price_30d - 1) * 100
            ret_90d = (current / price_90d - 1) * 100

            # 综合 30d 和 90d 动量
            momentum = ret_30d * 0.6 + ret_90d * 0.4

            if momentum > 30:
                score = 95
            elif momentum > 15:
                score = 80
            elif momentum > 5:
                score = 62
            elif momentum > -5:
                score = 48
            elif momentum > -15:
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
                    "btc_price": round(current, 2),
                    "return_30d_pct": round(ret_30d, 2),
                    "return_90d_pct": round(ret_90d, 2),
                    "momentum_score": round(momentum, 2),
                    "as_of": datetime.now().strftime("%Y-%m-%d"),
                },
                "reasoning": f"BTC=${current:,.0f}，30日={ret_30d:+.1f}%，90日={ret_90d:+.1f}%{'→强势上涨→贪婪' if momentum > 10 else '→持续下跌→恐惧' if momentum < -10 else ''}",
            }
    except Exception as e:
        logger.debug("BTC 动量计算失败: %s", e)

    return _empty(name, weight, "BTC 价格数据不可用", "BTC price today bitcoin 30 day 90 day return")


def calculate():
    """计算加密货币贪恐指数全部 4 组件"""
    components = [
        _calc_alt_fear_greed(),
        _calc_funding_rate(),
        _calc_btc_dominance(),
        _calc_btc_momentum(),
    ]
    return {"market": MARKET_NAME, "market_en": "Crypto", "components": components}
