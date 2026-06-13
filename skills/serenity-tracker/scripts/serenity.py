#!/usr/bin/env python3
"""白毛股神 Serenity (@aleabitoreddit) 持仓观点 — 解析 followserenity.com Thesis Tracker。
数据在 HTML <tr> 表格行（移植自 btcdca 小程序解析逻辑）。成功写快照，失败回退。
用法: serenity.py [--ticker NVDA] [--top 15]
"""
import argparse, html, json, os, re, sys, time, urllib.request

URL = "https://www.followserenity.com/"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
SNAP = os.path.join(os.path.dirname(__file__), "..", "data", "snapshot.json")

ROW_RE = re.compile(r'<tr class="[^"]*">([\s\S]*?)</tr>')
RET_RE = re.compile(r'<span class="tabular-nums font-medium [^"]*">([\s\S]*?)</span>')
BADGE_RE = re.compile(r'<span class="badge[^"]*">([\s\S]*?)</span>')
XURL_RE = re.compile(r'href="(https://x\.com/[^"]+)"')


def clean(s):
    if not s: return ""
    s = re.sub(r"<[^>]+>", "", s)
    return html.unescape(s).strip()


def between(raw, a, b):
    i = raw.find(a)
    if i < 0: return ""
    i += len(a); j = raw.find(b, i)
    return raw[i:j] if j >= 0 else ""


def parse(html_text):
    rows = []
    for m in ROW_RE.finditer(html_text):
        row = m.group(1)
        if "ticker-link" not in row: continue
        ticker = clean(between(row, '<span class="font-semibold text-slate-900">', "</span>"))
        if not ticker: continue
        company = clean(between(row, '<span class="text-xs text-slate-400 ml-1.5">', "</span>"))
        rm = RET_RE.search(row)
        ret = clean(rm.group(1)) if rm else "--"
        badges = [clean(b.group(1)) for b in BADGE_RE.finditer(row)]
        thesis = clean(between(row, '<p class="text-sm text-slate-700 truncate max-w-[300px]">', "</p>"))
        xm = XURL_RE.search(row)
        rows.append({"ticker": ticker, "company": company, "return": ret,
                     "conviction": badges[0] if badges else "", "thesis": thesis or "—",
                     "url": html.unescape(xm.group(1)) if xm else ""})
    return rows


def fetch():
    for i in range(3):
        try:
            req = urllib.request.Request(URL, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=25) as r:
                rows = parse(r.read().decode("utf-8", "ignore"))
            if rows:
                json.dump({"ts": time.time(), "rows": rows}, open(SNAP, "w"), ensure_ascii=False)
                return rows, False
        except Exception:
            time.sleep(2)
    if os.path.exists(SNAP):
        return json.load(open(SNAP)).get("rows", []), True
    return [], True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ticker", default="")
    ap.add_argument("--top", type=int, default=15)
    a = ap.parse_args()
    os.makedirs(os.path.dirname(SNAP), exist_ok=True)
    rows, stale = fetch()
    if not rows:
        print("获取失败且无快照", file=sys.stderr); sys.exit(1)
    if a.ticker:
        rows = [r for r in rows if r["ticker"].upper() == a.ticker.upper()]
    note = "⚠快照兜底" if stale else ""
    print(f"🐺 白毛股神 Serenity 持仓观点（followserenity·公开帖抽取·非真实13F·非投资建议{note}）")
    print(f"共 {len(rows)} 条 thesis\n")
    for r in rows[: a.top]:
        co = f" {r['company']}" if r['company'] else ""
        cv = f" [{r['conviction']}]" if r['conviction'] else ""
        print(f"  ${r['ticker']}{co} {r['return']}{cv}")
        if r['thesis'] and r['thesis'] != "—":
            print(f"     {r['thesis'][:90]}")


if __name__ == "__main__":
    main()
