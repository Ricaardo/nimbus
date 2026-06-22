"""A 股贪恐指数 — 5 组件（全部经 data-access facade，无直连数据源）

1. 融资余额变化 (25%)  — facade cn_margin (akshare 沪市两融)
2. 换手率 (20%)        — facade kline 510300.SS volume
3. 涨跌比 (20%)        — facade cn_breadth (akshare 市场活跃度)
4. 北向资金 (20%)      — facade cn_hsgt_flow (akshare)
5. 市场波动 (15%)      — facade kline 000300.SS
"""

import logging
import os
import sys
from datetime import datetime

logger = logging.getLogger(__name__)

MARKET_NAME = "A股"
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


def _annualized_vol(closes, window=20):
    rets = [closes[i] / closes[i - 1] - 1 for i in range(1, len(closes))][-window:]
    if len(rets) < 2:
        return None
    mean = sum(rets) / len(rets)
    std = (sum((r - mean) ** 2 for r in rets) / len(rets)) ** 0.5
    return std * (252 ** 0.5) * 100


def _calc_margin():
    """组件 1: 融资余额变化 (25%) — 沪市融资余额近 ~20 日变化 (akshare via facade)。"""
    name, weight = "融资余额变化", 0.25
    try:
        rows = _facade().cn_margin(limit=25) or []  # oldest->newest
        vals = [float(r["融资余额"]) for r in rows if r.get("融资余额") not in (None, "")]
        if len(vals) >= 5:
            recent, prev = vals[-1], vals[-min(20, len(vals))]
            if prev:
                change_pct = (recent / prev - 1) * 100
                score = 92 if change_pct > 10 else 78 if change_pct > 5 else 60 if change_pct > 0 else 38 if change_pct > -5 else 15
                return _result(name, weight, score,
                               {"margin_balance_yi": round(recent / 1e8, 2), "change_pct": round(change_pct, 2)},
                               f"融资余额 {recent/1e8:.0f}亿，近期变化{change_pct:+.2f}%{'→杠杆资金涌入→贪婪' if change_pct > 5 else '→杠杆资金撤离→恐惧' if change_pct < -3 else ''}")
    except Exception as e:  # noqa: BLE001
        logger.debug("融资余额解析失败: %s", e)
    return _empty(name, weight, "融资融券数据不可用", "A股 沪市 融资余额 最新数据 今日")


def _calc_turnover():
    """组件 2: 换手率 (20%) — 沪深300ETF 近5日/60日均量比。"""
    name, weight = "换手率", 0.20
    try:
        vols = _series("510300.SS", "volume")
        if len(vols) >= 20:
            vol_recent = sum(vols[-5:]) / 5
            vol_avg = sum(vols[-60:]) / len(vols[-60:])
            if vol_avg <= 0:
                return _empty(name, weight, "成交量基准为零")
            ratio = vol_recent / vol_avg
            score = 90 if ratio > 2.0 else 75 if ratio > 1.5 else 55 if ratio > 1.0 else 32 if ratio > 0.7 else 12
            return _result(name, weight, score,
                           {"recent_5d_vol": round(vol_recent), "avg_60d_vol": round(vol_avg), "ratio": round(ratio, 2)},
                           f"近5日/60日均量比={ratio:.2f}，{'放量→交易热情高→贪婪' if ratio > 1.3 else '缩量→交易冷淡→恐惧' if ratio < 0.8 else '成交量正常'}")
    except Exception as e:  # noqa: BLE001
        logger.debug("换手率计算失败: %s", e)
    return _empty(name, weight, "换手率数据不可用", "A股 沪深300 成交量 换手率 今日")


def _calc_advance_decline():
    """组件 3: 涨跌比 (20%) — 全市场涨跌家数 (akshare 市场活跃度 via facade)。"""
    name, weight = "涨跌比", 0.20
    try:
        kv = {str(r.get("item")): r.get("value") for r in (_facade().cn_breadth() or [])}
        up = float(kv.get("上涨") or 0)
        down = float(kv.get("下跌") or 0)
        total = up + down
        if total > 0:
            ratio = up / total * 100
            score = 92 if ratio > 75 else 75 if ratio > 60 else 50 if ratio > 45 else 28 if ratio > 30 else 8
            return _result(name, weight, score,
                           {"up_count": int(up), "down_count": int(down), "up_ratio_pct": round(ratio, 1)},
                           f"上涨{int(up)}家/下跌{int(down)}家，上涨占比{ratio:.1f}%{'→普涨格局→贪婪' if ratio > 60 else '→普跌格局→恐惧' if ratio < 40 else ''}")
    except Exception as e:  # noqa: BLE001
        logger.debug("涨跌比计算失败: %s", e)
    return _empty(name, weight, "A 股涨跌家数不可用", "A股 今日 涨跌家数 上涨 下跌")


def _calc_northbound():
    """组件 4: 北向资金 (20%) — 当日北向净流入概况 (akshare via facade)。"""
    name, weight = "北向资金", 0.20
    try:
        rows = [r for r in (_facade().cn_hsgt_flow() or []) if "北" in str(r.get("资金方向", ""))]
        if rows:
            net = sum(float(r.get("资金净流入") or 0) for r in rows)  # 亿元
            score = 90 if net > 40 else 72 if net > 12 else 50 if net > -12 else 30 if net > -40 else 10
            return _result(name, weight, score, {"net_today_yi": round(net, 2)},
                           f"当日北向净流入 {net:+.1f}亿，{'外资积极加仓→贪婪' if net > 12 else '外资净流出→恐惧' if net < -12 else '外资流向中性'}")
    except Exception as e:  # noqa: BLE001
        logger.debug("北向资金解析失败: %s", e)
    return _empty(name, weight, "北向资金数据不可用", "北向资金 今日 净流入 沪股通 深股通")


def _calc_volatility():
    """组件 5: 市场波动 (15%) — 沪深300 20日年化已实现波动率。低波动→贪婪。"""
    name, weight = "市场波动", 0.15
    try:
        closes = _series("000300.SS", "close")
        if len(closes) >= 21:
            vol_20d = _annualized_vol(closes, 20)
            vol_60d = _annualized_vol(closes, 60)
            score = 85 if vol_20d < 12 else 68 if vol_20d < 18 else 45 if vol_20d < 25 else 25 if vol_20d < 35 else 10
            return _result(name, weight, score,
                           {"vol_20d_annualized": round(vol_20d, 2), "vol_60d_annualized": round(vol_60d or 0, 2)},
                           f"沪深300 20日年化波动率={vol_20d:.1f}%，{'低波动→情绪平稳→贪婪' if vol_20d < 15 else '高波动→恐慌加剧→恐惧' if vol_20d > 25 else '波动适中'}")
    except Exception as e:  # noqa: BLE001
        logger.debug("A股波动率计算失败: %s", e)
    return _empty(name, weight, "A股波动率数据不可用", "沪深300 波动率 VIX 中国 iVIX 今日")


def calculate():
    """计算 A 股贪恐指数全部 5 组件"""
    return {"market": MARKET_NAME, "market_en": "A-Share",
            "components": [_calc_margin(), _calc_turnover(), _calc_advance_decline(),
                           _calc_northbound(), _calc_volatility()]}
