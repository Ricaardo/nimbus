"""港股贪恐指数 — 4 组件（全部经 data-access facade，无直连数据源）

1. VHSI 恒指波动率 (30%)   — facade kline ^HSI
2. 南向资金 (25%)          — facade cn_hsgt_flow (akshare)
3. 成交额变化 (25%)        — facade kline ^HSI volume
4. AH 溢价指数 (20%)       — facade kline ^HSAHP
"""

import logging
import os
import sys
from datetime import datetime

logger = logging.getLogger(__name__)

MARKET_NAME = "港股"
_data = None


def _facade():
    """Lazily import the data-access facade SDK (the single read path)."""
    global _data
    if _data is None:
        pkg = os.environ.get("DATA_ACCESS_PKG", os.path.expanduser("~/nimbus-os/services/data-access"))
        if pkg not in sys.path:
            sys.path.insert(0, pkg)
        import data_access as data  # noqa: PLC0415
        _data = data
    return _data


def _series(symbol, field, limit=70):
    """Chronological (oldest->newest) list of `field` from facade kline."""
    bars = sorted(_facade().kline(symbol, limit=limit) or [], key=lambda b: b.get("trade_date") or "")
    return [float(b[field]) for b in bars if b.get(field) is not None]


def _empty(name, weight, reason, search_hint=""):
    return {"name": name, "weight": weight, "score": 50, "signal": "neutral",
            "data_available": False, "data": {}, "reasoning": reason, "search_hint": search_hint}


def _result(name, weight, score, data, reasoning):
    score = round(max(0, min(100, score)))
    signal = "greed" if score >= 60 else "fear" if score < 40 else "neutral"
    return {"name": name, "weight": weight, "score": score, "signal": signal,
            "data_available": True, "data": {**data, "as_of": datetime.now().strftime("%Y-%m-%d")},
            "reasoning": reasoning}


def _calc_vhsi():
    """组件 1: VHSI 恒指波动率 (30%) — 恒指 20 日年化已实现波动率。"""
    name, weight = "VHSI 恒指波动率", 0.30
    try:
        closes = _series("^HSI", "close")
        if len(closes) >= 21:
            rets = [closes[i] / closes[i - 1] - 1 for i in range(1, len(closes))][-20:]
            mean = sum(rets) / len(rets)
            std = (sum((r - mean) ** 2 for r in rets) / len(rets)) ** 0.5
            vol_20d = std * (252 ** 0.5) * 100
            score = 85 if vol_20d < 15 else 68 if vol_20d < 20 else 45 if vol_20d < 28 else 25 if vol_20d < 38 else 8
            return _result(name, weight, score, {"hsi_vol_20d": round(vol_20d, 2)},
                           f"恒指 20日年化波动率={vol_20d:.1f}%，{'低波动→贪婪' if vol_20d < 18 else '高波动→恐惧' if vol_20d > 28 else '波动中性'}")
    except Exception as e:  # noqa: BLE001
        logger.debug("VHSI 计算失败: %s", e)
    return _empty(name, weight, "VHSI 数据不可用", "VHSI Hong Kong volatility index today HSI")


def _calc_southbound():
    """组件 2: 南向资金 (25%) — 当日南向净流入概况 (akshare via facade)。"""
    name, weight = "南向资金", 0.25
    try:
        rows = [r for r in (_facade().cn_hsgt_flow() or []) if "南" in str(r.get("资金方向", ""))]
        if rows:
            net = sum(float(r.get("资金净流入") or 0) for r in rows)  # 亿元
            score = 88 if net > 50 else 70 if net > 15 else 50 if net > -15 else 30 if net > -50 else 12
            return _result(name, weight, score, {"net_today_yi": round(net, 2)},
                           f"当日南向净流入 {net:+.1f}亿，{'内资积极→贪婪' if net > 15 else '内资撤出→恐惧' if net < -15 else '资金流中性'}")
    except Exception as e:  # noqa: BLE001
        logger.debug("南向资金解析失败: %s", e)
    return _empty(name, weight, "南向资金数据不可用", "南向资金 港股通 今日 净流入 最新")


def _calc_volume():
    """组件 3: 成交额变化 (25%) — 恒指近5日/60日均量比。"""
    name, weight = "成交额变化", 0.25
    try:
        vols = _series("^HSI", "volume")
        if len(vols) >= 20:
            vol_recent = sum(vols[-5:]) / 5
            vol_avg = sum(vols[-60:]) / len(vols[-60:])
            if vol_avg <= 0:
                return _empty(name, weight, "成交量基准为零")
            ratio = vol_recent / vol_avg
            score = 88 if ratio > 1.8 else 72 if ratio > 1.3 else 52 if ratio > 0.9 else 30 if ratio > 0.6 else 12
            return _result(name, weight, score, {"vol_ratio": round(ratio, 2)},
                           f"恒指近5日/60日均量比={ratio:.2f}，{'放量→贪婪' if ratio > 1.3 else '缩量→恐惧' if ratio < 0.7 else '成交中性'}")
    except Exception as e:  # noqa: BLE001
        logger.debug("港股成交量计算失败: %s", e)
    return _empty(name, weight, "港股成交量数据不可用", "港股 主板成交额 今日 恒指成交量")


def _calc_ah_premium():
    """组件 4: AH 溢价指数 (20%) — 恒生 AH 溢价指数 ^HSAHP。溢价高→港股折价→恐惧。"""
    name, weight = "AH 溢价指数", 0.20
    try:
        closes = _series("^HSAHP", "close")
        if closes:
            current = closes[-1]
            avg_60d = sum(closes[-60:]) / len(closes[-60:])
            score = 18 if current > 145 else 35 if current > 130 else 50 if current > 115 else 68 if current > 100 else 85
            return _result(name, weight, score, {"ah_premium_index": round(current, 2), "avg_60d": round(avg_60d, 2)},
                           f"AH 溢价指数={current:.1f}，{'港股深度折价→市场恐惧' if current > 135 else '溢价收窄→港股情绪改善→贪婪' if current < 110 else 'AH 溢价正常'}")
    except Exception as e:  # noqa: BLE001
        logger.debug("AH 溢价计算失败: %s", e)
    return _empty(name, weight, "AH 溢价数据不可用", "AH 溢价指数 恒生AH溢价 今日 HSAHP")


def calculate():
    """计算港股贪恐指数全部 4 组件"""
    return {"market": MARKET_NAME, "market_en": "HK",
            "components": [_calc_vhsi(), _calc_southbound(), _calc_volume(), _calc_ah_premium()]}
