#!/usr/bin/env python3
"""hot-tickers — 网络热门标的借鉴 (idea reference, 非交易信号/NFA).

聚合 3 个免费源,看"网上最近在热议哪些票":
  1. ApeWisdom     — Reddit(WSB/stocks/…) ticker 提及聚合:排名 + 提及数 + 24h 动量
  2. StockTwits    — 交易者社区 trending symbols + 关注数
  3. followserenity — 白毛股神(@aleabitoreddit)的瓶颈论小盘观点篮子(1 个网红源)

跨源去重 + 复合热度打分(多源同时上榜 = 更热)。仅 idea 借鉴,不是交易信号。

用法:
  hot_tickers.py                      # 跨源热度榜 top 20
  hot_tickers.py --top 30
  hot_tickers.py --ticker NVDA        # 某票在各源的热度信号
  hot_tickers.py --source apewisdom   # 只看单一源原始榜 (apewisdom|stocktwits|serenity)
"""
import argparse, html, json, os, re, sys, time, urllib.request

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
DATA = os.path.join(os.path.dirname(__file__), "..", "data")


def _get(url, timeout=15):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def _snap(name, data=None):
    """非空 data 则落盘并回传;空结果或 None 则回退本地快照([] on miss)。
    空不覆盖已有快照——单源临时抓空时仍能吃到上次的好数据。"""
    p = os.path.join(DATA, f"snap_{name}.json")
    if data:
        try:
            os.makedirs(DATA, exist_ok=True)
            with open(p, "w") as f:
                json.dump({"ts": time.time(), "data": data}, f, ensure_ascii=False)
        except Exception:
            pass
        return data
    try:
        with open(p) as f:
            return json.load(f).get("data", [])
    except Exception:
        return []


# ── source 1: ApeWisdom (Reddit 提及聚合) ─────────────────────────────────────
def src_apewisdom():
    try:
        d = json.loads(_get("https://apewisdom.io/api/v1.0/filter/all-stocks/page/1"))
        out = []
        for x in d.get("results", []):
            try:  # 单条坏记录(如 rank 非数字)不拖垮整源
                tk = (x.get("ticker") or "").upper().strip()
                if not tk:
                    continue
                m = x.get("mentions") or 0
                m0 = x.get("mentions_24h_ago") or 0
                out.append({"ticker": tk, "rank": int(x.get("rank") or 0), "mentions": m,
                            "mom": round((m - m0) / m0 * 100) if m0 else None})
            except Exception:
                continue
        return _snap("apewisdom", out)
    except Exception as e:
        sys.stderr.write(f"apewisdom fail: {e}\n")
        return _snap("apewisdom")


# ── source 2: StockTwits (交易者社区 trending) ────────────────────────────────
def src_stocktwits():
    try:
        d = json.loads(_get("https://api.stocktwits.com/api/2/trending/symbols.json"))
        out = []
        for x in d.get("symbols", []):
            tk = (x.get("symbol") or "").upper().strip()
            if tk:  # rank 按过滤后位次,跳过空 symbol 不留空档
                out.append({"ticker": tk, "rank": len(out) + 1, "title": x.get("title") or "",
                            "watchers": x.get("watchlist_count") or 0})
        return _snap("stocktwits", out)
    except Exception as e:
        sys.stderr.write(f"stocktwits fail: {e}\n")
        return _snap("stocktwits")


# ── source 3: followserenity (瓶颈论网红观点) ─────────────────────────────────
_ROW = re.compile(r'<tr class="[^"]*">([\s\S]*?)</tr>')
_RET = re.compile(r'<span class="tabular-nums font-medium [^"]*">([\s\S]*?)</span>')
_BADGE = re.compile(r'<span class="badge[^"]*">([\s\S]*?)</span>')


def _clean(s):
    return html.unescape(re.sub(r"<[^>]+>", "", s or "")).strip()


def _between(raw, a, b):
    i = raw.find(a)
    if i < 0:
        return ""
    i += len(a)
    j = raw.find(b, i)
    return raw[i:j] if j >= 0 else ""


def src_serenity():
    try:
        t = _get("https://www.followserenity.com/", timeout=25)
        out = []
        for m in _ROW.finditer(t):
            row = m.group(1)
            if "ticker-link" not in row:
                continue
            tk = _clean(_between(row, '<span class="font-semibold text-slate-900">', "</span>"))
            if not tk:
                continue
            rm = _RET.search(row)
            bm = _BADGE.search(row)
            out.append({"ticker": tk.upper(),
                        "company": _clean(_between(row, '<span class="text-xs text-slate-400 ml-1.5">', "</span>")),
                        "ret": _clean(rm.group(1)) if rm else "",
                        "conviction": _clean(bm.group(1)) if bm else "",
                        "thesis": _clean(_between(row, '<p class="text-sm text-slate-700 truncate max-w-[300px]">', "</p>"))})
        return _snap("serenity", out)
    except Exception as e:
        sys.stderr.write(f"serenity fail: {e}\n")
        return _snap("serenity")


