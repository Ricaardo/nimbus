"""Facade-backed drop-in for the legacy market-data client (Tier-1).

Same client surface + the same return shapes the screeners expect, but every value
comes from the data-access facade (quote / history / profile / earnings_calendar)
— no direct vendor/data-source access (enforced by check-tier-boundary.sh
§2.5/§4.8/§4.9). Replaces the old per-vendor client for migrated tools.
"""
import sys

sys.path.insert(0, "/Users/x/nimbus-os/services/data-access")


class ApiCallBudgetExceeded(Exception):
    """Kept for interface parity; the facade has no per-call budget so this is
    never raised."""


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

    # ── facade fetch (cached) ───────────────────────────────────────────────
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

    # ── historical prices (FMP shape: newest-first) ─────────────────────────
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

    def get_batch_historical(self, symbols: list[str], days: int = 50) -> dict[str, list[dict]]:
        result: dict[str, list[dict]] = {}
        for sym in symbols:
            data = self.get_historical_prices(sym, days)
            if data and data.get("historical"):
                result[sym] = data["historical"]
        return result

    # ── quotes ──────────────────────────────────────────────────────────────
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
            if price is None:
                bars = self._bars(sym, 5)
                closes = [b["close"] for b in bars if b.get("close") is not None]
                price = closes[-1] if closes else None
            out.append({"symbol": sym, "price": price})
        return out

    def get_batch_quotes(self, symbols: list[str]) -> dict[str, dict]:
        return {q["symbol"]: q for q in self.get_quote(list(symbols)) if q.get("symbol")}

    # ── company profile (facade /profile, mapped to legacy FMP keys) ─────────
    def get_profile(self, symbol: str):
        import data_access as data  # noqa: PLC0415

        self.api_calls_made += 1
        rows = data.profile(_canonical(symbol)) or []
        if not rows:
            return None
        p = rows[0]
        return [
            {
                "symbol": symbol,
                "companyName": p.get("name"),
                "sector": p.get("sector"),
                "industry": p.get("industry"),
                "exchange": p.get("exchange"),
                "mktCap": p.get("marketCap"),
                "sharesOutstanding": p.get("sharesOutstanding"),
            }
        ]

    def get_company_profiles(self, symbols: list[str]) -> dict[str, dict]:
        profiles: dict[str, dict] = {}
        for s in symbols:
            p = self.get_profile(s)
            if p:
                profiles[s] = p[0]
        return profiles

    # ── earnings calendar (facade /earnings_calendar, hour->time) ───────────
    def get_earnings_calendar(self, from_date: str, to_date: str):
        import data_access as data  # noqa: PLC0415

        self.api_calls_made += 1
        rows = data.earnings_calendar(from_date, to_date) or []
        out = []
        for e in rows:
            out.append(
                {
                    "symbol": e.get("symbol"),
                    "date": e.get("date"),
                    "time": e.get("hour", ""),  # legacy key; Finnhub uses 'hour' (bmo/amc)
                    "eps": e.get("epsActual"),
                    "epsEstimated": e.get("epsEstimate"),
                    "revenue": e.get("revenueActual"),
                    "revenueEstimated": e.get("revenueEstimate"),
                }
            )
        return out

    def get_earnings(self, symbol: str, limit: int = 8):
        import data_access as data  # noqa: PLC0415

        self.api_calls_made += 1
        return data.earnings(_canonical(symbol), limit=limit) or []

    # ── misc (interface parity) ─────────────────────────────────────────────
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
    """Backward-compatible factory; the facade serves all markets uniformly."""
    return FMPClient(api_key=api_key)
