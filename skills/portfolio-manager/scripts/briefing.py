#!/usr/bin/env python3
"""
briefing.py — L2 编排入口（投顾日报/周报）

把已有各层串成一份晨报，一条命令产出"顾问感"：
  1. 组合快照（L1 portfolio_state）
  2. 🚨 今日待办（对账报警 + 破止损 + 论点衰减 + 复审到期，按优先级）
  3. 论点健康（每个 thesis：age/衰减档/verdict/距止损/下次复审）
  4. 行为体检（behavior_monitor 近 7 天周转/对敲）
  5. 待 AI 补（MHS via market-pulse、本周财报 via event-calendar）

用法：
  python3 briefing.py                # 日报
  python3 briefing.py --no-behavior  # 跳过行为体检(省一次 futu 拉取)
  python3 briefing.py --json

只读，不下单。是"读"层——汇总 L1/论点/行为，不重算市场。
"""
import argparse
import datetime as dt
import importlib.util
import os
import sys

import yaml

HOME = os.path.expanduser("~")
_SKILLS = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # 自包含:相对脚本定位 skills 根,不依赖 ~/.claude
_REPO_ROOT = os.path.dirname(_SKILLS)
THESES_DIR = f"{_REPO_ROOT}/reports/theses"  # canonical:仓库根 reports/theses(非 skill 内嵌目录,见 thesis-tracker/SKILL.md)
PM_SCRIPTS = f"{_SKILLS}/portfolio-manager/scripts"
TJ_SCRIPTS = f"{_SKILLS}/trade-journal/scripts"
MP_SCRIPTS = f"{_SKILLS}/market-pulse/scripts"
EC_SCRIPTS = f"{_SKILLS}/event-calendar/scripts"


