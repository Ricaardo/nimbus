#!/usr/bin/env python3
"""VIX 期限结构 —— Cboe 官方免费源(替代已付费失效的 FMP ^VIX3M)。

返回结构与原 FMPClient.get_vix_term_structure 一致:
    {"vix", "vix3m", "ratio", "classification"}
classification ∈ {steep_contango, contango, flat, backwardation}
"""
import json
import urllib.request

CBOE = "https://cdn.cboe.com/api/global/delayed_quotes/quotes/{}.json"


def _price(sym: str) -> float | None:
    try:
        req = urllib.request.Request(CBOE.format(sym), headers={"User-Agent": "market-pulse vix"})
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.load(r).get("data", {}).get("current_price")
    except Exception:  # noqa: BLE001
        return None


def get_vix_term_structure() -> dict | None:
    vix, vix3m = _price("_VIX"), _price("_VIX3M")
    if not vix or not vix3m or vix3m <= 0:
        return None
    ratio = vix / vix3m
    if ratio < 0.85:
        classification = "steep_contango"
    elif ratio < 0.95:
        classification = "contango"
    elif ratio <= 1.05:
        classification = "flat"
    else:
        classification = "backwardation"
    return {"vix": round(vix, 2), "vix3m": round(vix3m, 2),
            "ratio": round(ratio, 3), "classification": classification}
