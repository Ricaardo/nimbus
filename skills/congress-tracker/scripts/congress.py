#!/usr/bin/env python3
"""国会交易跟踪 — QuiverQuant 免费 live 端点（无需 key，披露滞后数日）。
最新 ~1000 条美众议院议员交易披露。按议员/标的筛选；成功后写本地快照，失败回退快照。
用法:
  congress.py                  # 最新值得注意
  congress.py --rep Pelosi     # 某议员(模糊)
  congress.py --ticker NVDA    # 某标的谁在动
  congress.py --top 15
"""
import argparse, json, os, sys, time, urllib.request

URL = "https://api.quiverquant.com/beta/live/congresstrading"
# 纯浏览器 UA：UA 含 bot 标记会被 WAF 401
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
SNAP = os.path.join(os.path.dirname(__file__), "..", "data", "congress_snapshot.json")


def fetch():
    last = None
    for i in range(3):
        try:
            req = urllib.request.Request(URL, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=20) as r:
                d = json.load(r)
            os.makedirs(os.path.dirname(SNAP), exist_ok=True)
            json.dump({"ts": time.time(), "data": d}, open(SNAP, "w"))
            return d, False
        except Exception as e:
            last = e; time.sleep(1.5 * (i + 1))
    # 回退快照
    if os.path.exists(SNAP):
        snap = json.load(open(SNAP))
        return snap.get("data", []), True
    print(f"获取失败且无快照: {last}", file=sys.stderr); sys.exit(1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rep", default="")
    ap.add_argument("--ticker", default="")
    ap.add_argument("--top", type=int, default=12)
    a = ap.parse_args()

    data, stale = fetch()
    rows = data
    if a.rep:
        rows = [x for x in rows if a.rep.lower() in str(x.get("Representative", "")).lower()]
    if a.ticker:
        rows = [x for x in rows if a.ticker.upper() == str(x.get("Ticker", "")).upper()]
    rows = sorted(rows, key=lambda x: x.get("ReportDate", ""), reverse=True)[: a.top]

    title = "🏛 国会交易"
    if a.rep: title += f" · {a.rep}"
    if a.ticker: title += f" · {a.ticker}"
    note = "（QuiverQuant·披露滞后数日·非投资建议" + ("·⚠快照兜底" if stale else "") + "）"
    print(title + note + "\n")
    if not rows:
        print("（无匹配；该端点为最新 ~1000 条窗口，此人/标的近期可能无披露）"); return
    for x in rows:
        act = x.get("Transaction", "?")
        emo = "🟢买" if "Purchase" in act else ("🔴卖" if "Sale" in act else act)
        exc = x.get("ExcessReturn")
        exc_s = f" | 超额{exc:+.0f}%" if isinstance(exc, (int, float)) else ""
        print(f"  {x.get('ReportDate','?')} {x.get('Representative','?')}({x.get('Party','?')}) "
              f"{emo} {x.get('Ticker','?')} {x.get('Range','?')}{exc_s}")


if __name__ == "__main__":
    main()
