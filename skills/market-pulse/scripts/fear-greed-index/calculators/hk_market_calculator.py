"""港股贪恐指数 — 4 组件

1. VHSI 恒指波动率 (30%)
2. 南向资金 (25%)
3. 成交额变化 (25%)
4. AH 溢价指数 (20%)
"""

import logging
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

MARKET_NAME = "港股"


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


def _try_akshare(func_name, *args, **kwargs):
    try:
        import akshare as ak
        return getattr(ak, func_name)(*args, **kwargs)
    except Exception as e:
        logger.debug("AKShare %s 失败: %s", func_name, e)
        return None


def _calc_vhsi():
    """组件 1: VHSI 恒指波动率 (30%)"""
    name = "VHSI 恒指波动率"
    weight = 0.30

    # VHSI 通过 yfinance 尝试
    try:
        import yfinance as yf
        hist = yf.Ticker("^HSI").history(period="3mo")
        if hist is not None and not hist.empty and len(hist) >= 20:
            returns = hist["Close"].pct_change().dropna()
            vol_20d = float(returns.iloc[-20:].std() * (252 ** 0.5) * 100)

            if vol_20d < 15:
                score = 85
            elif vol_20d < 20:
                score = 68
            elif vol_20d < 28:
                score = 45
            elif vol_20d < 38:
                score = 25
            else:
                score = 8

            signal = "greed" if score >= 60 else "fear" if score < 40 else "neutral"

            return {
                "name": name,
                "weight": weight,
                "score": round(max(0, min(100, score))),
                "signal": signal,
                "data_available": True,
                "data": {
                    "hsi_vol_20d": round(vol_20d, 2),
                    "as_of": datetime.now().strftime("%Y-%m-%d"),
                },
                "reasoning": f"恒指 20日年化波动率={vol_20d:.1f}%，{'低波动→贪婪' if vol_20d < 18 else '高波动→恐惧' if vol_20d > 28 else '波动中性'}",
            }
    except Exception as e:
        logger.debug("VHSI 计算失败: %s", e)

    return _empty(name, weight, "VHSI 数据不可用", "VHSI Hong Kong volatility index today HSI")


def _calc_southbound():
    """组件 2: 南向资金 (25%)"""
    name = "南向资金"
    weight = 0.25

    df = _try_akshare("stock_hsgt_south_net_flow_in_em")
    if df is None or df.empty:
        return _empty(name, weight, "南向资金数据不可用", "南向资金 港股通 今日 净流入 最新")

    try:
        df = df.sort_values(by=df.columns[0])
        val_col = [c for c in df.columns if "净流入" in str(c) or "净买入" in str(c)]
        if not val_col:
            val_col = [df.columns[1]]

        recent_5d = df[val_col[0]].iloc[-5:].astype(float).sum()
        net_5d = recent_5d / 1e4 if abs(recent_5d) > 1e6 else recent_5d

        if net_5d > 80:
            score = 88
        elif net_5d > 20:
            score = 70
        elif net_5d > -20:
            score = 50
        elif net_5d > -80:
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
            "data": {"net_5d_yi": round(net_5d, 2), "as_of": datetime.now().strftime("%Y-%m-%d")},
            "reasoning": f"近5日南向净流入 {net_5d:+.1f}亿，{'内资积极→贪婪' if net_5d > 20 else '内资撤出→恐惧' if net_5d < -20 else '资金流中性'}",
        }
    except Exception as e:
        logger.debug("南向资金解析失败: %s", e)
        return _empty(name, weight, f"南向资金异常: {e}", "南向资金 港股通 今日 净流入")


def _calc_volume():
    """组件 3: 成交额变化 (25%)"""
    name = "成交额变化"
    weight = 0.25

    try:
        import yfinance as yf
        hist = yf.Ticker("^HSI").history(period="3mo")
        if hist is None or hist.empty or len(hist) < 20:
            raise ValueError("恒指数据不足")

        vol_recent = float(hist["Volume"].iloc[-5:].mean())
        vol_avg = float(hist["Volume"].iloc[-60:].mean())

        if vol_avg == 0:
            return _empty(name, weight, "成交量基准为零")

        ratio = vol_recent / vol_avg

        if ratio > 1.8:
            score = 88
        elif ratio > 1.3:
            score = 72
        elif ratio > 0.9:
            score = 52
        elif ratio > 0.6:
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
                "vol_ratio": round(ratio, 2),
                "as_of": datetime.now().strftime("%Y-%m-%d"),
            },
            "reasoning": f"恒指近5日/60日均量比={ratio:.2f}，{'放量→贪婪' if ratio > 1.3 else '缩量→恐惧' if ratio < 0.7 else '成交中性'}",
        }
    except Exception as e:
        logger.debug("港股成交量计算失败: %s", e)
        return _empty(name, weight, f"港股成交量异常: {e}", "港股 主板成交额 今日 恒指成交量")


def _calc_ah_premium():
    """组件 4: AH 溢价指数 (20%)"""
    name = "AH 溢价指数"
    weight = 0.20

    df = _try_akshare("stock_a_ah_tx")
    if df is None or df.empty:
        # 尝试恒生 AH 溢价指数
        try:
            import yfinance as yf
            hist = yf.Ticker("^HSAHP").history(period="3mo")
            if hist is not None and not hist.empty:
                current = float(hist["Close"].iloc[-1])
                avg_60d = float(hist["Close"].iloc[-60:].mean()) if len(hist) >= 60 else current

                # AH 溢价高→A 股相对贪婪 / 港股相对恐惧
                # 从港股贪恐视角：溢价越高→港股越被低估→港股恐惧
                if current > 145:
                    score = 18  # 溢价极高→港股极度被低估→市场恐惧
                elif current > 130:
                    score = 35
                elif current > 115:
                    score = 50
                elif current > 100:
                    score = 68
                else:
                    score = 85

                signal = "greed" if score >= 60 else "fear" if score < 40 else "neutral"

                return {
                    "name": name,
                    "weight": weight,
                    "score": round(max(0, min(100, score))),
                    "signal": signal,
                    "data_available": True,
                    "data": {
                        "ah_premium_index": round(current, 2),
                        "avg_60d": round(avg_60d, 2),
                        "as_of": datetime.now().strftime("%Y-%m-%d"),
                    },
                    "reasoning": f"AH 溢价指数={current:.1f}，{'港股深度折价→市场恐惧' if current > 135 else '溢价收窄→港股情绪改善→贪婪' if current < 110 else 'AH 溢价正常'}",
                }
        except Exception:
            pass

        return _empty(name, weight, "AH 溢价数据不可用", "AH 溢价指数 恒生AH溢价 今日 HSAHP")

    # AKShare 路径
    try:
        return _empty(name, weight, "AH 溢价 AKShare 解析中", "AH 溢价指数 今日")
    except Exception as e:
        return _empty(name, weight, f"AH 溢价异常: {e}", "AH 溢价指数 今日")


def calculate():
    """计算港股贪恐指数全部 4 组件"""
    components = [
        _calc_vhsi(),
        _calc_southbound(),
        _calc_volume(),
        _calc_ah_premium(),
    ]
    return {"market": MARKET_NAME, "market_en": "HK", "components": components}
