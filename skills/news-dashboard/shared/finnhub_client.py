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

    # ── 新闻 ──────────────────────────────────────────────────────────────
    def get_market_news(self, category: str = "general", min_id: int = 0) -> list:
        """大盘/宏观新闻。免费档实测来源仅 Reuters / CNBC / Bloomberg。
        category: general | forex | crypto | merger"""
        data = self._get("news", {"category": category, "minId": min_id})
        return data if isinstance(data, list) else []

    def get_company_news(self, symbol: str, from_date: str, to_date: str) -> list:
        """个股新闻。免费档实测来源仅 Yahoo / SeekingAlpha / Benzinga / CNBC / ChartMill。"""
        data = self._get("company-news", {"symbol": symbol, "from": from_date, "to": to_date})
        return data if isinstance(data, list) else []

    # ── 行情 / 公司 ───────────────────────────────────────────────────────
    def get_quote(self, symbol: str) -> dict:
        """实时报价: c=当前 d=涨跌 dp=涨跌% h/l/o=最高/低/开 pc=昨收 t=时间戳"""
        data = self._get("quote", {"symbol": symbol})
        return data if isinstance(data, dict) else {}

    def get_profile(self, symbol: str) -> dict:
        """公司简介 (profile2): 名称/行业/市值/交易所/上市日 等"""
        data = self._get("stock/profile2", {"symbol": symbol})
        return data if isinstance(data, dict) else {}

    def search_symbol(self, query: str) -> list:
        """标的检索。返回 {count, result:[{symbol, description, type}]} 的 result。"""
        data = self._get("search", {"q": query})
        if isinstance(data, dict):
            return data.get("result", []) or []
        return []

    def get_peers(self, symbol: str) -> list:
        """同业公司列表 (相同行业的 ticker)。"""
        data = self._get("stock/peers", {"symbol": symbol})
        return data if isinstance(data, list) else []

    def get_market_status(self, exchange: str = "US") -> dict:
        """交易所开闭市状态: {exchange, isOpen, session, holiday, t}"""
        data = self._get("stock/market-status", {"exchange": exchange})
        return data if isinstance(data, dict) else {}

    # ── 基本面 / 评级 ─────────────────────────────────────────────────────
    def get_basic_financials(self, symbol: str, metric: str = "all") -> dict:
        """基础财务指标 (PE/PB/margin/52周高低/beta 等)。返回 metric 子对象。"""
        data = self._get("stock/metric", {"symbol": symbol, "metric": metric})
        if isinstance(data, dict):
            return data.get("metric", {}) or {}
        return {}

    def get_recommendation_trends(self, symbol: str) -> list:
        """分析师买卖评级趋势: [{period, strongBuy, buy, hold, sell, strongSell}]"""
        data = self._get("stock/recommendation", {"symbol": symbol})
        return data if isinstance(data, list) else []

    def get_earnings_surprises(self, symbol: str) -> list:
        """历史 EPS surprise: [{period, actual, estimate, surprise, surprisePercent}]"""
        data = self._get("stock/earnings", {"symbol": symbol})
        return data if isinstance(data, list) else []

    # ── 内部人 ────────────────────────────────────────────────────────────
    def get_insider_transactions(self, symbol: str) -> list:
        """内部人交易明细。返回 {data:[...]} 的 data。"""
        data = self._get("stock/insider-transactions", {"symbol": symbol})
        if isinstance(data, dict):
            return data.get("data", []) or []
        return []

    def get_insider_sentiment(self, symbol: str, from_date: str, to_date: str) -> list:
        """内部人情绪 (MSPR): {data:[{year, month, change, mspr}]} 的 data。"""
        data = self._get("stock/insider-sentiment",
                         {"symbol": symbol, "from": from_date, "to": to_date})
        if isinstance(data, dict):
            return data.get("data", []) or []
        return []

    # ── 日历 ──────────────────────────────────────────────────────────────
    def get_earnings_calendar(self, from_date: str, to_date: str) -> list:
        """财报日历: {earningsCalendar:[...]} 的 earningsCalendar。"""
        data = self._get("calendar/earnings", {"from": from_date, "to": to_date})
        if isinstance(data, dict):
            return data.get("earningsCalendar", []) or []
        return []

    def get_ipo_calendar(self, from_date: str, to_date: str) -> list:
        """IPO 日历: {ipoCalendar:[...]} 的 ipoCalendar。"""
        data = self._get("calendar/ipo", {"from": from_date, "to": to_date})
        if isinstance(data, dict):
            return data.get("ipoCalendar", []) or []
        return []

    def get_economic_calendar(self) -> list:
        """经济日历。⚠️ 免费档已不可用 (401/付费),保留接口仅作兼容。"""
        data = self._get("calendar/economic")
        if isinstance(data, dict):
            return data.get("economicCalendar", []) or []
        return []

    # ⚠️ 以下端点免费档无权限 (403),未实现: stock/candle (K线)、crypto/candle、
    #    news-sentiment、fda-advisory-committee-calendar。需付费档。
