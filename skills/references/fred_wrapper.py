#!/Users/x/nimbus-os/nimbus/.venv-openbb/bin/python3
"""
OpenBB FRED 重试包装器 — 绕开 OpenBB 内置的 5s timeout。

问题：openbb-fred provider 硬编码 5s timeout，部分 FRED 序列（fred_series、
treasury_rates、crude_oil_spot）在网络延迟稍高时超时。

方案：用本包装器替代直调 openbb。它先试 openbb，超时后用 requests 直连
FRED API（5s → 15s），结果格式化成与 r.to_df() 一致的 DataFrame。

用法：
    from openbb_fred_wrapper import fred_series
    df = fred_series("DGS10")          # → pandas DataFrame
    df = fred_series("DGS10", limit=5)  # → 前 5 行
"""
from __future__ import annotations

import json
import os
import time
from typing import Any

import pandas as pd
import requests

FRED_API_KEY = os.environ.get(
    "FRED_API_KEY",
    "4f133c688c8be7b094b31c67e10f1d24",
)

# ── 先试 OpenBB（快路径） ──────────────────────────────────────────────────


def _try_openbb(series: str) -> pd.DataFrame | None:
    """Try openbb with its built-in timeout.  Returns None on timeout."""
    try:
        from openbb import obb  # noqa: PLC0415
        r = obb.economy.fred_series(series, provider="fred")
        df = r.to_df()
        df = df.reset_index()
        # OpenBB's to_df() puts date as index with name=date → restore
        if "index" in df.columns:
            df = df.rename(columns={"index": "date"})
        return df
    except TimeoutError:
        return None
    except Exception:
        # If the error is an asyncio timeout or empty error, treat as timeout
        return None


# ── 直连 FRED API（慢路径，15s timeout） ─────────────────────────────────


def _fetch_fred_direct(
    series: str,
    limit: int = 100000,
) -> pd.DataFrame:
    """Fetch FRED observations directly with a generous timeout.

    Returns a DataFrame with columns [date, value] (date is the FRED
    observation_date, value is float or NaN).
    """
    url = (
        "https://api.stlouisfed.org/fred/series/observations"
        f"?series_id={series}"
        f"&api_key={FRED_API_KEY}"
        f"&file_type=json"
        f"&sort_order=desc"
        f"&limit={limit}"
    )
    resp = requests.get(url, timeout=15)
    resp.raise_for_status()
    data = resp.json()
    rows = []
    for obs in data.get("observations", []):
        val = obs.get("value", ".")
        rows.append({
            "date": obs["date"],
            series: float(val) if val not in (".", "") else None,
        })
    df = pd.DataFrame(rows)
    if not df.empty:
        df = df.sort_values("date").reset_index(drop=True)
    return df


# ── 公共入口 ───────────────────────────────────────────────────────────────


def fred_series(series: str, limit: int = 100000) -> pd.DataFrame:
    """Fetch a FRED time series with timeout resilience.

    1. Try OpenBB's built-in fred_series (fast, ~5s timeout).
    2. On timeout, fall back to direct HTTP request (~15s timeout).
    3. Return a DataFrame sorted by date ascending.

    Args:
        series: FRED series ID, e.g. "DGS10", "GDP", "T10YIE".
        limit: Max rows to return.

    Returns:
        pd.DataFrame with columns [date, <series>].
    """
    df = _try_openbb(series)
    if df is not None and not df.empty:
        if limit and len(df) > limit:
            df = df.tail(limit).reset_index(drop=True)
        return df

    # OpenBB timed out — fall back to direct call
    time.sleep(1)  # brief cooldown before retry
    df = _fetch_fred_direct(series, limit=limit)
    return df


# ── CLI 入口 ───────────────────────────────────────────────────────────────


if __name__ == "__main__":
    import sys
    series = sys.argv[1] if len(sys.argv) > 1 else "DGS10"
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 100000
    df = fred_series(series, limit=limit)
    print(df.to_string(index=False))
    print(f"\n{len(df)} rows")
