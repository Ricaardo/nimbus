#!/usr/bin/env python3
"""
screener_us.py — equity-screener 项目的美股 skill 封装（薄接口）

数仓本体（DuckDB us_screener.duckdb + 多因子模型 + 概念热度 + squeeze）在
~/nimbus-stack/equity-screener，自带 venv/CLI/launchd（每日盘前自动跑）。本封装让它的
美股选股成为可发现、可调用的 skill：读候选、给报告路径。读为主、安全。A/H 见 ah-screener。

用法：
  python3 screener_us.py candidates [--top 8] [--decision core_candidate]   # 看今日美股候选
  python3 screener_us.py report-path                                        # 最新报告绝对路径
  python3 screener_us.py status                                             # 项目可用性/报告新鲜度
库用法：from screener_us import latest_report_path, load_report
"""
import argparse
import datetime as dt
import glob
import json
import os

PROJECT_ROOT = os.path.expanduser("~/nimbus-stack/equity-screener")  # 美股数仓本体
REPORTS_DIR = os.path.join(PROJECT_ROOT, "reports", "us-premarket")
VENV_PY = os.path.join(PROJECT_ROOT, ".venv", "bin", "python")
TODAY = dt.date.today()


def latest_report_path():
    """最新 US 报告 JSON 绝对路径（优先 latest，回退最新 dated）；缺失 → None。"""
    latest = os.path.join(REPORTS_DIR, "us-premarket-latest.json")
    if os.path.exists(latest):
        return latest
    dated = sorted(glob.glob(os.path.join(REPORTS_DIR, "us-premarket-2*.json")))
    return dated[-1] if dated else None


def load_report():
    p = latest_report_path()
    if not p:
        return None
    try:
        with open(p) as f:
            return json.load(f)
    except Exception:
        return None


def status():
    p = latest_report_path()
    out = {"project_root": PROJECT_ROOT,
           "project_exists": os.path.isdir(PROJECT_ROOT),
           "venv_exists": os.path.exists(VENV_PY),
           "report_exists": bool(p)}
    d = load_report()
    if d:
        rd = str(d.get("report_date", ""))[:10]
        out["report_date"] = rd
        try:
            out["stale_days"] = (TODAY - dt.date.fromisoformat(rd)).days
        except Exception:
            pass
    return out


def top_candidates(top=8, decision=None):
    d = load_report()
    if not d:
        return None
    rows = []
    for c in (d.get("top_candidates") or d.get("core_candidates") or []):
        if decision and c.get("decision") != decision:
            continue
        sc = c.get("expert_score", c.get("score"))
        rows.append({
            "symbol": c.get("symbol", ""), "name": (c.get("name", "") or "").strip()[:28],
            "score": round(sc, 1) if isinstance(sc, (int, float)) else sc,
            "decision": c.get("decision", ""),
            "pe": c.get("pe_ttm"), "pb": c.get("pb"),
        })
        if len(rows) >= top:
            break
    return {"report_date": str(d.get("report_date", ""))[:10], "candidates": rows}


def main():
    ap = argparse.ArgumentParser(description="us-screener (US) skill 封装")
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("candidates")
    c.add_argument("--top", type=int, default=8)
    c.add_argument("--decision", default=None)
    sub.add_parser("report-path")
    sub.add_parser("status")
    args = ap.parse_args()

    if args.cmd == "report-path":
        p = latest_report_path()
        print(p or "(无报告 —— 项目未跑或不存在)")
    elif args.cmd == "status":
        print(json.dumps(status(), ensure_ascii=False, indent=2))
    else:
        r = top_candidates(args.top, args.decision)
        if not r:
            print("(无候选 —— 项目未跑或报告缺失)")
            return
        print(f"us-screener 美股候选（{r['report_date']}）：")
        for x in r["candidates"]:
            pe = f" PE{x['pe']:.1f}" if isinstance(x.get("pe"), (int, float)) else ""
            print(f"  · {x['name']}({x['symbol']}) 分{x['score']} [{x['decision']}]{pe}")


if __name__ == "__main__":
    main()
