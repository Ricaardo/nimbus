#!/usr/bin/env python3
"""
nav_view.py — 统一净值视图（futu + IBKR 合并；长桥模拟盘不并入，见 ROADMAP）

汇总 L1 portfolio_state.json + nav_history.jsonl（+ 可选 flows.jsonl）：
  · 总资产 / 现金 / futu-IBKR 拆分 / 未实现总盈亏
  · 净值变化 7 日 / 30 日 / 自有史以来（有 flows.jsonl 时附"剔除出入金后"的修正值）
  · 历史最大回撤（peak-to-trough）
  · 跨账户重仓重叠（同一标的同时现身 futu + IBKR）

flows.jsonl（可选，手记，见 skills/references/state/README.md）：
  每行 {"ts": "YYYY-MM-DD", "amount_usd": ±数, "note": "…"}；入金正、出金负。

用法：
  python3 nav_view.py            # markdown
  python3 nav_view.py --json     # 结构化输出

只读分析，不下单。
"""
import argparse
import datetime as dt
import importlib.util
import json
import os
import sys

_SKILLS = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # 自包含:相对脚本定位 skills 根
STATE_DIR = f"{_SKILLS}/references/state"
STATE_FILE = f"{STATE_DIR}/portfolio_state.json"
FLOWS_FILE = f"{STATE_DIR}/flows.jsonl"


