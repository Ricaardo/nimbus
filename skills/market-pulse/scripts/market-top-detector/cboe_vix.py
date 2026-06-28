#!/usr/bin/env python3
"""VIX 期限结构 —— 经 Go 数据网关 (datagw /cboe-quote) 取 Cboe 官方免费报价。

返回结构与原 FMPClient.get_vix_term_structure 一致:
    {"vix", "vix3m", "ratio", "classification"}
classification ∈ {steep_contango, contango, flat, backwardation}
环境: DATAGW_URL (默认 http://127.0.0.1:8821; datagw 是单一 Cboe 取数口)
"""
import json
import os
import urllib.parse
import urllib.request

DATAGW = os.environ.get("DATAGW_URL", "http://127.0.0.1:8821")


def _price(sym: str) -> float | None:
    url = f"{DATAGW}/cboe-quote?" + urllib.parse.urlencode({"symbol": sym})
    try:
        with urllib.request.urlopen(url, timeout=15) as r:
            return (json.load(r).get("data") or {}).get("current_price")
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
