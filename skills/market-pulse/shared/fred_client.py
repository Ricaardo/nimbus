"""FRED client for market-pulse, backed by the data-access facade.

The market-pulse calculators (liquidity / rates / credit / safe-haven) expect a
``get_series(series_id, start=...)`` returning an ASCENDING list of
``{"date","value": float}`` observations (so ``series[-1]`` is the newest, and
``value`` is numeric for arithmetic). Data is read through the data-access
facade (``data_access.macro()``), the single read path, rather than a direct
FRED REST call. This file was missing — the market-pulse scripts imported
``fred_client`` from a ``shared/`` dir that did not exist.
"""
import logging
import os
import sys

logger = logging.getLogger(__name__)

_data = None


def _facade():
    """Lazily import the data-access facade SDK (the single read path)."""
    global _data
    if _data is None:
        pkg = os.environ.get("DATA_ACCESS_PKG", os.path.expanduser("~/nimbus-os/services/data-access"))
        if pkg not in sys.path:
            sys.path.insert(0, pkg)
        import data_access as _da  # noqa: PLC0415
        _data = _da
    return _data


class FREDClient:
    def __init__(self, api_key: str = "", timeout: int = 15):
        # Kept for signature compatibility; credentials/transport live in the facade.
        self.api_key = api_key
        self.timeout = timeout
        self._calls = 0

    def get_api_stats(self) -> dict:
        return {"call_count": self._calls, "calls": self._calls, "source": "data-access facade"}

    def get_series(self, series_id: str, start: str | None = None, limit: int = 500) -> list:
        """Ascending [{"date","value": float}] observations, optionally filtered
        to date >= ``start`` (YYYY-MM-DD). Returns [] on failure."""
        self._calls += 1
        try:
            rows = _facade().macro(series_id, limit=limit) or []
        except Exception as e:  # noqa: BLE001
            logger.debug("FRED macro(%s) via facade failed: %s", series_id, e)
            return []
        out = []
        for r in rows:  # facade returns ascending (oldest-first)
            val = r.get("value")
            if val is None:
                val = next((v for k, v in r.items() if k != "date"), None)
            if val is None:
                continue
            try:
                fval = float(val)
            except (TypeError, ValueError):
                continue
            date = r.get("date")
            if start and date and date < start:
                continue
            out.append({"date": date, "value": fval})
        return out
