"""Facade-backed drop-in for the legacy market-data client (Tier-1).

Same FMPClient surface the macro-regime detector uses, but data comes from the
data-access facade (history + FRED macro) — no direct vendor/data-source access
(enforced by check-tier-boundary.sh §2.5/§4.8/§4.9).
"""
import sys

sys.path.insert(0, "/Users/x/nimbus-os/services/data-access")


def _canonical(sym: str) -> str:
    s = str(sym).strip().upper()
    if ":" in s or s.startswith("^") or "=" in s or "-" in s:
        return s
    return f"US:{s}"


class FMPClient:
    """Drop-in for the old market-data client, backed by the data-access facade."""

    def __init__(self, api_key=None, max_api_calls: int = 200):
        self.api_key = api_key  # accepted for back-compat; unused
        self.max_api_calls = max_api_calls
        self.api_calls_made = 0
        self.rate_limit_reached = False
        self.cache: dict = {}

    def _bars(self, symbol: str, limit: int) -> list[dict]:
        key = f"bars_{symbol}_{limit}"
        if key in self.cache:
            return self.cache[key]
        import data_access as data  # noqa: PLC0415

        self.api_calls_made += 1
        try:
            bars = data.history(_canonical(symbol), limit=limit) or []
        except Exception:  # noqa: BLE001
            bars = []
        self.cache[key] = bars
        return bars

    def get_historical_prices(self, symbol: str, days: int = 365):
        bars = self._bars(symbol, max(days, 1))
        if not bars:
            return None
        hist = [
            {
                "date": b.get("trade_date"),
                "open": b.get("open"),
                "high": b.get("high"),
                "low": b.get("low"),
                "close": b.get("close"),
                "adjClose": b.get("close"),
                "volume": b.get("volume"),
            }
            for b in bars
        ]
        hist.reverse()  # facade oldest->newest; consumers expect newest-first
        return {"symbol": symbol, "historical": hist}

    def get_quote(self, symbols):
        syms = symbols if isinstance(symbols, list) else [s for s in str(symbols).split(",") if s]
        import data_access as data  # noqa: PLC0415

        out = []
        for sym in syms:
            self.api_calls_made += 1
            try:
                rows = data.quote(_canonical(sym)) or []
            except Exception:  # noqa: BLE001
                rows = []
            price = rows[0].get("last") if rows else None
            out.append({"symbol": sym, "price": price})
        return out

    def get_treasury_rates(self, days: int = 600):
        """US Treasury 10Y/2Y yields from FRED (DGS10/DGS2) via the facade, shaped
        like the legacy FMP treasury-rates endpoint: [{date,year10,year2}],
        newest-first. Enough history for the 12-month yield-curve analysis."""
        import data_access as data  # noqa: PLC0415

        self.api_calls_made += 1
        limit = max(days, 400)  # >=~18 months daily -> >=12 monthly buckets
        by_date: dict[str, dict] = {}
        for series, key in (("DGS10", "year10"), ("DGS2", "year2")):
            for r in data.macro(series, limit=limit) or []:
                dt = (r.get("date") or "")[:10]
                if dt:
                    by_date.setdefault(dt, {})[key] = r.get(series)
        rows = [
            {"date": dt, "year10": v.get("year10"), "year2": v.get("year2")}
            for dt, v in by_date.items()
            if v.get("year10") is not None and v.get("year2") is not None
        ]
        rows.sort(key=lambda x: x["date"], reverse=True)
        return rows or None

    def clear_cache(self):
        self.cache.clear()

    def get_api_stats(self) -> dict:
        return {
            "cache_entries": len(self.cache),
            "api_calls_made": self.api_calls_made,
            "max_api_calls": self.max_api_calls,
            "rate_limit_reached": self.rate_limit_reached,
        }


def get_data_client(api_key=None, ticker_hint=None):
    return FMPClient(api_key=api_key)
