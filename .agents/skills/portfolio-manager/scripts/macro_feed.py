#!/usr/bin/env python3
"""
macro_feed.py — 宏观/流动性接入（经 Go 数据网关 datagw /macro，单一 FRED 取数口）

自给自足拉真 FRED 宏观并算 fred_score(信用0.45+VIX0.35+曲线0.20)，缓存到
state/macro_cache.json，投顾读缓存。FRED 取数收敛到 Go datagw(8821)——它持有
FRED_API_KEY 并用 keyed api.stlouisfed.org，本脚本不再直连官方端点/不再需要 key。

序列：DGS10/DGS2/T10Y2Y(曲线)/DFEDTARU(联邦基金上限)/BAMLH0A0HYM2(HY利差)/
DTWEXBGS(美元)/T10YIE(通胀预期)/CPIAUCSL(CPI)/VIXCLS(VIX)。

用法：
  python3 macro_feed.py --refresh   # 拉 FRED 写缓存
  python3 macro_feed.py             # 读缓存渲染
只读，不下单。需 datagw 可达 (env DATAGW_URL，默认 http://127.0.0.1:8821)。
"""
import argparse
import datetime as dt
import json
import os
import urllib.request

HOME = os.path.expanduser("~")
_SKILLS = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # 自包含:相对脚本定位 skills 根,不依赖 ~/.claude
CACHE = f"{_SKILLS}/references/state/macro_cache.json"
TODAY = dt.date.today()
DATAGW = os.environ.get("DATAGW_URL", "http://127.0.0.1:8821")
SERIES = ["DGS10", "DGS2", "T10Y2Y", "DFEDTARU", "BAMLH0A0HYM2",
          "DTWEXBGS", "T10YIE", "CPIAUCSL", "VIXCLS"]


def _clamp(x, lo=0.0, hi=100.0):
    return max(lo, min(hi, x))


def fetch_series(sid, timeout=15):
    """返回 (latest_value, date) 或 (None, None)。经 datagw /macro;缺值为 null。"""
    url = f"{DATAGW}/macro?series={sid}&limit=1"
    try:
        d = json.loads(urllib.request.urlopen(url, timeout=timeout).read())
        obs = (d.get("data") or {}).get("observations", [])
        for o in reversed(obs):  # ascending → newest last; take newest non-null
            if o.get("value") is not None:
                return float(o["value"]), o.get("date")
    except Exception as e:
        print(f"[warn] {sid} 拉取失败: {str(e)[:50]}")
    return None, None


def _score(hy, vix, curve):
    """复刻 ah-screener 风险偏好评分思路(可解释)。"""
    comp = {}
    if hy is not None:
        comp["credit"] = _clamp(90 - (hy - 2.5) * 20)        # 利差窄=高
    if vix is not None:
        comp["vix"] = _clamp(100 - (vix - 12) * 3.5)         # VIX低=高
    if curve is not None:
        comp["curve"] = _clamp(50 + curve * 40)              # 曲线正=高
    w = {"credit": 0.45, "vix": 0.35, "curve": 0.20}
    use = {k: v for k, v in comp.items() if v is not None}
    if not use:
        return None, "neutral", comp
    tot = sum(w[k] for k in use)
    s = round(sum(use[k] * w[k] for k in use) / tot, 1)
    regime = "risk_on" if s >= 60 else ("risk_off" if s <= 42 else "neutral")
    return s, regime, {k: round(v) for k, v in comp.items()}


def refresh():
    """经 datagw /macro 拉序列、算分、写缓存。成功返回 dict，否则 None。"""
    vals, as_of = {}, None
    for sid in SERIES:
        v, d = fetch_series(sid)
        vals[sid] = v
        if d and (as_of is None or d > as_of):
            as_of = d
    if all(v is None for v in vals.values()):
        return None
    score, regime, comp = _score(
        vals["BAMLH0A0HYM2"], vals["VIXCLS"], vals["T10Y2Y"])
    snap = {
        "as_of": as_of or TODAY.isoformat(),
        "fred_score": score, "regime": regime, "components": comp,
        "series": {
            "10Y": vals["DGS10"], "2Y": vals["DGS2"], "curve_10y2y": vals["T10Y2Y"],
            "fed_funds_upper": vals["DFEDTARU"], "hy_spread": vals["BAMLH0A0HYM2"],
            "dollar_broad": vals["DTWEXBGS"], "breakeven_10y": vals["T10YIE"],
            "cpi": vals["CPIAUCSL"], "vix": vals["VIXCLS"],
        },
    }
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    with open(CACHE, "w") as f:
        json.dump(snap, f, ensure_ascii=False, indent=2)
    return snap


def load():
    try:
        with open(CACHE) as f:
            return json.load(f)
    except Exception:
        return None


def render(snap):
    if snap is None:
        return ("宏观/流动性：无缓存 —— 跑 `macro_feed.py --refresh`"
                "（或等 ah-screener 定时刷新；经 datagw 取 FRED）")
    s = snap.get("series", {})
    age = ""
    try:
        d = (TODAY - dt.date.fromisoformat(snap["as_of"])).days
        if d > 5:
            age = f" ⚠{d}天前"
    except Exception:
        pass
    score = snap.get("fred_score")
    sc = f"FRED 宏观分 **{score}**" if score is not None else "FRED 分 N/A"
    def f(x, suf=""):
        return f"{x}{suf}" if x is not None else "—"
    return (f"宏观/流动性（FRED{age}）：{sc} · regime {snap.get('regime') or '—'}\n"
            f"  · 10Y {f(s.get('10Y'),'%')} · 2Y {f(s.get('2Y'),'%')} · "
            f"曲线10Y-2Y {f(s.get('curve_10y2y'))} · 联邦基金上限 {f(s.get('fed_funds_upper'),'%')}\n"
            f"  · 高收益利差 {f(s.get('hy_spread'))} · 美元指数 {f(s.get('dollar_broad'))} · "
            f"10Y通胀预期 {f(s.get('breakeven_10y'),'%')}")


def main():
    ap = argparse.ArgumentParser(description="宏观接入(ah-screener FRED)")
    ap.add_argument("--refresh", action="store_true", help="触发 venv 拉取写缓存")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    snap = refresh() if args.refresh else load()
    if args.refresh and snap is None:
        snap = load()       # 拉取失败回退旧缓存
    print(json.dumps(snap, ensure_ascii=False, indent=2) if args.json else render(snap))


if __name__ == "__main__":
    main()
