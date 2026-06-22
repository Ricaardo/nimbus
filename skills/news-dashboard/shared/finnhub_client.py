"""Finnhub-compatible client for news-dashboard, backed by the data-access facade.

Historically this hit the Finnhub REST API directly; per the decoupling plan it now
reads everything through the data-access facade (``import data_access``), which proxies
the same Finnhub-tier data via reference-data. Method signatures and return shapes
are preserved so callers need no change. A couple of Finnhub-only endpoints with no
facade equivalent (insider-sentiment, ipo-calendar) degrade gracefully to empty.
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


class FinnhubClient:
    def __init__(self, api_key: str = "", timeout: int = 15):
        self.api_key = api_key or os.environ.get("FINNHUB_API_KEY", "")
        self.timeout = timeout
        self._calls = 0

    def get_api_stats(self) -> dict:
        return {"call_count": self._calls, "calls": self._calls}

    # ── 新闻 ──────────────────────────────────────────────────────────────
    def get_market_news(self, category: str = "general", min_id: int = 0) -> list:
        """大盘/宏观新闻（经 facade news 平台，重映射为 finnhub 形状）。"""
        self._calls += 1
        out = []
        for m in _facade().news(limit=50) or []:
            out.append({
                "headline": m.get("title") or m.get("headline", ""),
                "summary": m.get("content") or m.get("summary", ""),
                "url": m.get("link") or m.get("url", ""),
                "source": m.get("source", ""),
                "datetime": m.get("create_time") or m.get("datetime"),
                "category": category,
            })
        return out

    def get_company_news(self, symbol: str, from_date: str, to_date: str) -> list:
        """个股新闻（facade /company_news → Finnhub company-news，形状一致）。"""
        self._calls += 1
        return _facade().company_news(symbol, from_date, to_date) or []

    # ── 行情 / 公司 ───────────────────────────────────────────────────────
    def get_quote(self, symbol: str) -> dict:
        """实时报价: c=当前 d=涨跌 dp=涨跌% h/l/o=最高/低/开 pc=昨收 t=时间戳。"""
        self._calls += 1
        rows = _facade().quote(symbol) or []
        if not rows:
            return {}
        q = rows[0]
        return {"c": q.get("last"), "d": q.get("change"), "dp": q.get("change_pct"),
                "h": q.get("high"), "l": q.get("low"), "o": q.get("open"),
                "pc": q.get("prev_close"), "t": q.get("ts")}

    def get_profile(self, symbol: str) -> dict:
        """公司简介: {symbol,name,sector,industry,exchange,marketCap,sharesOutstanding}。"""
        self._calls += 1
        rows = _facade().profile(symbol) or []
        return rows[0] if rows else {}

    def search_symbol(self, query: str) -> list:
        """标的检索: [{symbol, displaySymbol, description, type}]。"""
        self._calls += 1
        return _facade().search(query) or []

    def get_peers(self, symbol: str) -> list:
        """同业公司列表 (相同行业的 ticker)。"""
        self._calls += 1
        return _facade().peers(symbol) or []

    def get_market_status(self, exchange: str = "US") -> dict:
        """交易所开闭市状态: {exchange, isOpen, session, holiday, t}。"""
        self._calls += 1
        return _facade().market_status(exchange) or {}

    # ── 基本面 / 评级 ─────────────────────────────────────────────────────
    def get_basic_financials(self, symbol: str, metric: str = "all") -> dict:
        """基础财务指标 (PE/PB/margin/52周高低/beta 等)。返回 metric 子对象。"""
        self._calls += 1
        bf = _facade().basic_financials(symbol, metric)
        return (bf.get("metric", {}) if isinstance(bf, dict) else {}) or {}

    def get_recommendation_trends(self, symbol: str) -> list:
        """分析师买卖评级趋势: [{period, strongBuy, buy, hold, sell, strongSell}]。"""
        self._calls += 1
        return _facade().ratings(symbol) or []

    def get_earnings_surprises(self, symbol: str) -> list:
        """历史 EPS surprise: [{period, actual, estimate, surprise, surprisePercent}]。"""
        self._calls += 1
        return _facade().earnings(symbol) or []

    # ── 内部人 ────────────────────────────────────────────────────────────
    def get_insider_transactions(self, symbol: str) -> list:
        """内部人交易明细。"""
        self._calls += 1
        return _facade().insider(symbol) or []

    def get_insider_sentiment(self, symbol: str, from_date: str, to_date: str) -> list:
        """内部人情绪 (MSPR)。facade 无对应端点（Finnhub 付费），优雅返回空。"""
        return []

    # ── 日历 ──────────────────────────────────────────────────────────────
    def get_earnings_calendar(self, from_date: str, to_date: str) -> list:
        """财报日历: [{symbol,date,epsEstimate,epsActual,...}]。"""
        self._calls += 1
        return _facade().earnings_calendar(from_date, to_date) or []

    def get_ipo_calendar(self, from_date: str, to_date: str) -> list:
        """IPO 日历。facade 无对应端点（Finnhub 付费），优雅返回空。"""
        return []

    def get_economic_calendar(self) -> list:
        """经济日历: [{date,event,country,currency,release_id}]（facade → FRED 发布日历）。"""
        self._calls += 1
        return _facade().economic_calendar() or []
