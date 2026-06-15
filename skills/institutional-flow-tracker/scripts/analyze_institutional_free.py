#!/usr/bin/env python3
"""个股机构资金信号(全免费,自包含)。

替代已失效的 FMP v3 版(analyze_single_stock.py / track_institutional_flow.py)。
FMP 免费档已不再提供逐机构持仓明细(institutional-holder 付费);任何免费源都没有
"个股×逐机构"明细。本脚本用免费可得的【聚合信号】:
  - Finviz:机构持股 %(Inst Own)+ 机构季度买卖方向 %(Inst Trans)+ 内部人持股 %
  - FMP stable:公司简介(行业/市值,免费)

跨大师"谁在买同一只票"的共识视角 → 用 news/scripts/superinvestors.py(SEC EDGAR 13F)。

用法: python3 analyze_institutional_free.py NVDA [--json]
"""
import argparse
import json
import os
import re
import sys
import urllib.request

FINVIZ = "https://finviz.com/quote.ashx?t={sym}"
FMP_PROFILE = "https://financialmodelingprep.com/stable/profile?symbol={sym}&apikey={key}"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120 Safari/537.36")


def _get(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read().decode("utf-8", "replace")


def _pct(s: str):
    try:
        return float(s.replace("%", "").strip())
    except (ValueError, AttributeError):
        return None


def finviz_signal(sym: str) -> dict:
    """抓 Finviz snapshot 表的机构/内部人字段。"""
    html = _get(FINVIZ.format(sym=sym))
    # snapshot 表是成对的 <td>label</td><td>value</td>
    cells = re.findall(r"<td[^>]*>(.*?)</td>", html, re.S)
    cells = [re.sub(r"<[^>]+>", "", c).strip() for c in cells]
    kv = {cells[i]: cells[i + 1] for i in range(0, len(cells) - 1)}
    return {
        "inst_own_pct": _pct(kv.get("Inst Own", "")),
        "inst_trans_pct": _pct(kv.get("Inst Trans", "")),
        "insider_own_pct": _pct(kv.get("Insider Own", "")),
        "insider_trans_pct": _pct(kv.get("Insider Trans", "")),
    }


def fmp_profile(sym: str) -> dict:
    key = os.environ.get("FMP_API_KEY", "")
    if not key:
        return {}
    try:
        data = json.loads(_get(FMP_PROFILE.format(sym=sym, key=key)))
        if isinstance(data, list) and data:
            p = data[0]
            return {"name": p.get("companyName"), "sector": p.get("sector"),
                    "industry": p.get("industry"), "marketCap": p.get("marketCap")}
    except Exception:  # noqa: BLE001
        pass
    return {}


def read(sig: dict) -> str:
    own, trans = sig.get("inst_own_pct"), sig.get("inst_trans_pct")
    if own is None:
        return "数据不足"
    parts = []
    if own >= 80:
        parts.append("机构高度持有(>80%,拥挤,警惕踩踏)")
    elif own >= 50:
        parts.append("机构主导持有")
    elif own < 25:
        parts.append("机构持有偏低(散户盘/早期)")
    if trans is not None:
        if trans > 1:
            parts.append(f"上季机构净增持 +{trans:.1f}%(吸筹)")
        elif trans < -1:
            parts.append(f"上季机构净减持 {trans:.1f}%(派发)")
        else:
            parts.append("机构持仓基本持平")
    return " · ".join(parts) or "中性"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("symbol")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    sym = args.symbol.upper()

    try:
        sig = finviz_signal(sym)
    except Exception as e:  # noqa: BLE001
        print(f"ERROR: Finviz 抓取失败 {sym}: {e}", file=sys.stderr)
        return 1
    prof = fmp_profile(sym)

    if args.json:
        print(json.dumps({"symbol": sym, **prof, **sig, "read": read(sig)},
                         ensure_ascii=False))
        return 0

    name = prof.get("name") or sym
    L = [f"🏦 {sym} {name} · 机构资金信号(免费聚合)"]
    if prof.get("sector"):
        mc = prof.get("marketCap") or 0
        L.append(f"   {prof.get('sector')} / {prof.get('industry')}  市值 ${mc/1e9:.0f}B")
    L.append(f"   机构持股: {sig['inst_own_pct']}%   季度机构买卖: {sig['inst_trans_pct']}%")
    if sig.get("insider_own_pct") is not None:
        L.append(f"   内部人持股: {sig['insider_own_pct']}%")
    L.append(f"   解读: {read(sig)}")
    L.append("   注:逐机构持仓明细为付费数据;跨大师 13F 共识见 superinvestors。")
    print("\n".join(L))
    return 0


if __name__ == "__main__":
    sys.exit(main())