# ── 聚合 ──────────────────────────────────────────────────────────────────────
_TICKER_RE = re.compile(r"^[A-Z]{1,5}$")  # 美股 ticker 形状


def aggregate():
    aw = {x["ticker"]: x for x in src_apewisdom()}
    st = {x["ticker"]: x for x in src_stocktwits()}
    se = {x["ticker"]: x for x in src_serenity()}
    rows = []
    for tk in set(aw) | set(st) | set(se):
        if not _TICKER_RE.match(tk):
            continue  # 滤掉 followserenity 的外股代码/公司名(0189 HK / SAMSUNG…),它们跨不了源;原始篮子看 --source serenity
        a, s, e = aw.get(tk), st.get(tk), se.get(tk)
        srcs = sum(x is not None for x in (a, s, e))
        score = 0.0
        if a:
            score += max(0, 101 - (a["rank"] or 101))          # 0..100 by Reddit rank
            if a["mom"] and a["mom"] > 0:
                score += min(a["mom"], 300) / 15                # 24h 提及动量加成(封顶)
        if s:
            score += max(0, 31 - s["rank"]) / 30 * 100          # 0..100 by StockTwits rank
        if e:
            score += 40                                         # 网红观点在榜权重
        score *= 1 + 0.4 * (srcs - 1)                           # 跨源乘子:多源共振=更热
        rows.append({"ticker": tk, "score": round(score, 1), "srcs": srcs, "aw": a, "st": s, "se": e})
    rows.sort(key=lambda r: (-r["score"], r["ticker"]))
    return rows


def _why(r):
    b = []
    if r["aw"]:
        mom = r["aw"]["mom"]
        s = f"Reddit#{r['aw']['rank']}({r['aw']['mentions']}提及"
        if mom is not None:
            s += f",{'+' if mom >= 0 else ''}{mom}%/24h"
        b.append(s + ")")
    if r["st"]:
        w = r["st"]["watchers"]
        b.append(f"StockTwits#{r['st']['rank']}" + (f"({w:,}关注)" if w else ""))
    if r["se"]:
        cv = f"[{r['se']['conviction']}]" if r["se"]["conviction"] else ""
        rt = f" {r['se']['ret']}" if r["se"]["ret"] else ""
        b.append(f"白毛{cv}{rt}")
    return " · ".join(b)


def main():
    ap = argparse.ArgumentParser(description="网络热门标的借鉴 (NFA)")
    ap.add_argument("--ticker", default="")
    ap.add_argument("--top", type=int, default=20)
    ap.add_argument("--source", default="", choices=["", "apewisdom", "stocktwits", "serenity"])
    a = ap.parse_args()

    if a.source:
        fn = {"apewisdom": src_apewisdom, "stocktwits": src_stocktwits, "serenity": src_serenity}[a.source]
        data = fn()
        print(f"📡 {a.source} 原始榜（{len(data)} 条 · idea 借鉴 · 非交易信号/NFA）\n")
        for x in data[: a.top]:
            print("  " + json.dumps(x, ensure_ascii=False))
        return

    rows = aggregate()
    if not rows:
        print("三源均获取失败且无快照", file=sys.stderr)
        sys.exit(1)

    if a.ticker:
        tk = a.ticker.upper().lstrip("$")
        hit = next((r for r in rows if r["ticker"] == tk), None)
        if not hit:
            print(f"${tk} 当前不在任何热榜（未上榜 ≠ 冷门,只是这三源近期没在热议它）。")
            return
        print(f"🔥 ${tk} 网络热度（{hit['srcs']}/3 源 · 非交易信号/NFA）\n  {_why(hit)}")
        return

    print("🔥 网络热门标的（ApeWisdom·StockTwits·followserenity 聚合 · idea 借鉴 · 非交易信号/NFA）")
    print(f"覆盖 {len(rows)} 只（跨源去重）· 多源同时上榜=更热\n")
    for i, r in enumerate(rows[: a.top], 1):
        print(f"{i:2}. ${r['ticker']:<6} 热度{r['score']:.0f} [{r['srcs']}源]  {_why(r)}")
    print("\n⚠️ 仅反映社媒/散户讨论热度,非基本面、非交易信号。热 ≠ 该买;不照抄下单;NFA。")


if __name__ == "__main__":
    main()
