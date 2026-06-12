"""A 股贪恐指数 — 5 组件

1. 融资余额变化 (25%)
2. 换手率 (20%)
3. 涨跌比 (20%)
4. 北向资金 (20%)
5. 市场波动 (15%)
"""

import logging
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

MARKET_NAME = "A股"


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
    """安全调用 AKShare"""
    try:
        import akshare as ak
        func = getattr(ak, func_name)
        return func(*args, **kwargs)
    except Exception as e:
        logger.debug("AKShare %s 失败: %s", func_name, e)
        return None


def _calc_margin():
    """组件 1: 融资余额变化 (25%)"""
    name = "融资余额变化"
    weight = 0.25

    df = _try_akshare("stock_margin_sse", start_date=(datetime.now() - timedelta(days=60)).strftime("%Y%m%d"))
    if df is None or df.empty:
        return _empty(name, weight, "融资融券数据不可用", "A股 沪市 融资余额 最新数据 今日")

    try:
        # 取最近和 20 天前的融资余额
        df = df.sort_values(by=df.columns[0])
        col_rzye = [c for c in df.columns if "融资余额" in str(c)]
        if not col_rzye:
            col_rzye = [df.columns[1]]

        recent = float(df[col_rzye[0]].iloc[-1])
        prev = float(df[col_rzye[0]].iloc[-min(20, len(df))]) if len(df) > 5 else recent

        if prev == 0:
            return _empty(name, weight, "融资余额基准为零")

        change_pct = (recent / prev - 1) * 100

        if change_pct > 10:
            score = 92
        elif change_pct > 5:
            score = 78
        elif change_pct > 0:
            score = 60
        elif change_pct > -5:
            score = 38
        else:
            score = 15

        signal = "greed" if score >= 60 else "fear" if score < 40 else "neutral"

        return {
            "name": name,
            "weight": weight,
            "score": round(max(0, min(100, score))),
            "signal": signal,
            "data_available": True,
            "data": {
                "margin_balance_yi": round(recent / 1e8, 2),
                "change_pct": round(change_pct, 2),
                "as_of": datetime.now().strftime("%Y-%m-%d"),
            },
            "reasoning": f"融资余额 {recent/1e8:.0f}亿，近期变化{change_pct:+.2f}%{'→杠杆资金涌入→贪婪' if change_pct > 5 else '→杠杆资金撤离→恐惧' if change_pct < -3 else ''}",
        }
    except Exception as e:
        logger.debug("融资余额解析失败: %s", e)
        return _empty(name, weight, f"融资余额解析异常: {e}", "A股 融资余额 最新数据")


def _calc_turnover():
    """组件 2: 换手率 (20%)"""
    name = "换手率"
    weight = 0.20

    # 用成交额/流通市值近似换手率
    try:
        import yfinance as yf
        # 沪深 300 ETF 近似
        hist = yf.Ticker("510300.SS").history(period="3mo")
        if hist is None or hist.empty or len(hist) < 20:
            raise ValueError("510300 数据不足")

        vol_recent = float(hist["Volume"].iloc[-5:].mean())
        vol_avg = float(hist["Volume"].iloc[-60:].mean())

        if vol_avg == 0:
            return _empty(name, weight, "成交量基准为零")

        ratio = vol_recent / vol_avg

        if ratio > 2.0:
            score = 90
        elif ratio > 1.5:
            score = 75
        elif ratio > 1.0:
            score = 55
        elif ratio > 0.7:
            score = 32
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
                "recent_5d_vol": round(vol_recent),
                "avg_60d_vol": round(vol_avg),
                "ratio": round(ratio, 2),
                "as_of": datetime.now().strftime("%Y-%m-%d"),
            },
            "reasoning": f"近5日/60日均量比={ratio:.2f}，{'放量→交易热情高→贪婪' if ratio > 1.3 else '缩量→交易冷淡→恐惧' if ratio < 0.8 else '成交量正常'}",
        }
    except Exception as e:
        logger.debug("换手率计算失败: %s", e)
        return _empty(name, weight, f"换手率数据异常: {e}", "A股 沪深300 成交量 换手率 今日")


