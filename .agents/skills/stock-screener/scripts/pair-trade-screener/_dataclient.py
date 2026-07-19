"""pair-trade-screener → data-access facade helper (Tier-1).

Prices come from the facade (warehouse/market-hub), never FMP/yfinance directly
(enforced by check-tier-boundary.sh). Pair-trade universe is US equities.

    from _dataclient import price_series
"""
import sys

sys.path.insert(0, "/Users/x/nimbus-os/services/data-access")


def to_canonical(tok: str) -> str:
    """Bare ticker -> facade canonical. AAPL->US:AAPL; passes through if already prefixed."""
    t = tok.strip().upper()
    return t if ":" in t else f"US:{t}"


def price_series(symbol: str, lookback_days: int = 365):
    """Date-indexed daily close Series (oldest->newest) via facade history.

    Returns a pandas Series named `symbol`, or None if no data."""
    import pandas as pd  # noqa: PLC0415

    import data_access as data  # noqa: PLC0415

    bars = data.history(to_canonical(symbol), limit=lookback_days)
    bars = [b for b in (bars or []) if b.get("close") is not None and b.get("trade_date")]
    if not bars:
        return None
    s = pd.Series(
        [b["close"] for b in bars],
        index=pd.to_datetime([b["trade_date"] for b in bars]),
        name=symbol,
    )
    return s.sort_index()
