#!/usr/bin/env python3
"""
Theme Detector - ETF & Stock Metrics Scanner

Sources all data from the data-access facade (Tier-1): RSI-14, 52-week distance,
P/E (TTM), and volume ratios. No yfinance/FMP direct access — enforced by
docs/tools/check-tier-boundary.sh (§2.5/§4.8/§4.9).

    RSI-14:        facade /technicals (rsi14); falls back to compute from history
    52w distance:  facade /history (daily high/low/close, ~1y)
    P/E (TTM):     facade /quote (Futu pe_ttm)
    volume ratios: facade /history (daily volume, ~60 trading days)
"""

import math
import sys
from typing import Any, Optional

try:
    import numpy as np
    import pandas as pd
except ImportError:
    print("ERROR: pandas/numpy not found. Install with: pip install pandas numpy", file=sys.stderr)
    sys.exit(1)

sys.path.insert(0, "/Users/x/nimbus-os/services/data-access")


def _canonical(symbol: str) -> str:
    """Bare ticker -> facade canonical. AAPL->US:AAPL; passes through if prefixed."""
    s = symbol.strip().upper()
    return s if ":" in s else f"US:{s}"


def _num(v: Any) -> Optional[float]:
    """Coerce to float, dropping None/NaN/inf (Futu returns NaN for missing P/E)."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


class ETFScanner:
    """Scans ETFs and stocks for volume ratios and technical metrics, all via the
    data-access facade (Tier-1)."""

    def __init__(self, fmp_api_key: Optional[str] = None, rate_limit_sec: float = 0.0):
        # fmp_api_key / rate_limit_sec are accepted for backward compatibility but
        # unused — all data now comes from the facade.
        self._fmp_api_key = fmp_api_key
        self._hist_cache: dict[str, list[dict]] = {}
        self._stats: dict[str, dict[str, int]] = {
            "stock": {"facade_calls": 0, "facade_failures": 0},
            "etf": {"facade_calls": 0, "facade_failures": 0},
        }
        self._current_stats_context: str = "stock"

    def backend_stats(self) -> dict[str, Any]:
        """Backend usage stats: flat totals + nested stock/etf (facade calls)."""
        flat = {"facade_calls": 0, "facade_failures": 0}
        for ctx in ("stock", "etf"):
            for k in flat:
                flat[k] += self._stats[ctx][k]
        return {**flat, "stock": dict(self._stats["stock"]), "etf": dict(self._stats["etf"])}

    # -------------------------------------------------------------------
    # Facade fetch helpers
    # -------------------------------------------------------------------
    def _history(self, symbol: str, limit: int) -> list[dict]:
        """Daily bars (oldest->newest), cached per (symbol, limit)."""
        key = f"{symbol}:{limit}"
        if key in self._hist_cache:
            return self._hist_cache[key]
        import data_access as data  # noqa: PLC0415

        ctx = self._current_stats_context
        self._stats[ctx]["facade_calls"] += 1
        try:
            bars = data.history(_canonical(symbol), limit=limit) or []
        except Exception:  # noqa: BLE001 — degrade, don't crash the scan
            bars = []
        bars = sorted(
            [b for b in bars if b.get("trade_date")], key=lambda b: b["trade_date"]
        )
        if not bars:
            self._stats[ctx]["facade_failures"] += 1
        self._hist_cache[key] = bars
        return bars

    def _technicals(self, symbol: str) -> dict:
        import data_access as data  # noqa: PLC0415

        try:
            rows = data.technicals(_canonical(symbol)) or []
            return rows[0] if rows else {}
        except Exception:  # noqa: BLE001
            return {}

    def _quote(self, symbol: str) -> dict:
        import data_access as data  # noqa: PLC0415

        try:
            rows = data.quote(_canonical(symbol)) or []
            return rows[0] if rows else {}
        except Exception:  # noqa: BLE001
            return {}

    # -------------------------------------------------------------------
    # ETF volume ratios
    # -------------------------------------------------------------------
    def get_etf_volume_ratio(self, symbol: str) -> dict:
        """20-day / 60-day average volume ratio for an ETF via the facade.

        Returns {symbol, vol_20d, vol_60d, vol_ratio}; values None if unavailable.
        """
        self._current_stats_context = "etf"
        return self._volume_ratio(symbol)

    def batch_etf_volume_ratios(self, symbols: list[str]) -> dict[str, dict]:
        """Batch ETF volume ratios. Returns {symbol: {symbol, vol_20d, vol_60d, vol_ratio}}."""
        if not symbols:
            return {}
        self._current_stats_context = "etf"
        return {s: self._volume_ratio(s) for s in symbols}

    def _volume_ratio(self, symbol: str) -> dict:
        result = {"symbol": symbol, "vol_20d": None, "vol_60d": None, "vol_ratio": None}
        bars = self._history(symbol, limit=70)  # ~60 trading days + buffer
        volumes = [b["volume"] for b in bars if b.get("volume") is not None]
        if len(volumes) >= 20:
            vol_20d = float(np.mean(volumes[-20:]))
            vol_60d = (
                float(np.mean(volumes[-60:])) if len(volumes) >= 60 else float(np.mean(volumes))
            )
            result["vol_20d"] = vol_20d
            result["vol_60d"] = vol_60d
            result["vol_ratio"] = vol_20d / vol_60d if vol_60d > 0 else None
        return result

    # -------------------------------------------------------------------
    # Stock metrics
    # -------------------------------------------------------------------
    def batch_stock_metrics(self, symbols: list[str]) -> list[dict]:
        """Batch stock metrics via the facade.

        Returns list of {symbol, rsi_14, dist_from_52w_high, dist_from_52w_low,
        pe_ratio}; values None if unavailable.
        """
        if not symbols:
            return []
        self._current_stats_context = "stock"
        return [self._stock_metrics(s) for s in symbols]

    def _stock_metrics(self, symbol: str) -> dict:
        entry = {
            "symbol": symbol,
            "rsi_14": None,
            "dist_from_52w_high": None,
            "dist_from_52w_low": None,
            "pe_ratio": None,
        }

        # RSI: prefer the warehouse-computed rsi14, else compute from history close.
        entry["rsi_14"] = _num(self._technicals(symbol).get("rsi14"))

        # P/E (TTM) from the realtime Futu quote (NaN -> None for ETFs/missing).
        entry["pe_ratio"] = _num(self._quote(symbol).get("pe_ttm"))

        bars = self._history(symbol, limit=260)  # ~1 trading year
        if not bars:
            return entry

        close = pd.Series([b["close"] for b in bars if b.get("close") is not None])
        high = pd.Series([b["high"] for b in bars if b.get("high") is not None])
        low = pd.Series([b["low"] for b in bars if b.get("low") is not None])

        if entry["rsi_14"] is None and len(close) >= 15:
            entry["rsi_14"] = self._calculate_rsi(close, period=14)

        if not close.empty and not high.empty and not low.empty:
            distances = self._calculate_52w_distances(close, high, low)
            entry["dist_from_52w_high"] = distances["dist_from_52w_high"]
            entry["dist_from_52w_low"] = distances["dist_from_52w_low"]

        return entry

    # -------------------------------------------------------------------
    # Shared metric calculations (pure)
    # -------------------------------------------------------------------
    @staticmethod
    def _calculate_rsi(prices: pd.Series, period: int = 14) -> Optional[float]:
        """Calculate RSI using Wilder's smoothing method."""
        if prices is None or len(prices) < period + 1:
            return None

        deltas = prices.diff()

        gains = deltas.where(deltas > 0, 0.0)
        losses = (-deltas).where(deltas < 0, 0.0)

        first_avg_gain = gains.iloc[1 : period + 1].mean()
        first_avg_loss = losses.iloc[1 : period + 1].mean()

        avg_gain = first_avg_gain
        avg_loss = first_avg_loss

        for i in range(period + 1, len(prices)):
            avg_gain = (avg_gain * (period - 1) + gains.iloc[i]) / period
            avg_loss = (avg_loss * (period - 1) + losses.iloc[i]) / period

        if avg_loss == 0:
            return 100.0

        rs = avg_gain / avg_loss
        rsi = 100.0 - (100.0 / (1.0 + rs))
        return round(rsi, 2)

    @staticmethod
    def _calculate_52w_distances(close: pd.Series, high: pd.Series, low: pd.Series) -> dict:
        """Calculate distance from 52-week high and low."""
        result = {"dist_from_52w_high": None, "dist_from_52w_low": None}

        if close.empty:
            return result

        current = float(close.iloc[-1])
        if current <= 0:
            return result

        high_52w = float(high.max())
        low_52w = float(low.min())

        if high_52w > 0:
            result["dist_from_52w_high"] = round((high_52w - current) / high_52w, 4)

        if low_52w >= 0:
            result["dist_from_52w_low"] = (
                round((current - low_52w) / current, 4) if current > 0 else None
            )

        return result