def _calc_advance_decline():
    """组件 3: 涨跌比 (20%)"""
    name = "涨跌比"
    weight = 0.20

    df = _try_akshare("stock_zh_a_spot_em")
    if df is None or df.empty:
        return _empty(name, weight, "A 股行情数据不可用", "A股 今日 涨跌家数 上涨 下跌")

    try:
        pct_col = [c for c in df.columns if "涨跌幅" in str(c)]
        if not pct_col:
            return _empty(name, weight, "涨跌幅列缺失", "A股 今日 涨跌家数")

        pct = df[pct_col[0]].astype(float)
        up = int((pct > 0).sum())
        down = int((pct < 0).sum())
        total = up + down

        if total == 0:
            return _empty(name, weight, "无有效涨跌数据")

        ratio = up / total * 100

        if ratio > 75:
            score = 92
        elif ratio > 60:
            score = 75
        elif ratio > 45:
            score = 50
        elif ratio > 30:
            score = 28
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
                "up_count": up,
                "down_count": down,
                "up_ratio_pct": round(ratio, 1),
                "as_of": datetime.now().strftime("%Y-%m-%d"),
            },
            "reasoning": f"上涨{up}家/下跌{down}家，上涨占比{ratio:.1f}%{'→普涨格局→贪婪' if ratio > 60 else '→普跌格局→恐惧' if ratio < 40 else ''}",
        }
    except Exception as e:
        logger.debug("涨跌比计算失败: %s", e)
        return _empty(name, weight, f"涨跌比计算异常: {e}", "A股 今日 涨跌家数")


def _calc_northbound():
    """组件 4: 北向资金 (20%)"""
    name = "北向资金"
    weight = 0.20

    df = _try_akshare("stock_hsgt_north_net_flow_in_em")
    if df is None or df.empty:
        return _empty(name, weight, "北向资金数据不可用", "北向资金 今日 净流入 沪股通 深股通")

    try:
        df = df.sort_values(by=df.columns[0])

        val_col = [c for c in df.columns if "净流入" in str(c) or "净买入" in str(c)]
        if not val_col:
            val_col = [df.columns[1]]

        # 近 5 日累计
        recent_5d = df[val_col[0]].iloc[-5:].astype(float).sum()
        # 近 20 日累计
        recent_20d = df[val_col[0]].iloc[-20:].astype(float).sum() if len(df) >= 20 else recent_5d

        # 单位：亿元
        net_5d = recent_5d / 1e4 if abs(recent_5d) > 1e6 else recent_5d  # 适配不同单位

        if net_5d > 100:
            score = 90
        elif net_5d > 30:
            score = 72
        elif net_5d > -30:
            score = 50
        elif net_5d > -100:
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
                "net_5d_yi": round(net_5d, 2),
                "as_of": datetime.now().strftime("%Y-%m-%d"),
            },
            "reasoning": f"近5日北向净流入 {net_5d:+.1f}亿，{'外资积极加仓→贪婪' if net_5d > 30 else '外资净流出→恐惧' if net_5d < -30 else '外资流向中性'}",
        }
    except Exception as e:
        logger.debug("北向资金解析失败: %s", e)
        return _empty(name, weight, f"北向资金解析异常: {e}", "北向资金 今日 净流入 最新")


def _calc_volatility():
    """组件 5: 市场波动 (15%)"""
    name = "市场波动"
    weight = 0.15

    try:
        import yfinance as yf
        hist = yf.Ticker("000300.SS").history(period="3mo")
        if hist is None or hist.empty or len(hist) < 20:
            raise ValueError("沪深300 数据不足")

        returns = hist["Close"].pct_change().dropna()
        vol_20d = float(returns.iloc[-20:].std() * (252 ** 0.5) * 100)  # 年化波动率
        vol_60d = float(returns.std() * (252 ** 0.5) * 100)

        # 波动越低→越贪婪（类似 VIX 逻辑）
        if vol_20d < 12:
            score = 85
        elif vol_20d < 18:
            score = 68
        elif vol_20d < 25:
            score = 45
        elif vol_20d < 35:
            score = 25
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
                "vol_20d_annualized": round(vol_20d, 2),
                "vol_60d_annualized": round(vol_60d, 2),
                "as_of": datetime.now().strftime("%Y-%m-%d"),
            },
            "reasoning": f"沪深300 20日年化波动率={vol_20d:.1f}%，{'低波动→情绪平稳→贪婪' if vol_20d < 15 else '高波动→恐慌加剧→恐惧' if vol_20d > 25 else '波动适中'}",
        }
    except Exception as e:
        logger.debug("A股波动率计算失败: %s", e)
        return _empty(name, weight, f"A股波动率异常: {e}", "沪深300 波动率 VIX 中国 iVIX 今日")


def calculate():
    """计算 A 股贪恐指数全部 5 组件"""
    components = [
        _calc_margin(),
        _calc_turnover(),
        _calc_advance_decline(),
        _calc_northbound(),
        _calc_volatility(),
    ]
    return {"market": MARKET_NAME, "market_en": "A-Share", "components": components}
