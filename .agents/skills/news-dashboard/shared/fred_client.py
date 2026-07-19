"""FRED client for news-dashboard, backed by the data-access facade.

Historically this hit the FRED REST API directly; per the decoupling plan it now
reads through the data-access facade (``import data_access`` -> ``macro()``), the
single read path the news-dashboard skill already uses (see finnhub_client.py).
``get_series_observations`` preserves the FRED-native observation shape
(``{"date", "value"}``, newest-first) so callers need no change.
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

    def get_series_observations(self, series_id: str, limit: int = 10) -> list:
        """Newest-first FRED observations as {"date","value"} dicts.

        The facade returns rows keyed by the series id ({"date", "<series>": v});
        remap to FRED's native {"date","value"} (value stringified) for callers.
        """
        try:
            rows = _facade().macro(series_id, limit=limit) or []
        except Exception as e:  # noqa: BLE001
            logger.debug("FRED macro(%s) via facade failed: %s", series_id, e)
            return []
        out = []
        for r in reversed(rows):  # facade is oldest-first; FRED native is desc
            val = r.get("value")
            if val is None:
                val = next((v for k, v in r.items() if k != "date"), None)
            out.append({"date": r.get("date"), "value": "" if val is None else str(val)})
        return out