def _load(mod_name, path):
    spec = importlib.util.spec_from_file_location(mod_name, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


ps = _load("ps", f"{PM_SCRIPTS}/portfolio_state.py")
TODAY = dt.date.today()


# ---------- 论点衰减 ----------
def _age_days(d):
    try:
        return (TODAY - dt.date.fromisoformat(str(d)[:10])).days
    except Exception:
        return None


def decay_label(days):
    if days is None:
        return "?", "·"
    if days < 60:
        return "Active", "🟢"
    if days < 90:
        return "Stale", "🟡"
    if days < 180:
        return "Decayed", "🟠"
    return "Zombie", "🔴"


def thesis_health():
    rows = []
    if not os.path.isdir(THESES_DIR):
        return rows
    for fn in sorted(os.listdir(THESES_DIR)):
        if not fn.endswith((".yaml", ".yml")):
            continue
        try:
            with open(os.path.join(THESES_DIR, fn)) as fh:
                y = yaml.safe_load(fh) or {}
        except Exception:
            continue
        rs = y.get("review_schedule", {}) or {}
        age = _age_days(y.get("last_updated"))
        nr = rs.get("next_review")
        nr_due = None
        try:
            nr_due = (dt.date.fromisoformat(str(nr)[:10]) - TODAY).days
        except Exception:
            pass
        rows.append({
            "file": fn,
            "ticker": ps.canon(y.get("ticker", fn.rsplit(".", 1)[0])),
            "name": y.get("name", fn),
            "type": y.get("type", ""),
            "score": y.get("current_conviction_score"),
            "verdict": (y.get("thesis_vs_price", {}) or {}).get("verdict", ""),
            "age": age,
            "next_review": str(nr) if nr else None,
            "nr_due": nr_due,
        })
    return rows


# ---------- 待办合成 ----------
def action_items(state, theses):
    items = []
    for f in state["reconcile_flags"]:
        if f["severity"] in ("high",):
            items.append((0, f"🔴 {f['type']} [{f['ticker']}] — {f['detail']}"))
    for t in theses:
        lbl, ic = decay_label(t["age"])
        if lbl in ("Decayed", "Zombie") and t["type"] == "held":
            items.append((1, f"{ic} 论点衰减 [{t['ticker']}] — {t['age']}天未更新（{lbl}）→ 重审或归档"))
        if t["nr_due"] is not None and t["nr_due"] <= 0 and t["type"] == "held":
            items.append((1, f"🟠 复审到期 [{t['ticker']}] — 计划复审 {t['next_review']} 已到"))
    for f in state["reconcile_flags"]:
        if f["severity"] == "medium" and ("裸仓" in f["type"] or "IBKR现金携带" in f["type"]):
            items.append((2, f"🟠 {f['type']} [{f['ticker']}] — {f['detail']}"))
    items.sort(key=lambda x: x[0])
    return [m for _, m in items]


# ---------- NAV 行（统一净值：futu + IBKR，长桥模拟盘不并入） ----------
def _nav_line(state):
    nav_usd = state["nav_usd"]
    accounts = state.get("accounts") or {}
    futu_usd = (accounts.get("futu") or {}).get("total_usd")
    if futu_usd is not None:
        ibkr_usd = nav_usd - futu_usd
        nav_part = f"NAV **${nav_usd:,.0f}**(futu ${futu_usd:,.0f} + IBKR ${ibkr_usd:,.0f})"
    else:
        nav_part = f"NAV **${nav_usd:,.0f}**"           # 旧 state（无 accounts 字段）退回旧格式
    parts = [nav_part, f"现金 {state['cash_pct']}%"]
    try:
        week_pct = ps.nav_change_pct(ps.load_nav_history(), nav_usd, 7)
    except Exception:
        week_pct = None
    if week_pct is not None:
        parts.append(f"7 日 {week_pct:+.1f}%")
    parts.append(f"{len(state['positions'])} 持仓")
    line = " · ".join(parts)
    if state.get("ibkr_stale"):
        line += "  ⚠IBKR陈旧"
    return line


# ---------- 渲染 ----------
def render(state, theses, behavior, market=None, earnings=None, macro=None, ideas=None):
    L = [f"# ☀️ 投顾日报 — {TODAY.isoformat()}  ({['周一','周二','周三','周四','周五','周六','周日'][TODAY.weekday()]})", ""]

    # 1. 快照
    L.append(f"## 组合快照")
    L.append(_nav_line(state))
    L.append("")
    for p in state["positions"][:6]:
        if p["weight_pct"] < 0.5:
            continue
        th = "✅" if p["thesis"] else ("期权" if p["is_option"] else "🔴无论点")
        L.append(f"- {p['name'][:10]} {p['weight_pct']}% · {p['pl_pct']:+.1f}% · {th}")
    L.append("")

    # 2. 今日待办
    items = action_items(state, theses)
    L.append("## 🚨 今日待办" + (f"（{len(items)}）" if items else ""))
    if items:
        L += [f"{i+1}. {m}" for i, m in enumerate(items)]
    else:
        L.append("✅ 无高优待办")
    L.append("")

    # 3. 论点健康
    L.append("## 论点健康")
    L.append("| 标的 | type | conv | verdict | 更新 | 衰减 | 下次复审 |")
    L.append("|---|---|---|---|---|---|---|")
    for t in theses:
        lbl, ic = decay_label(t["age"])
        age = f"{t['age']}d" if t["age"] is not None else "?"
        nr = t["next_review"] or "—"
        if t["nr_due"] is not None and t["nr_due"] <= 7:
            nr += " ⏰"
        L.append(f"| {t['name'][:12]} | {t['type']} | {t['score'] if t['score'] is not None else '—'} "
                 f"| {t['verdict'] or '—'} | {age} | {ic}{lbl} | {nr} |")
    L.append("")

    # 4. 行为体检
    if behavior is not None:
        L.append("## 🛡 行为体检（近 7 天）")
        L.append(f"成交 {behavior['total_fills']} 笔 · 周转率 "
                 f"**{behavior['turnover_ratio_week']}x NAV/周** · "
                 f"杠杆ETF盈亏 ${behavior['leveraged_realized']:,.0f}")
        reds = [f for f in behavior["flags"] if f["severity"] == "high"]
        for f in reds[:5]:
            L.append(f"- 🔴 {f['type']} [{f['ticker']}] — {f['detail']}")
        if not reds:
            L.append("- ✅ 无红色行为报警")
        L.append("")

    # 5. 市场温度（自动 MHS）
    L.append("## 🌡 市场温度")
    L.append(market if market else "（市场温度模块未运行 / 数据不可得）")
    L.append("")

    # 6. 宏观/流动性（ah-screener FRED）
    L.append("## 🏦 宏观/流动性")
    L.append(macro if macro else "（宏观模块未运行 / 无缓存）")
    L.append("")

    # 7. 本周事件（自动财报）
    L.append("## 📅 本周事件")
    L.append(earnings if earnings else "（财报模块未运行 / 数据不可得）")
    L.append("")

    # 8. 选股 idea（默认降级：避免每日推 idea 喂过度交易）
    if ideas:
        L.append("## 💡 选股 idea")
        L.append("⚠ 研究候选，非交易触发——你是过度交易画像，看而不动手。")
        L.append(ideas)
        L.append("")

    # 9. 仍需 AI 补
    L.append("## 📌 仍需 AI 补充（深度判断）")
    L.append("- **新闻情报**：`news-dashboard` 持仓相关重大事件")
    L.append("- **MHS 地缘维**：脚本默认中性，重大地缘事件 AI 手动调 `--geo`")
    L.append("")
    L.append("> MHS/财报/宏观(FRED)/选股(ah-screener) 已自动；持仓读自 L1 state。只读，不下单。")
    return "\n".join(L)


def main():
    ap = argparse.ArgumentParser(description="L2 投顾日报编排")
    ap.add_argument("--no-behavior", action="store_true", help="跳过行为体检")
    ap.add_argument("--no-market", action="store_true", help="跳过 MHS/财报(省 yf 拉取)")
    ap.add_argument("--geo", type=float, default=50, help="MHS 地缘分(0-100)，默认中性")
    ap.add_argument("--ideas", action="store_true",
                    help="附选股 idea(默认关，避免诱发过度交易；周度/按需才开)")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    state = ps.build()
    theses = thesis_health()

    behavior = None
    if not args.no_behavior:
        try:
            bm = _load("bm", f"{TJ_SCRIPTS}/behavior_monitor.py")
            start = (TODAY - dt.timedelta(days=7)).isoformat()
            fills = bm.pull_fills(start, TODAY.isoformat())
            if fills:
                behavior = bm.analyze(fills, state["nav_usd"], 7)
        except Exception as e:
            print(f"[warn] 行为体检跳过: {e}", file=sys.stderr)

    market = earnings = None
    if not args.no_market:
        try:
            mh = _load("mh", f"{MP_SCRIPTS}/market_health.py")
            market = mh.render(mh.build(args.geo))
        except Exception as e:
            print(f"[warn] MHS 跳过: {e}", file=sys.stderr)
        try:
            he = _load("he", f"{EC_SCRIPTS}/holdings_earnings.py")
            earnings = he.render(he.build(14))
        except Exception as e:
            print(f"[warn] 财报跳过: {e}", file=sys.stderr)

    # 宏观(读缓存,不在此 live 拉) + 选股 idea(读 ah-screener 报告)
    macro = ideas = None
    try:
        mf = _load("mf", f"{PM_SCRIPTS}/macro_feed.py")
        macro = mf.render(mf.load())
    except Exception as e:
        print(f"[warn] 宏观跳过: {e}", file=sys.stderr)
    if args.ideas:        # 默认关：避免每日推 idea 喂过度交易，周度/按需才开
        try:
            idf = _load("idf", f"{PM_SCRIPTS}/idea_feed.py")
            holds = [p.get("canon", "") for p in state.get("positions", [])]
            # 一条龙：futu粗筛+ah深算的"两层都点头"价值股优先；不可得降级回 ah 候选
            ideas = idf.render(idf.build(6), holds, idf.two_layer())
        except Exception as e:
            print(f"[warn] idea 跳过: {e}", file=sys.stderr)

    if args.json:
        import json
        print(json.dumps({"state": state, "theses": theses, "behavior": behavior,
                          "market": market, "earnings": earnings,
                          "macro": macro, "ideas": ideas},
                         ensure_ascii=False, indent=2))
    else:
        print(render(state, theses, behavior, market, earnings, macro, ideas))


if __name__ == "__main__":
    main()
