#!/usr/bin/env python3
"""
idea_feed.py — 选股 idea 接入（消费 ah-stock-screener 已产出的候选）

ah-stock-screener(/Users/x/ah-stock-screener) 是成熟的 A/H/US 三市筛选器，
定时 launchd 跑出每日报告。本适配器**只读**其 latest 报告，把 top_actions /
core_candidates 接进投顾日报，填补"找标的"空白。不重跑筛选、不触网。

用法：python3 idea_feed.py [--top 6] [--json]
只读，不下单。
"""
import argparse
import datetime as dt
import importlib.util
import json
import os

TODAY = dt.date.today()
MKT = {"a": "A", "hk": "HK", "us": "US", "A": "A", "HK": "HK", "US": "US"}
_AH = os.path.expanduser("~/.claude/skills/ah-stock-screener/scripts")
_SCREENER = f"{_AH}/screener.py"
_PIPELINE = f"{_AH}/value_pipeline.py"


def _load_mod(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _load_report():
    """经 ah-stock-screener skill 读最新报告 dict；skill/项目缺失 → None(降级)。"""
    try:
        return _load_mod(_SCREENER, "screener").load_report()
    except Exception:
        return None


def two_layer(markets=("US", "HK"), top=5):
    """跑 value_pipeline：futu价值粗筛 → ah深度分，收集"两层都点头"(核心/观察)价值股。
    futu OpenD 不可用 / 闭市 / ah 未跑 → None(降级回 ah 候选)。"""
    try:
        vp = _load_mod(_PIPELINE, "vp")
    except Exception:
        return None
    agree = []
    for mkt in markets:
        try:
            r = vp.build(mkt, 30, {"custom": False})
        except Exception:
            r = None
        if not r:
            continue
        for x in r["rows"]:
            if x.get("decision") in ("core_candidate", "watchlist"):
                agree.append({"market": mkt, "code": x["code"], "name": x["name"],
                              "pe": x["pe"], "pb": x["pb"],
                              "ah_score": x["ah_score"], "decision": x["decision"]})
    if not agree:
        return None
    agree.sort(key=lambda x: -(x["ah_score"] or 0))
    return agree[:top]


def build(top=6):
    d = _load_report()
    if not d:                # 项目已删/未跑/报告缺失 → 优雅降级
        return None
    rdate = str(d.get("report_date", ""))[:10]
    stale = None
    try:
        stale = (TODAY - dt.date.fromisoformat(rdate)).days
    except Exception:
        pass
    acts = []
    for a in (d.get("top_actions") or [])[:top]:
        sc = a.get("score")
        acts.append({
            "market": MKT.get(str(a.get("market", "")), str(a.get("market", ""))),
            "symbol": a.get("symbol", ""), "name": a.get("name", ""),
            "score": round(sc, 1) if isinstance(sc, (int, float)) else sc,
            "action": a.get("action", a.get("label", "")),
            "delta": a.get("delta"),
        })
    cores = [{"market": MKT.get(str(c.get("market", "")), str(c.get("market", ""))),
              "symbol": c.get("symbol", ""), "name": c.get("name", ""),
              "score": c.get("score")}
             for c in (d.get("core_candidates") or [])[:top]]
    return {"report_date": rdate, "stale_days": stale,
            "strategy": d.get("strategy", ""), "top_actions": acts,
            "core_candidates": cores,
            "counts": d.get("decision_distribution") or d.get("counts")}


def render(r, holdings=None, two=None):
    hold = {str(h).upper() for h in (holdings or [])}
    L = []
    # 💎 优先：两层都点头（futu便宜 + ah深度认）—— 一条龙高信念价值股
    if two:
        L.append("  💎 **两层都点头**（futu便宜 + ah深度认，高信念价值）：")
        for x in two:
            dec = "🟢核心" if x["decision"] == "core_candidate" else "🟡观察"
            sym = x["code"].split(".")[-1].upper()
            held = " (持仓)" if sym in hold or x["code"].upper() in hold else ""
            L.append(f"  · [{x['market']}] {x['name'][:10]}({x['code']}) "
                     f"PE{x['pe']:.1f}/PB{x['pb']:.2f} · ah{x['ah_score']} {dec}{held}")
        L.append("")
    if r is None:
        if not two:
            return "选股 idea：futu一条龙与 ah 报告均不可得（OpenD/launchd 在跑吗）"
        L.append("  > 一条龙来自 futu粗筛+ah深算；深析切 us-stock-analysis / research")
        return "\n".join(L)
    warn = f" ⚠报告 {r['stale_days']}天前" if (r["stale_days"] or 0) > 3 else ""
    L.append(f"ah-screener 候选（{r['report_date']}{warn}）：")
    if r["top_actions"]:
        L.append("  **Top Actions**：")
        for a in r["top_actions"]:
            held = " (持仓)" if a["symbol"].upper() in hold else ""
            sc = f" 分{a['score']}" if a["score"] is not None else ""
            dl = f" Δ{a['delta']}" if a.get("delta") not in (None, 0) else ""
            L.append(f"  · [{a['market']}] {a['name']}({a['symbol']}) — {a['action']}{sc}{dl}{held}")
    if r["core_candidates"]:
        cc = " · ".join(f"{c['name']}({c['symbol']})" for c in r["core_candidates"][:5])
        L.append(f"  核心池：{cc}")
    L.append("  > 来自 ah-stock-screener，深度分析切 us-stock-analysis / research")
    return "\n".join(L)


def main():
    ap = argparse.ArgumentParser(description="选股 idea 接入(一条龙两层 + ah 候选)")
    ap.add_argument("--top", type=int, default=6)
    ap.add_argument("--no-pipeline", action="store_true", help="跳过 futu 一条龙(仅 ah 候选)")
    ap.add_argument("--markets", default="US,HK", help="一条龙市场(逗号分隔)")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    r = build(args.top)
    two = None if args.no_pipeline else two_layer(
        tuple(m.strip() for m in args.markets.split(",") if m.strip()))
    if args.json:
        print(json.dumps({"two_layer": two, "ah": r}, ensure_ascii=False, indent=2))
    else:
        print(render(r, two=two))


if __name__ == "__main__":
    main()
