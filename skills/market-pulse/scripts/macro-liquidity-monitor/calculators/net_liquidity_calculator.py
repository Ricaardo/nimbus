"""组件 2: 净流动性 (权重 20%)

增强公式（参考 tedtalksmacro / 42Macro）:
  NLQ = WALCL - TGA - RRP + SRF + SWPT
新增:
  - Standing Repo Facility (RPONTSYD) 正向
  - Central Bank Liquidity Swaps (SWPT) 正向
  - TGA 季节性前瞻调整（4/15 税期、季度估税）
  - 改进的评分区间
"""

import logging
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

# TGA 季节性日历：已知流动性抽水事件
# (month, day): (事件描述, 预估 TGA 涌入量 $B, 持续天数)
TGA_SEASONAL = {
    (4, 15): ("个人所得税截止日", 150, 14),     # $100-200B surge
    (6, 15): ("Q2 季度估税", 75, 7),            # $50-100B
    (9, 15): ("Q3 季度估税", 75, 7),
    (12, 15): ("Q4 季度估税", 75, 7),
    (1, 15): ("Q1 季度估税", 60, 7),
    (3, 31): ("季末 RRP 窗口粉饰", 50, 3),
    (6, 30): ("季末 RRP 窗口粉饰", 50, 3),
    (9, 30): ("季末/财年末", 80, 5),
    (12, 31): ("年末 RRP 窗口粉饰", 60, 3),
}


def calculate(fred_client, lookback_days=365):
    start = (datetime.now() - timedelta(days=lookback_days)).strftime("%Y-%m-%d")

    # 增强的 series 列表
    series_ids = ["WALCL", "WTREGEN", "RRPONTSYD", "RPONTSYD", "SWPT"]

    raw = {}
    for sid in series_ids:
        try:
            raw[sid] = fred_client.get_series(sid, start=start)
        except Exception as e:
            logger.debug("%s 获取失败: %s", sid, e)
            raw[sid] = []

    if not raw.get("WALCL"):
        return _empty("WALCL 数据不可用")

    # Build maps
    walcl_map = {obs["date"]: obs["value"] for obs in raw["WALCL"]}
    tga_map = {obs["date"]: obs["value"] for obs in raw.get("WTREGEN", [])}
    rrp_map = {obs["date"]: obs["value"] for obs in raw.get("RRPONTSYD", [])}
    srf_map = {obs["date"]: obs["value"] for obs in raw.get("RPONTSYD", [])}
    swap_map = {obs["date"]: obs["value"] for obs in raw.get("SWPT", [])}

    # Build net liquidity: WALCL - TGA - RRP + SRF + SWPT
    dates = sorted(walcl_map.keys())
    net_series = []
    for d in dates:
        w = walcl_map[d]
        t = _nearest_val(tga_map, d) or 0
        r = _nearest_val(rrp_map, d) or 0
        srf = _nearest_val(srf_map, d) or 0
        swp = _nearest_val(swap_map, d) or 0
        net_series.append({"date": d, "value": w - t - r + srf + swp})

    if len(net_series) < 5:
        return _empty("净流动性数据不足")

    current = net_series[-1]["value"]
    w4_ago = net_series[-5]["value"] if len(net_series) >= 5 else net_series[0]["value"]
    w13_ago = net_series[-14]["value"] if len(net_series) >= 14 else net_series[0]["value"]

    change_4w = current - w4_ago
    change_13w = current - w13_ago

    # 基础评分：净流动性趋势
    if change_4w > 0 and change_13w > 0:
        pct_4w = change_4w / abs(w4_ago) * 100 if w4_ago else 0
        score = min(90, 65 + pct_4w * 15)
    elif change_4w > 0:
        score = 55
    elif change_13w > 0:
        score = 42
    else:
        pct_4w = abs(change_4w / abs(w4_ago) * 100) if w4_ago else 0
        score = max(5, 30 - pct_4w * 8)

    # TGA 季节性前瞻调整
    seasonal_penalty = _tga_seasonal_penalty()
    score -= seasonal_penalty

    score = max(0, min(100, round(score)))
    signal = "easing" if score >= 60 else "tightening" if score < 40 else "neutral"

    # 当前值明细
    latest_date = dates[-1]
    tga_val = _nearest_val(tga_map, latest_date) or 0
    rrp_val = _nearest_val(rrp_map, latest_date) or 0
    srf_val = _nearest_val(srf_map, latest_date) or 0
    swap_val = _nearest_val(swap_map, latest_date) or 0

    reasoning = (
        f"净流动性 {current/1_000_000:.3f}万亿"
        f"（WALCL {walcl_map[latest_date]/1_000_000:.3f}T"
        f" - TGA {tga_val/1_000_000:.3f}T"
        f" - RRP {rrp_val/1_000_000:.3f}T"
    )
    if srf_val > 0:
        reasoning += f" + SRF {srf_val/1000:.1f}B"
    if swap_val > 0:
        reasoning += f" + SWPT {swap_val/1000:.1f}B"
    reasoning += f"），4周变动 {change_4w/1000:+.1f}B"
    if seasonal_penalty > 0:
        reasoning += f"，季节性前瞻扣分 -{seasonal_penalty}"

    return {
        "name": "净流动性",
        "weight": 0.20,
        "score": score,
        "signal": signal,
        "data_available": True,
        "data": {
            "current_trillions": round(current / 1_000_000, 3),
            "change_4w_billions": round(change_4w / 1000, 1),
            "change_13w_billions": round(change_13w / 1000, 1),
            "walcl_trillions": round(walcl_map.get(latest_date, 0) / 1_000_000, 3),
            "tga_trillions": round(tga_val / 1_000_000, 3),
            "rrp_trillions": round(rrp_val / 1_000_000, 3),
            "srf_billions": round(srf_val / 1000, 1),
            "swap_billions": round(swap_val / 1000, 1),
            "seasonal_penalty": seasonal_penalty,
            "as_of": net_series[-1]["date"],
        },
        "reasoning": reasoning,
    }


