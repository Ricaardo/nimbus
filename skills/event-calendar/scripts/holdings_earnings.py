#!/usr/bin/env python3
"""
holdings_earnings.py — 持仓财报日（供 briefing 自动填充"本周事件"）

读 L1 portfolio_state.json 的持仓 → 查每只下次财报日（yfinance）→ 列出临近财报。
带**缓存**(默认 3 天)避免 yf 限频；失败优雅降级。

用法：python3 holdings_earnings.py [--within 14] [--json]
只读，不下单。
"""
import argparse
import datetime as dt
import json
import os
import sys
import time

HOME = os.path.expanduser("~")
STATE = f"{HOME}/.claude/skills/references/state/portfolio_state.json"
CACHE = f"{HOME}/.claude/skills/references/state/earnings_cache.json"
CACHE_TTL_DAYS = 3
TODAY = dt.date.today()


def yf_ticker(code):
    """futu code → yfinance ticker。US.AVGO→AVGO；HK.00700→0700.HK；期权返回 None。"""
    s = str(code).upper()
    if "." in s:
        a, b = s.split(".", 1)
        mkt, sym = (a, b) if a in ("US", "HK", "SG", "JP", "CN") else (b, a)
    else:
        mkt, sym = "US", s
    if any(ch.isdigit() for ch in sym) and any(c in sym for c in "CP") and len(sym) > 8:
        return None                                    # 期权
    if mkt == "HK" and sym.isdigit():
        return sym.lstrip("0").zfill(4) + ".HK"        # 700→0700.HK, 02359→2359.HK
    if mkt == "US" or not sym.isdigit():
        return sym
    return None                                        # 其它市场暂不查


def load_cache():
    try:
        with open(CACHE) as f:
            return json.load(f)
    except Exception:
        return {}


def save_cache(c):
    try:
        with open(CACHE, "w") as f:
            json.dump(c, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[warn] 写缓存失败: {e}", file=sys.stderr)


def fresh(entry):
    try:
        age = (TODAY - dt.date.fromisoformat(entry["fetched"])).days
        return age <= CACHE_TTL_DAYS
    except Exception:
        return False


def next_earnings(tic, cache, retries=2):
    """返回下次财报日 isoformat 或 None。优先缓存，快速降级。"""
    if tic in cache and fresh(cache[tic]):
        return cache[tic]["date"]
    import pandas as pd
    import yfinance as yf
    for i in range(retries):
        try:
            cal = yf.Ticker(tic).get_earnings_dates(limit=8)
            if cal is not None and len(cal):
                now = pd.Timestamp.now(tz=cal.index.tz)
                fut = cal[cal.index > now]
                date = fut.index.min().date().isoformat() if len(fut) else None
                cache[tic] = {"date": date, "fetched": TODAY.isoformat()}
                return date
        except Exception as e:
            print(f"[warn] {tic} 财报重试 {i+1}: {str(e)[:50]}", file=sys.stderr)
        if i < retries - 1:
            time.sleep(2)
    return cache.get(tic, {}).get("date")              # 退回旧缓存(若有)


def build(within=14):
    try:
        with open(STATE) as f:
            st = json.load(f)
    except Exception:
        return None
    cache = load_cache()
    rows, degraded = [], 0
    seen = set()
    for p in st.get("positions", []):
        if p.get("is_option") or p.get("weight_pct", 0) < 0.5:
            continue
        tic = yf_ticker(p["code"])
        if not tic or tic in seen:
            continue
        seen.add(tic)
        date = next_earnings(tic, cache)
        if date is None:
            degraded += 1
            rows.append({"ticker": tic, "name": p["name"], "date": None, "days": None})
            continue
        days = (dt.date.fromisoformat(date) - TODAY).days
        rows.append({"ticker": tic, "name": p["name"], "date": date, "days": days})
    save_cache(cache)
    rows.sort(key=lambda r: (r["days"] is None, r["days"]))
    return {"within": within, "rows": rows, "degraded": degraded}


def render(r):
    if r is None:
        return "本周事件：无法读 L1 state → 先跑 portfolio_state.py"
    near = [x for x in r["rows"] if x["days"] is not None and 0 <= x["days"] <= r["within"]]
    L = []
    if near:
        L.append(f"本周/近 {r['within']} 天财报：")
        for x in near:
            L.append(f"  · {x['name'][:10]} ({x['ticker']}) — {x['date']} ({x['days']}天后)⚠")
    else:
        L.append(f"近 {r['within']} 天无持仓财报。")
    others = [x for x in r["rows"] if x["date"] and (x["days"] is None or x["days"] > r["within"])]
    if others:
        L.append("  其余下次财报：" + " · ".join(
            f"{x['ticker']} {x['date']}" for x in others[:6]))
    if r["degraded"]:
        L.append(f"  ⚠{r['degraded']} 只财报日未取到（yf 限频，缓存空）")
    return "\n".join(L)


def main():
    ap = argparse.ArgumentParser(description="持仓财报日")
    ap.add_argument("--within", type=int, default=14)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    r = build(args.within)
    print(json.dumps(r, ensure_ascii=False, indent=2) if args.json else render(r))


if __name__ == "__main__":
    main()
