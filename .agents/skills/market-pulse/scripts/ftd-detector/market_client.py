"""Facade-backed drop-in for the legacy market-data client (Tier-1).

Same client surface + the same return shapes, but every value comes from the
data-access facade (quote / history) — no direct vendor/data-source access
(enforced by docs/tools/check-tier-boundary.sh §2.5/§4.8/§4.9). Replaces the old
per-vendor client module for migrated tools (ftd-detector, market-top-detector).

Provides only the surface those tools use: quotes (price + 52w high/low computed
from history), daily history (newest-first), VIX term structure, SMA/EMA.
"""
import sys

sys.path.insert(0, "/Users/x/nimbus-os/services/data-access")


def _canonical(sym: str) -> str:
    """FMP-style ticker -> facade canonical. Indices(^GSPC)/futures(=)/crypto(-)
    pass through; bare US tickers get the US: prefix."""
    s = sym.strip().upper()
    if ":" in s or s.startswith("^") or "=" in s or "-" in s:
        return s
    return f"US:{s}"


class FMPClient:
    """Drop-in for the old FMP client, backed by the data-access facade."""

    def __init__(self, api_key=None, max_api_calls: int = 200):
        # api_key accepted for backward compatibility; unused (facade needs none).
        self.api_key = api_key
        self.max_api_calls = max_api_calls
        self.api_calls_made = 0
        self.rate_limit_reached = False
        self.cache: dict = {}

    # ── facade fetch (cached) ───────────────────────────────────────────────
    def _bars(self, symbol: str, limit: int) -> list[dict]:
        """Daily bars oldest->newest from the facade, cached per (symbol, limit)."""
        key = f"bars_{symbol}_{limit}"
        if key in self.cache:
            return self.cache[key]
        import data_access as data  # noqa: PLC0415

        self.api_calls_made += 1
        try:
            bars = data.history(_canonical(symbol), limit=limit) or []
        except Exception:  # noqa: BLE001 — degrade, don't crash the scan
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
        hist.reverse()  # facade is oldest->newest; FMP/consumers expect newest-first
        return {"symbol": symbol, "historical": hist}

    def get_batch_historical(self, symbols: list[str], days: int = 50) -> dict[str, list[dict]]:
        result: dict[str, list[dict]] = {}
        for sym in symbols:
            data = self.get_historical_prices(sym, days)
            if data and data.get("historical"):
                result[sym] = data["historical"]
        return result

    # ── quotes (price + 52w high/low computed from 1y history) ──────────────
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
            year_high = year_low = None
            yr = self._bars(sym, 260)  # ~1 trading year
            highs = [b["high"] for b in yr if b.get("high") is not None]
            lows = [b["low"] for b in yr if b.get("low") is not None]
            if highs:
                year_high = max(highs)
            if lows:
                year_low = min(lows)
            if price is None and yr:  # quote stale (market closed) -> latest close
                closes = [b["close"] for b in yr if b.get("close") is not None]
                price = closes[-1] if closes else None
            out.append(
                {"symbol": sym, "price": price, "yearHigh": year_high, "yearLow": year_low}
            )
        return out

    def get_batch_quotes(self, symbols: list[str]) -> dict[str, dict]:
        result: dict[str, dict] = {}
        for q in self.get_quote(list(symbols)):
            if q.get("symbol"):
                result[q["symbol"]] = q
        return result

    # ── derived: VIX term structure (same logic, facade quotes) ─────────────
    def get_vix_term_structure(self):
        vix_quotes = self.get_quote("^VIX")
        vix3m_quotes = self.get_quote("^VIX3M")
        if not vix_quotes or not vix3m_quotes:
            return None
        vix_price = vix_quotes[0].get("price") or 0
        vix3m_price = vix3m_quotes[0].get("price") or 0
        if vix3m_price <= 0:
            return None
        ratio = vix_price / vix3m_price
        if ratio < 0.85:
            classification = "steep_contango"
        elif ratio < 0.95:
            classification = "contango"
        elif ratio <= 1.05:
            classification = "flat"
        else:
            classification = "backwardation"
        return {
            "vix": round(vix_price, 2),
            "vix3m": round(vix3m_price, 2),
            "ratio": round(ratio, 3),
            "classification": classification,
        }

    @staticmethod
    def calculate_sma(prices: list[float], period: int) -> float:
        if not prices or len(prices) < period:
            return 0.0
        return sum(prices[:period]) / period

    @staticmethod
    def calculate_ema(prices: list[float], period: int = 50) -> float:
        if not prices or len(prices) < period:
            return 0.0
        series = list(reversed(prices))
        k = 2 / (period + 1)
        ema = series[0]
        for p in series[1:]:
            ema = p * k + ema * (1 - k)
        return ema

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
