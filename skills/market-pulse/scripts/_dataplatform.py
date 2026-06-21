"""market-pulse → data-access facade helper (Tier-1).

Calculators fetch index/futures/commodity/crypto/macro via the facade instead of
importing yfinance/akshare/FRED directly (enforced by check-tier-boundary.sh).
Futu serves stocks/ETFs; Yahoo (data-gateway) serves indices/futures/crypto.

    from _dataplatform import closes, last_price, macro_latest, fear_greed
"""
import sys

sys.path.insert(0, "/Users/x/nimbus-os/services/data-access")


def closes(symbol: str, limit: int = 90) -> list[float]:
    """Daily close list, oldest→newest, for a canonical/native symbol.
    e.g. closes("CL=F"), closes("^VIX"), closes("US:SPY"), closes("CRYPTO:BTC-USD")."""
    import data_access as data  # noqa: PLC0415
    bars = data.history(symbol, limit=limit)
    return [b["close"] for b in bars if b.get("close") is not None]


def last_price(symbol: str) -> float | None:
    import data_access as data  # noqa: PLC0415
    rows = data.quote(symbol)
    return rows[0].get("last") if rows else None


def macro_latest(series: str, points: int = 60) -> list[float]:
    """FRED series values, oldest→newest (e.g. macro_latest("DGS10"))."""
    import data_access as data  # noqa: PLC0415
    rows = data.macro(series, limit=points)
    return [v for r in rows for v in r.values() if isinstance(v, (int, float))]


def fear_greed() -> int | None:
    import data_access as data  # noqa: PLC0415
    rows = data.feargreed()
    return rows[0]["value"] if rows else None