def _tga_seasonal_penalty():
    """计算 TGA 季节性前瞻惩罚分

    原理：税期/季末前 21 天内，TGA 将涌入大量资金，抽走流动性。
    即使当前净流动性看起来不错，这是已知的前方抽水事件。
    参考 Fed FEDS Notes: TGA 波动对 Fed 资产负债表的影响。
    """
    now = datetime.now()
    penalty = 0

    for (month, day), (desc, estimated_drain_b, duration) in TGA_SEASONAL.items():
        try:
            event_date = datetime(now.year, month, day)
        except ValueError:
            continue

        # 如果事件已过，看明年
        if event_date < now - timedelta(days=5):
            event_date = datetime(now.year + 1, month, day)

        days_until = (event_date - now).days

        if 0 <= days_until <= 21:
            # 越接近事件，惩罚越大（线性衰减）
            proximity = 1.0 - (days_until / 21.0)
            # 按预估抽水量缩放：$150B=15分, $75B=7.5分, $50B=5分
            base_penalty = estimated_drain_b / 10.0
            event_penalty = round(base_penalty * proximity)
            penalty = max(penalty, event_penalty)  # 取最大事件
            logger.info("TGA 季节性: %s 还有 %d 天，惩罚 %d 分", desc, days_until, event_penalty)

    return min(penalty, 20)  # 上限 20 分


def _nearest_val(date_map, target_date):
    if target_date in date_map:
        return date_map[target_date]
    target = datetime.strptime(target_date, "%Y-%m-%d")
    best = None
    best_dist = 10
    for d, v in date_map.items():
        dist = abs((datetime.strptime(d, "%Y-%m-%d") - target).days)
        if dist < best_dist:
            best_dist = dist
            best = v
    return best


def _empty(reason):
    return {
        "name": "净流动性",
        "weight": 0.20,
        "score": 50,
        "signal": "neutral",
        "data_available": False,
        "data": {},
        "reasoning": reason,
    }
