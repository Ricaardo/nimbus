#!/usr/bin/env python3
"""news→nimbus 数据桥读取器。两种取数方式：
  (A) 文件桥 ~/nimbus-os/nimbus/workspace/feed/：13f-latest.json / ashare-candidates.json /
      breaking.jsonl（高频突发）。
  (B) HTTP API（news 平台 :8081）：store 捕获【全部源】(与 sink 无关) →
      可列出所有源并按源拉取最新消息。env NEWS_API 可覆盖基址。
让 nimbus 投顾能基于 news 的全部数据源推理。

用法:
  feed.py all                          文件桥(突发+13F+A股) + API 可用源清单
  feed.py sources                      列出 store 内全部源及条数(API)
  feed.py source vix-term --limit 3    取指定源最新 N 条(API)
  feed.py breaking --tickers NVDA,AAPL --hours 12
"""
import argparse, json, os, sys, time, urllib.request, urllib.parse
from datetime import datetime, timezone

FEED = os.path.expanduser(os.environ.get("NIMBUS_FEED_DIR", "~/nimbus-os/nimbus/workspace/feed"))
NEWS_API = os.environ.get("NEWS_API", "http://localhost:8081")


def api_get(path):
    try:
        with urllib.request.urlopen(f"{NEWS_API}{path}", timeout=8) as r:
            return json.load(r)
    except Exception:
        return None


def show_sources():
    """列出 store 内全部源 + 条数(让投顾知道有哪些可取)。"""
    d = api_get("/api/news?limit=1000")
    if not d:
        print("（news API 不可达；平台未运行?）"); return
    import collections
    c = collections.Counter((m.get("source") or "?") for m in (d.get("messages") or []))
    print(f"🗂 news 全部数据源（store 内 {d.get('count',0)} 条 / {len(c)} 源）")
    for s, n in c.most_common():
        print(f"  {n:3d}  {s}")


def show_source(name, limit):
    """取指定源最新 N 条。"""
    d = api_get(f"/api/news?source={urllib.parse.quote(name)}&limit={limit}")
    if d is None:
        print("（news API 不可达；平台未运行?）"); return
    msgs = d.get("messages") or []
    if not msgs:
        print(f"（源 {name} 暂无数据；用 `feed.py sources` 看可用源）"); return
    print(f"📡 {name}（最新 {len(msgs)} 条）")
    for m in msgs:
        ts = (m.get("create_time") or m.get("publish_time") or "")[:16]
        title = (m.get("title") or "").strip()
        body = (m.get("content") or "").strip().replace("\n", " ")
        print(f"  [{ts}] {title}"[:160])
        if body and body != title:
            print(f"        {body}"[:200])




def load_json(name):
    p = os.path.join(FEED, name)
    if not os.path.exists(p): return None
    try: return json.load(open(p))
    except Exception: return None


def parse_epoch(row):
    ts = row.get("epoch") or 0
    if ts:
        return ts
    raw = (row.get("ts") or "").strip()
    if not raw:
        return 0
    try:
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        return datetime.fromisoformat(raw).timestamp()
    except Exception:
        return 0


def normalize_news_event(row):
    """Return a display-friendly shape for legacy v1 and NewsEvent v2 rows."""
    summary = row.get("summary_zh") or row.get("zh") or row.get("title") or ""
    title = row.get("title") or summary
    symbols = row.get("symbols")
    if not isinstance(symbols, list):
        symbols = row.get("tickers")
    if not isinstance(symbols, list):
        symbols = []
    return {
        "version": row.get("version", 1),
        "ts": row.get("ts") or "",
        "epoch": parse_epoch(row),
        "source": row.get("source") or "?",
        "title": title,
        "summary": summary,
        "symbols": [str(s) for s in symbols if str(s).strip()],
        "link": row.get("link") or row.get("source_id") or "",
    }


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
        ev = normalize_news_event(x)
        ts = ev["epoch"]
        if ts and ts < cutoff: continue
        if tickers:
            # 只扫 标题+摘要+symbol；v1 的 tickers 常有污染，v2 的 canonical symbols 可作为补充。
            hay = (ev["title"] + " " + ev["summary"] + " " + " ".join(ev["symbols"])).upper()
            if not any(t in hay for t in tickers): continue
        rows.append(ev)
    rows = rows[-25:]
    print(f"📰 突发 feed（近{hours}h，{len(rows)} 条）")
    for x in rows:
        # v1 的 zh 和 v2 的 summary_zh 均已含方向/影响，不再叠加空 impact。
        print(f"  [{x.get('ts','?')[:16]}] {x.get('source','?')}: {x.get('summary','')}"[:170])


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
    ap.add_argument("what", nargs="?", default="all",
                    choices=["13f", "ashare", "breaking", "all", "sources", "source"])
    ap.add_argument("--source", default="", help="source 模式下的源名(或位置参数后跟源名)")
    ap.add_argument("--limit", type=int, default=5)
    ap.add_argument("--tickers", default="")
    ap.add_argument("--hours", type=int, default=24)
    # 允许 `feed.py source vix-term` 这种位置写法
    a, extra = ap.parse_known_args()
    if a.what == "source" and not a.source and extra:
        a.source = extra[0]

    if a.what == "sources":
        show_sources(); return
    if a.what == "source":
        if not a.source:
            print("用法: feed.py source <源名> [--limit N];先 `feed.py sources` 看可用源"); return
        show_source(a.source, a.limit); return

    tickers = {t.strip().upper() for t in a.tickers.split(",") if t.strip()}
    if not os.path.isdir(FEED):
        print(f"feed 目录不存在: {FEED}"); return
    if a.what in ("breaking", "all"): show_breaking(tickers, a.hours)
    if a.what in ("13f", "all"): show_13f()
    if a.what in ("ashare", "all"): show_ashare()
    if a.what == "all":
        print(); show_sources()  # API 可用源清单,投顾可据此 `feed.py source <名>` 深取


if __name__ == "__main__":
    main()
