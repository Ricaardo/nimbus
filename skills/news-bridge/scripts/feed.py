#!/usr/bin/env python3
"""news→nimbus 数据桥读取器。读 ~/nimbus/workspace/feed/ 下 news 平台落盘的结构化数据：
  13f-latest.json     机构 13F 当前持仓/变动
  ashare-candidates.json  A 股扫描候选
  breaking.jsonl      实时突发(trump/bwe/finnhub，近 24h，append)
让 nimbus 投顾能基于 news 的 feed 推理。
用法: feed.py [13f|ashare|breaking|all] [--tickers NVDA,AAPL] [--hours 24]
"""
import argparse, json, os, sys, time
from datetime import datetime, timezone

FEED = os.path.expanduser("~/nimbus/workspace/feed")


def load_json(name):
    p = os.path.join(FEED, name)
    if not os.path.exists(p): return None
    try: return json.load(open(p))
    except Exception: return None


def show_breaking(tickers, hours):
    p = os.path.join(FEED, "breaking.jsonl")
    if not os.path.exists(p): print("（无 breaking feed；news filefeed 未启用或暂无数据）"); return
    cutoff = time.time() - hours * 3600
    rows = []
    for line in open(p, encoding="utf-8", errors="ignore"):
        line = line.strip()
        if not line: continue
        try: x = json.loads(line)
        except Exception: continue
        ts = x.get("epoch") or 0
        if ts and ts < cutoff: continue
        if tickers and not (set(t.upper() for t in x.get("tickers", [])) & tickers): continue
        rows.append(x)
    rows = rows[-25:]
    print(f"📰 突发 feed（近{hours}h，{len(rows)} 条）")
    for x in rows:
        tk = ",".join(x.get("tickers", [])) or "-"
        print(f"  [{x.get('ts','?')[:16]}] {x.get('source','?')} {x.get('impact','')} {tk}: {x.get('zh') or x.get('title','')}"[:160])


def show_13f():
    d = load_json("13f-latest.json")
    if not d: print("（无 13f feed）"); return
    print(f"🏛 机构 13F（更新 {d.get('updated','?')}）")
    for f in d.get("funds", []):
        print(f"  {f.get('name','?')} | {f.get('period','?')} | {f.get('total','?')} | top: " +
              ", ".join(f.get('top', [])[:5]))


def show_ashare():
    d = load_json("ashare-candidates.json")
    if not d: print("（无 A股候选 feed）"); return
    print(f"📊 A股扫描候选（更新 {d.get('updated','?')}）")
    for c in d.get("candidates", [])[:15]:
        print(f"  {c}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("what", nargs="?", default="all", choices=["13f", "ashare", "breaking", "all"])
    ap.add_argument("--tickers", default="")
    ap.add_argument("--hours", type=int, default=24)
    a = ap.parse_args()
    tickers = {t.strip().upper() for t in a.tickers.split(",") if t.strip()}
    if not os.path.isdir(FEED):
        print(f"feed 目录不存在: {FEED}"); return
    if a.what in ("breaking", "all"): show_breaking(tickers, a.hours)
    if a.what in ("13f", "all"): show_13f()
    if a.what in ("ashare", "all"): show_ashare()


if __name__ == "__main__":
    main()
