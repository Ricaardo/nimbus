#!/usr/bin/env python3
"""
behavior_monitor.py — 行为护栏层 · 组件 A

拉 futu 真实成交，计算滚动窗口内的交易行为指标，检测 4 类病灶并报警：
  1. 过度交易 (overtrading)   — 周转率 / 成交笔数过高
  2. 杠杆 ETF 对敲             — 3x ETF 多空横跳 + 实现亏损
  3. 摊低成本 (averaging down) — 同标的越跌越买
  4. 反手接刀 (flip)           — 平仓后短时间内反向再开

数据源：futu get_history_order_fill_list.py（复用本人真实账户）
用法：
  python3 behavior_monitor.py                 # 默认近 7 天，US+HK
  python3 behavior_monitor.py --days 30 --nav 23700
  python3 behavior_monitor.py --json          # 机器可读（供 cron/hook 消费）

⚠ 只读分析，不下单。阈值见 THRESHOLDS，可按需调整。
"""
import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys

_SKILLS = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # 自包含,不依赖 ~/.claude

FUTU_SCRIPT = os.path.expanduser(
    f"{_SKILLS}/futuapi/scripts/trade/get_history_order_fill_list.py"
)

# 3x / 杠杆 ETF 监控名单（与 leverage-etf-warn.sh 保持一致）
LEVERAGED = {
    "SOXL", "SOXS", "TQQQ", "SQQQ", "SPXL", "SPXS", "TNA", "TZA", "UPRO", "SPXU",
    "UDOW", "SDOW", "FAS", "FAZ", "LABU", "LABD", "NUGT", "DUST", "JNUG", "JDST",
    "YINN", "YANG", "BULZ", "BERZ", "WEBL", "WEBS",
}

THRESHOLDS = {
    "turnover_ratio_week": 1.0,   # 周毛周转 / NAV > 1.0 → 过度交易
    "fills_per_week": 30,         # 周成交笔数 > 30 → 高频对敲
    "avg_down_buys": 2,           # 同标的 ≥2 笔递降买入 → 摊低成本
    "flip_cooldown_min": 60,      # 持仓穿越零轴后 60 分钟内真反向 → 反手
}

# 按市场近似汇率（→ USD），用于跨币种周转/盈亏汇总。
# 注：静态近似（2026-06），仅供行为度量；精确盈亏以券商对账单为准。
FX_USD = {"US": 1.0, "HK": 1 / 7.80, "CN": 1 / 7.20, "SG": 1 / 1.35, "JP": 1 / 150.0}


PORTFOLIO_SCRIPT = os.path.expanduser(
    f"{_SKILLS}/futuapi/scripts/trade/get_all_portfolios.py")
DEFAULT_NAV = 23700      # 回退值（futu 主 ~$22K + IBKR ~$1.4K）
IBKR_USD = 1400          # IBKR 小号近似（futu 不含），并入总 NAV


def get_nav():
    """实拉 futu 总资产(HKD)换算 USD + IBKR 估值；失败回退 DEFAULT_NAV。
    返回 (nav_usd, source)。source ∈ {futu, default}。"""
    try:
        out = subprocess.run(
            [sys.executable, PORTFOLIO_SCRIPT, "--trd-env", "REAL"],
            capture_output=True, text=True, timeout=60,
        ).stdout
        vals = [float(v.replace(",", ""))
                for v in re.findall(r"总资产[:：]\s*([\d,]+\.?\d*)", out)]
        hkd = max(vals) if vals else 0       # 主账户(HKD 计价)
        nav = hkd * FX_USD["HK"] + IBKR_USD
        if nav > 1000:                       # 合理性闸
            return round(nav, 0), "futu"
    except Exception as e:
        print(f"[warn] 拉 NAV 失败，用默认: {e}", file=sys.stderr)
    return DEFAULT_NAV, "default"


def pull_fills(start, end, markets=None):
    """调 futu 脚本拉成交，按 deal_id 去重，返回 fill 列表。

    实测（本环境 FUTU_DEFAULT_MARKET 未设）：单次调用即返回全市场成交
    （US/HK/JP 同现），故只调一次。⚠ 若未来 FUTU_DEFAULT_MARKET 被设为单一市场，
    可能只返回该市场——届时需改为按市场循环。fx/市场一律从 code 前缀
    （US./HK./JP./SG./CN.）推导，不依赖查询参数。markets: 可选前缀白名单；None=全部。
    """
    try:
        out = subprocess.run(
            [sys.executable, FUTU_SCRIPT, "--trd-env", "REAL",
             "--start", start, "--end", end, "--json"],
            capture_output=True, text=True, timeout=120,
        ).stdout
    except Exception as e:
        print(f"[warn] 拉成交失败: {e}", file=sys.stderr)
        return []
    m = re.search(r"\[\s*\{", out)
    if not m:
        return []
    try:
        data, _ = json.JSONDecoder().raw_decode(out[m.start():])
    except Exception as e:
        print(f"[warn] 解析 JSON 失败: {e}", file=sys.stderr)
        return []

    seen = set()
    fills = []
    for r in data:
        did = str(r.get("deal_id", ""))
        if did and did in seen:        # 去重
            continue
        if did:
            seen.add(did)
        code = str(r.get("code", ""))
        prefix = code.split(".")[0] if "." in code else "US"
        if markets and prefix not in markets:
            continue
        fills.append({
            "code": code,
            "ticker": code.split(".")[-1],
            "market": prefix,
            "qty": float(r.get("qty", 0)),
            "price": float(r.get("price", 0)),
            "fx": FX_USD.get(prefix, 1.0),   # 按真实市场前缀换算 → USD
            "side": "BUY" if "BUY" in str(r.get("trd_side", "")) else "SELL",
            "time": str(r.get("create_time", "")),
        })
    fills.sort(key=lambda x: x["time"])
    return fills


