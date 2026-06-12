"""Minimal Finnhub API client for news-dashboard Mode 1."""
import os
import time
import logging
import requests

logger = logging.getLogger(__name__)


class FinnhubClient:
    BASE = "https://finnhub.io/api/v1"

    def __init__(self, api_key: str = "", timeout: int = 15):
        self.api_key = api_key or os.environ.get("FINNHUB_API_KEY", "")
        self.timeout = timeout
        self._calls = 0
        if not self.api_key:
            logger.warning("FINNHUB_API_KEY not set")

    def get_api_stats(self) -> dict:
        return {"call_count": self._calls, "calls": self._calls}

    def _get(self, path: str, params: dict | None = None) -> dict | list:
        p = dict(params or {})
        p["token"] = self.api_key
        self._calls += 1
        for attempt in range(3):
            try:
                r = requests.get(f"{self.BASE}/{path}", params=p, timeout=self.timeout)
                if r.status_code == 429:
                    time.sleep(1.5 * (attempt + 1))
                    continue
                r.raise_for_status()
                return r.json()
            except requests.RequestException as e:
                logger.debug("Finnhub %s failed: %s", path, e)
                if attempt == 2:
                    raise
                time.sleep(0.5)
        return {}

    def get_market_news(self, category: str = "general", min_id: int = 0) -> list:
        data = self._get("news", {"category": category, "minId": min_id})
        return data if isinstance(data, list) else []

    def get_company_news(self, symbol: str, from_date: str, to_date: str) -> list:
        data = self._get("company-news", {"symbol": symbol, "from": from_date, "to": to_date})
        return data if isinstance(data, list) else []

    def get_economic_calendar(self) -> list:
        data = self._get("calendar/economic")
        if isinstance(data, dict):
            return data.get("economicCalendar", []) or []
        return []
