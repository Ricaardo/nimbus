"""Minimal FRED API client for news-dashboard Mode 1."""
import os
import time
import logging
import requests

logger = logging.getLogger(__name__)


class FREDClient:
    BASE = "https://api.stlouisfed.org/fred"

    def __init__(self, api_key: str = "", timeout: int = 15):
        self.api_key = api_key or os.environ.get("FRED_API_KEY", "")
        self.timeout = timeout
        if not self.api_key:
            logger.warning("FRED_API_KEY not set")

    def _get(self, path: str, params: dict | None = None) -> dict:
        p = dict(params or {})
        p["api_key"] = self.api_key
        p["file_type"] = "json"
        for attempt in range(3):
            try:
                r = requests.get(f"{self.BASE}/{path}", params=p, timeout=self.timeout)
                if r.status_code == 429:
                    time.sleep(1.5 * (attempt + 1))
                    continue
                r.raise_for_status()
                return r.json()
            except requests.RequestException as e:
                logger.debug("FRED %s failed: %s", path, e)
                if attempt == 2:
                    raise
                time.sleep(0.5)
        return {}

    def get_series_observations(self, series_id: str, limit: int = 10) -> list:
        data = self._get("series/observations", {
            "series_id": series_id, "limit": limit, "sort_order": "desc",
        })
        return data.get("observations", []) if isinstance(data, dict) else []
