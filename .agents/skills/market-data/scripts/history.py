#!/usr/bin/env python3
# ABOUTME: CLI wrapper for historical price data fetching.
# ABOUTME: Returns OHLCV data for specified period and interval.
#
# Tier-2 app: history via the data-access facade (warehouse-svc, 14yr daily),
# NOT a data-source SDK. Falls back to the legacy trading_skills package.

import argparse
import json
import os
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(__file__))
from _dataclient import to_canonical  # noqa: E402

_PERIOD_DAYS = {"1d": 1, "5d": 5, "1mo": 31, "3mo": 93, "6mo": 186, "1y": 366,
                "2y": 731, "5y": 1827, "10y": 3653, "ytd": None, "max": 36500}


def _from_date(period: str) -> str | None:
    if period == "ytd":
        return f"{date.today().year}-01-01"
    days = _PERIOD_DAYS.get(period, 31)
    return (date.today() - timedelta(days=days)).isoformat()


def via_facade(symbol: str, period: str) -> list[dict] | None:
    import data_access as data  # noqa: PLC0415
    bars = data.history(to_canonical(symbol), from_=_from_date(period))
    return bars or None


def via_legacy(symbol: str, period: str, interval: str):
    from trading_skills.history import get_history  # noqa: PLC0415
    return get_history(symbol.upper(), period, interval)


def main():
    p = argparse.ArgumentParser(description="Fetch historical price data")
    p.add_argument("symbol")
    p.add_argument("--period", default="1mo", help="1d,5d,1mo,3mo,6mo,1y,2y,5y,10y,ytd,max")
    p.add_argument("--interval", default="1d", help="(daily warehouse; intraday falls back to legacy)")
    a = p.parse_args()
    result = None
    # Daily lives in the warehouse; intraday intervals go to legacy.
    if os.environ.get("MARKET_DATA_LEGACY") != "1" and a.interval in ("1d", "5d", "1wk", "1mo"):
        try:
            result = via_facade(a.symbol, a.period)
        except Exception:  # noqa: BLE001
            result = None
    if result is None:
        result = via_legacy(a.symbol, a.period, a.interval)
    print(json.dumps(result, indent=2, ensure_ascii=False, default=str))


if __name__ == "__main__":
    main()