def analyze(fills, nav, days):
    by_ticker = {}
    for f in fills:
        by_ticker.setdefault(f["ticker"], []).append(f)

    gross_turnover = sum(f["qty"] * f["price"] * f["fx"] for f in fills)
    total_fills = len(fills)
    weeks = max(days / 7.0, 1e-9)
    turnover_ratio_week = (gross_turnover / nav) / weeks if nav else 0
    fills_per_week = total_fills / weeks

    per_ticker = []
    flags = []

    for tk, fs in by_ticker.items():
        bq = sum(f["qty"] for f in fs if f["side"] == "BUY")
        sq = sum(f["qty"] for f in fs if f["side"] == "SELL")
        bc = sum(f["qty"] * f["price"] * f["fx"] for f in fs if f["side"] == "BUY")
        sp = sum(f["qty"] * f["price"] * f["fx"] for f in fs if f["side"] == "SELL")
        net = bq - sq
        realized = (sp - bc) if abs(net) < 1e-6 else None  # 仅 flat 时干净（USD）
        is_lev = tk in LEVERAGED
        per_ticker.append({
            "ticker": tk, "fills": len(fs), "buy_qty": bq, "sell_qty": sq,
            "turnover": bc + sp, "net_shares": round(net, 2),
            "realized": round(realized, 2) if realized is not None else None,
            "leveraged": is_lev,
        })

        # 检测 3: 摊低成本 — 仅统计「持有多仓期内、低于上一笔的加买」，平仓即重置 streak
        # （避免把分日、平仓后重开的独立 dip-buy 误判为摊低成本，见 reviewer S1）
        posA = 0.0
        last_buy = None
        run = 0
        max_run = 0
        for f in fs:
            prev_pos = posA
            posA += f["qty"] if f["side"] == "BUY" else -f["qty"]
            if abs(posA) < 1e-6:            # 平仓 → 重置
                last_buy, run = None, 0
                continue
            if f["side"] == "BUY":
                if prev_pos > 1e-6 and last_buy is not None and f["price"] < last_buy:
                    run += 1
                    max_run = max(max_run, run)
                elif prev_pos <= 1e-6:      # 新开仓，streak 归零
                    run = 0
                last_buy = f["price"]
        if max_run >= THRESHOLDS["avg_down_buys"]:
            flags.append({
                "type": "M02_摊低成本", "ticker": tk, "severity": "high",
                "detail": f"持仓期内 {max_run+1} 笔递降加仓（越跌越买）",
            })

        # 检测 2: 杠杆 ETF 对敲亏损
        if is_lev and realized is not None and realized < 0:
            flags.append({
                "type": "M08_杠杆ETF对敲亏损", "ticker": tk, "severity": "high",
                "detail": f"{len(fs)} 笔进出，实现亏损 ${realized:,.0f}",
            })

        # 检测 4: 反手接刀 — 持仓穿越零轴后短时真反向（非日内 scalp 噪音）
        # 跟踪 running 仓位；当方向由多翻空或由空翻多、且距上次归零 ≤ 冷却期 → 报警
        pos = 0.0
        zero_time = None        # 最近一次归零/穿越的时间
        prev_sign = 0
        for f in fs:
            pos += f["qty"] if f["side"] == "BUY" else -f["qty"]
            sign = 1 if pos > 1e-6 else (-1 if pos < -1e-6 else 0)
            if prev_sign != 0 and sign != 0 and sign != prev_sign:
                # 真反向：方向翻转
                dtmin = _minutes_between(zero_time, f["time"]) if zero_time else None
                if dtmin is not None and dtmin <= THRESHOLDS["flip_cooldown_min"]:
                    flags.append({
                        "type": "M01_反手/冷却期内翻向", "ticker": tk,
                        "severity": "medium",
                        "detail": f"持仓 {prev_sign:+d}→{sign:+d}，距归零 {dtmin:.0f} 分钟",
                    })
                    break
            if sign != prev_sign:        # 记录穿越/归零时刻
                zero_time = f["time"]
            if sign != 0:
                prev_sign = sign

    # 检测 1: 过度交易
    if turnover_ratio_week > THRESHOLDS["turnover_ratio_week"]:
        flags.append({
            "type": "过度交易_周转率", "ticker": "(组合)", "severity": "high",
            "detail": f"周毛周转 {turnover_ratio_week:.1f}x NAV "
                      f"(阈值 {THRESHOLDS['turnover_ratio_week']}x)",
        })
    if fills_per_week > THRESHOLDS["fills_per_week"]:
        flags.append({
            "type": "过度交易_成交笔数", "ticker": "(组合)", "severity": "medium",
            "detail": f"周 {fills_per_week:.0f} 笔 (阈值 {THRESHOLDS['fills_per_week']})",
        })

    lev_realized = sum(t["realized"] for t in per_ticker
                       if t["leveraged"] and t["realized"] is not None)
    per_ticker.sort(key=lambda x: x["turnover"], reverse=True)
    return {
        "window_days": days, "nav": nav,
        "total_fills": total_fills,
        "gross_turnover": round(gross_turnover, 0),
        "turnover_ratio_week": round(turnover_ratio_week, 2),
        "fills_per_week": round(fills_per_week, 1),
        "leveraged_realized": round(lev_realized, 2),
        "per_ticker": per_ticker,
        "flags": flags,
    }


