#!/usr/bin/env python3
# ABOUTME: CLI wrapper for stock quote fetching.
# ABOUTME: Outputs JSON with price, volume, and key metrics.
#
# Tier-2 app: fetches via the data-access facade (realtime Futu behind it), NOT a
# data-source SDK. Falls back to the legacy trading_skills package if the facade
# is unreachable. See docs/nimbus-os-decoupling-plan.md (§4.8).

import json
import os
import re
import sys

sys.path.insert(0, "/Users/x/nimbus-os/services/data-access")


def to_canonical(tok: str) -> str:
    """AAPL -> US:AAPL ; 00700.HK -> HK:00700 ; 600519.SH/.SS -> CN:600519 ; US.AAPL -> US:AAPL."""
    t = tok.strip().upper()
    if ":" in t:
        return t
    m = re.match(r"^(US|HK|SH|SZ)\.(.+)$", t)  # futu format
    if m:
        mk, loc = m.group(1), m.group(2)
        return {"US": f"US:{loc}", "HK": f"HK:{loc.zfill(5)}", "SH": f"CN:{loc}", "SZ": f"CN:{loc}"}[mk]
    m = re.match(r"^(\d{4,5})\.HK$", t)
    if m:
        return f"HK:{m.group(1).zfill(5)}"
    m = re.match(r"^(\d{6})\.(SH|SS|SZ)$", t)
    if m:
        return f"CN:{m.group(1)}"
    if re.match(r"^[A-Z]{1,6}([.\-][A-Z])?$", t):
        return f"US:{t}"
    return f"US:{t}"


def via_facade(symbols):
    import data_access as data  # noqa: PLC0415
    canon = [to_canonical(s) for s in symbols]
    rows = data.quote(*canon)
    if not rows:
        return None
    return rows


def via_legacy(symbols):
    from trading_skills.quote import get_quote  # noqa: PLC0415
    return [get_quote(s.upper()) for s in symbols]


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: quote.py SYMBOL [SYMBOL ...]"}))
        sys.exit(1)
    symbols = sys.argv[1:]
    result = None
    if os.environ.get("MARKET_DATA_LEGACY") != "1":
        try:
            result = via_facade(symbols)
        except Exception:  # noqa: BLE001 — fall back to legacy
            result = None
    if result is None:
        result = via_legacy(symbols)
    print(json.dumps(result, indent=2, ensure_ascii=False, default=str))


if __name__ == "__main__":
    main()