def _load_ps():
    """复用 portfolio_state.py 里已有的 nav_history 读取/百分比计算函数（同目录 importlib 装载，
    与 briefing.py / test_portfolio_state.py 的既有约定一致）。"""
    spec = importlib.util.spec_from_file_location(
        "ps", os.path.join(os.path.dirname(os.path.abspath(__file__)), "portfolio_state.py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


ps = _load_ps()


# ---------- 读数据 ----------
def load_state():
    if not os.path.exists(STATE_FILE):
        return None
    try:
        with open(STATE_FILE) as fh:
            return json.load(fh)
    except Exception as e:
        print(f"[warn] 读 portfolio_state 失败: {e}", file=sys.stderr)
        return None


def load_flows():
    if not os.path.exists(FLOWS_FILE):
        return []
    out = []
    try:
        with open(FLOWS_FILE) as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    out.append(json.loads(line))
                except Exception:
                    continue
    except Exception as e:
        print(f"[warn] 读 flows 失败: {e}", file=sys.stderr)
    return out


# ---------- 计算 ----------
def net_flow(flows, since, until=None):
    """区间 [since, until] 净流入(USD)，since/until 为 datetime，按其日期部分闭区间比较。"""
    total, hit = 0.0, False
    since_d = since.date()
    until_d = until.date() if until else None
    for f in flows:
        try:
            d = dt.date.fromisoformat(str(f["ts"])[:10])
            amt = float(f["amount_usd"])
        except Exception:
            continue
        if d >= since_d and (until_d is None or d <= until_d):
            total += amt
            hit = True
    return round(total, 2) if hit else 0.0


def _period(history, current_nav, days, now, flows):
    """N 天前最近一条 vs 当前 NAV 的变化；历史不足返回 None。"""
    cutoff = now - dt.timedelta(days=days)
    ref_ts, ref_nav = None, None
    for row in history:
        try:
            ts = dt.datetime.strptime(row["ts"], "%Y-%m-%d %H:%M")
            nav = float(row["nav_usd"])
        except Exception:
            continue
        if ts <= cutoff and (ref_ts is None or ts > ref_ts):
            ref_ts, ref_nav = ts, nav
    if ref_nav is None or ref_nav == 0:
        return None
    out = {"ref_ts": ref_ts.strftime("%Y-%m-%d %H:%M"), "ref_nav": ref_nav,
           "pct": round((current_nav - ref_nav) / ref_nav * 100, 1)}
    if flows:
        flow = net_flow(flows, ref_ts, now)
        adj_usd = round((current_nav - ref_nav) - flow, 2)
        out["net_flow_usd"] = flow
        out["adj_usd"] = adj_usd
        out["adj_pct"] = round(adj_usd / ref_nav * 100, 1)
    return out


def _since_inception(history, current_nav, now, flows):
    """历史第一条 vs 当前 NAV；历史为空返回 None。"""
    if not history:
        return None
    try:
        first = history[0]
        ts = dt.datetime.strptime(first["ts"], "%Y-%m-%d %H:%M")
        nav = float(first["nav_usd"])
    except Exception:
        return None
    if nav == 0:
        return None
    out = {"ref_ts": first["ts"], "ref_nav": nav,
           "pct": round((current_nav - nav) / nav * 100, 1)}
    if flows:
        flow = net_flow(flows, ts, now)
        adj_usd = round((current_nav - nav) - flow, 2)
        out["net_flow_usd"] = flow
        out["adj_usd"] = adj_usd
        out["adj_pct"] = round(adj_usd / nav * 100, 1)
    return out


def max_drawdown(history, current_nav):
    """peak-to-trough 最大回撤 %（含当前值作为序列末尾）；有效点 < 2 返回 None。"""
    navs = []
    for row in history:
        try:
            navs.append(float(row["nav_usd"]))
        except Exception:
            continue
    navs.append(current_nav)
    if len(navs) < 2:
        return None
    peak, max_dd = navs[0], 0.0
    for v in navs[1:]:
        peak = max(peak, v)
        if peak > 0:
            max_dd = max(max_dd, (peak - v) / peak * 100)
    return round(max_dd, 1)


def overlap(positions):
    """同一 canon 同时出现在 futu 与 ibkr → 合并权重/市值列表（跨账户集中度视图）。"""
    by_canon = {}
    for p in positions:
        c = p.get("canon")
        if not c:
            continue
        by_canon.setdefault(c, []).append(p)
    out = []
    for c, plist in by_canon.items():
        sources = {p.get("source") for p in plist}
        if {"futu", "ibkr"} <= sources:
            out.append({
                "canon": c,
                "name": plist[0].get("name", c),
                "weight_pct": round(sum(p.get("weight_pct", 0) for p in plist), 2),
                "mv_usd": round(sum(p.get("mv_usd", 0) for p in plist), 2),
            })
    out.sort(key=lambda x: x["weight_pct"], reverse=True)
    return out


def _sorted_history(history):
    """按 ts 升序排（最旧在前）。since_inception/max_drawdown 依赖顺序，不假设调用方/文件已排好。
    ts 解析失败的行直接丢弃——若保留会占据 history[0]，让 since_inception 基准整段失效。"""
    def key(row):
        try:
            return dt.datetime.strptime(row.get("ts", ""), "%Y-%m-%d %H:%M")
        except Exception:
            return None
    valid = [(key(row), row) for row in history]
    return [row for k, row in sorted(((k, r) for k, r in valid if k is not None), key=lambda x: x[0])]


def build(now=None, state=None, history=None, flows=None):
    """组装视图。参数均可注入（供冒烟测试用合成数据），默认读真实文件。state=None 时若
    portfolio_state.json 不存在/损坏，返回 None（调用方需优雅降级）。"""
    now = now or dt.datetime.now()
    if state is None:
        state = load_state()
    if state is None:
        return None
    if history is None:
        history = ps.load_nav_history()
    history = _sorted_history(history)
    if flows is None:
        flows = load_flows()

    nav = state["nav_usd"]
    accounts = state.get("accounts", {})

    return {
        "as_of": state.get("as_of"),
        "nav_usd": nav,
        "cash_usd": state.get("cash_usd"),
        "cash_pct": state.get("cash_pct"),
        "pl_usd": state.get("pl_usd"),
        "ibkr_stale": state.get("ibkr_stale"),
        "accounts": accounts,
        "week": _period(history, nav, 7, now, flows),
        "month": _period(history, nav, 30, now, flows),
        "since_inception": _since_inception(history, nav, now, flows),
        "max_drawdown_pct": max_drawdown(history, nav),
        "overlap": overlap(state.get("positions", [])),
    }


# ---------- 渲染 ----------
def _signed_usd(x):
    return f"{'+' if x >= 0 else '-'}${abs(x):,.0f}"


def _fmt_period(name, p):
    if not p:
        return f"- {name}：历史不足"
    s = f"- {name}：{p['pct']:+.1f}%（对比 {p['ref_ts']}，${p['ref_nav']:,.0f}）"
    if "adj_pct" in p:
        s += f"；剔除出入金后 {p['adj_pct']:+.1f}%（区间净流入 ${p['net_flow_usd']:,.0f}）"
    return s


def render(v):
    if v is None:
        return "⚠ 无法读取 portfolio_state.json → 先跑 portfolio_state.py"
    L = [f"# 💰 统一净值视图 — {v['as_of']}", ""]

    accounts = v.get("accounts") or {}
    futu = accounts.get("futu") or {}
    ibkr = accounts.get("ibkr") or {}
    pl_line = f"（浮盈亏 {_signed_usd(v['pl_usd'])}）" if v.get("pl_usd") is not None else ""
    L.append(f"- **总资产 ${v['nav_usd']:,.0f}**{pl_line}" + ("  ⚠IBKR数据陈旧" if v.get("ibkr_stale") else ""))
    futu_pl = f"，浮盈亏 {_signed_usd(futu['pl_usd'])}" if futu.get("pl_usd") is not None else ""
    L.append(f"  - futu ${futu.get('total_usd', 0):,.0f}（现金 ${futu.get('cash_usd', 0):,.0f}{futu_pl}）")
    ibkr_cash = ibkr.get("cash_usd")
    ibkr_total = (ibkr.get("mv_usd") or 0) + (ibkr_cash or 0)
    ibkr_cash_part = f" + 现金 ${ibkr_cash:,.0f}" if ibkr_cash is not None else "（现金未知，未并入）"
    ibkr_pl = f"，浮盈亏 {_signed_usd(ibkr['pl_usd'])}" if ibkr.get("pl_usd") is not None else ""
    L.append(f"  - IBKR ${ibkr_total:,.0f}（市值 ${ibkr.get('mv_usd', 0):,.0f}{ibkr_cash_part}{ibkr_pl}）")
    L.append(f"  - 现金占比 {v['cash_pct']}%")
    L.append("")

    L.append("## 净值变化")
    L.append(_fmt_period("7 日", v["week"]))
    L.append(_fmt_period("30 日", v["month"]))
    L.append(_fmt_period("自有史以来", v["since_inception"]))
    L.append("")

    L.append("## 风险")
    dd = v["max_drawdown_pct"]
    L.append(f"- 历史最大回撤：{dd}%" if dd is not None else "- 历史最大回撤：历史不足")
    L.append("")

    L.append("## 跨账户重叠")
    if v["overlap"]:
        for o in v["overlap"]:
            L.append(f"- {o['name']}（{o['canon']}）合并占比 {o['weight_pct']}% · ${o['mv_usd']:,.0f}")
    else:
        L.append("- 无重叠标的")
    L.append("")
    L.append("> 统一净值 = futu + IBKR（长桥模拟盘不计入，见 ROADMAP）。"
              "数据源：portfolio_state.json + nav_history.jsonl（+ flows.jsonl 剔除出入金）。只读，不下单。")
    return "\n".join(L)


def main():
    ap = argparse.ArgumentParser(description="统一净值视图（futu+IBKR 合并；长桥模拟盘不并入）")
    ap.add_argument("--json", action="store_true", help="输出结构化 JSON")
    args = ap.parse_args()

    v = build()
    if args.json:
        print(json.dumps(v, ensure_ascii=False, indent=2))
    else:
        print(render(v))


if __name__ == "__main__":
    main()
