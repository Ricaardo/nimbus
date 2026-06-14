#!/usr/bin/env python3
"""
screener.py — equity-screener 项目的 A/H skill 封装（薄接口）

数仓本体（DuckDB ah_screener.duckdb + 自建多因子模型 + 回测）在
~/nimbus-stack/equity-screener，自带 venv/CLI/launchd。本封装让它的 A/H 选股成为
可发现、可调用的 skill：读候选、给报告路径。读为主、安全。美股见 us-screener。

用法：
  python3 screener.py candidates [--top 8] [--decision core_candidate]   # 看今日 A/H 候选
  python3 screener.py report-path                                        # 最新报告绝对路径
  python3 screener.py status                                             # 项目可用性/报告新鲜度
库用法：from screener import latest_report_path, load_report
"""
import argparse
import datetime as dt
import json
import os

PROJECT_ROOT = os.path.expanduser("~/nimbus-stack/equity-screener")  # A/H 数仓本体
REPORT_LATEST = os.path.join(PROJECT_ROOT, "reports", "ah-screening-report-latest.json")
VENV_PY = os.path.join(PROJECT_ROOT, ".venv", "bin", "python")
TODAY = dt.date.today()
MKT = {"a": "A", "hk": "HK"}


def latest_report_path():
    """最新报告 JSON 绝对路径；项目/报告缺失 → None（消费方据此降级）。"""
    return REPORT_LATEST if os.path.exists(REPORT_LATEST) else None


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
    for c in (d.get("core_candidates") or []):
        if decision and c.get("decision") != decision:
            continue
        sc = c.get("score")
        rows.append({
            "market": MKT.get(str(c.get("market", "")).lower(), str(c.get("market", ""))),
            "symbol": c.get("symbol", ""), "name": c.get("name", ""),
            "score": round(sc, 1) if isinstance(sc, (int, float)) else sc,
        })
        if len(rows) >= top:
            break
    return {"report_date": str(d.get("report_date", ""))[:10], "candidates": rows,
            "top_actions": (d.get("top_actions") or [])[:top]}


def main():
    ap = argparse.ArgumentParser(description="ah-screener (A/H) skill 封装")
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
        print(f"ah-screener A/H 候选（{r['report_date']}）：")
        for x in r["candidates"]:
            print(f"  · [{x['market']}] {x['name']}({x['symbol']}) 分{x['score']}")


if __name__ == "__main__":
    main()