def _parse_time(s):
    """容忍含/不含微秒、含/不含时区后缀的 futu 时间串。"""
    s = str(s).strip()
    for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S"):
        try:
            return dt.datetime.strptime(s[:26] if "." in s else s[:19], fmt)
        except ValueError:
            continue
    return None


def _minutes_between(t1, t2):
    a, b = _parse_time(t1), _parse_time(t2)
    if a is None or b is None:
        return None
    return abs((b - a).total_seconds()) / 60.0


def render(rep):
    lines = []
    lines.append(f"# 🛡 行为护栏体检 — 近 {rep['window_days']} 天")
    lines.append("")
    lines.append(f"- 成交笔数：**{rep['total_fills']}** "
                 f"({rep['fills_per_week']}/周)")
    lines.append(f"- 毛周转(买+卖)：**${rep['gross_turnover']:,.0f}** "
                 f"→ 周转率 **{rep['turnover_ratio_week']}x NAV/周**")
    lines.append(f"  · NAV 基准 **${rep['nav']:,.0f}**"
                 f"（{'实拉 futu' if rep.get('nav_source')=='futu' else '估值默认，--nav 可覆盖'}）")
    if rep["leveraged_realized"]:
        lines.append(f"- 杠杆 ETF 实现盈亏：**${rep['leveraged_realized']:,.0f}**")
    lines.append("")
    if rep["flags"]:
        lines.append("## 🚨 报警")
        for fl in rep["flags"]:
            icon = "🔴" if fl["severity"] == "high" else "🟠"
            lines.append(f"- {icon} **{fl['type']}** [{fl['ticker']}] — {fl['detail']}")
    else:
        lines.append("## ✅ 本窗口无行为报警")
    lines.append("")
    lines.append("## 标的明细（按周转排序）")
    lines.append("| 标的 | 笔数 | 周转 | 净股 | 实现盈亏 | 杠杆 |")
    lines.append("|---|---|---|---|---|---|")
    for t in rep["per_ticker"][:15]:
        rp = f"${t['realized']:,.0f}" if t["realized"] is not None else "—"
        lev = "⚠️" if t["leveraged"] else ""
        lines.append(f"| {t['ticker']} | {t['fills']} | ${t['turnover']:,.0f} "
                     f"| {t['net_shares']:g} | {rp} | {lev} |")
    lines.append("")
    lines.append("> 只读分析，不构成下单。AI 不下单（trade-guard deny）。")
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser(description="行为护栏监控 — 拉真实成交检测交易病灶")
    ap.add_argument("--days", type=int, default=7, help="回溯天数（默认 7）")
    ap.add_argument("--nav", type=float, default=None,
                    help="账户 NAV（USD）；不填则尝试实拉 futu，失败回退 23700")
    ap.add_argument("--markets", default="ALL",
                    help="逗号分隔市场前缀白名单 US,HK,JP,CN,SG（默认 ALL=全部）")
    ap.add_argument("--json", action="store_true", help="输出 JSON")
    args = ap.parse_args()

    if args.nav is not None:
        nav, nav_source = args.nav, "manual"
    else:
        nav, nav_source = get_nav()

    end = dt.date.today()
    start = end - dt.timedelta(days=args.days)
    mkts = None if args.markets.upper() == "ALL" else {
        m.strip().upper() for m in args.markets.split(",") if m.strip()}
    fills = pull_fills(start.isoformat(), end.isoformat(), mkts)
    if not fills:
        print("（无成交记录或拉取失败 —— futu OpenD 是否在运行？）")
        return
    rep = analyze(fills, nav, args.days)
    rep["nav_source"] = nav_source
    if args.json:
        print(json.dumps(rep, ensure_ascii=False, indent=2))
    else:
        print(render(rep))


if __name__ == "__main__":
    main()
