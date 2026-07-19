#!/usr/bin/env python3
"""FMP-compatible client for the bullish scanners, backed by the data-access facade.

Historically this hit Financial Modeling Prep directly; per the decoupling plan it
now reads everything through the data-access facade (``import data_access``), which
proxies the same data — quote/history via market-hub+warehouse, profile/income-
statement/earnings-calendar/treasury via reference-data. Method signatures and the
v3-compatible return shapes are preserved so screen_canslim / screen_vcp need no
change. Paid-only endpoints (sp500-constituent, institutional-holder) still return
None, so callers keep their existing fallbacks.

For A股/港股 ticker, see shared/market_router.py + shared/data_client.py (get_data_client).
"""

import os
import sys
from typing import Optional

_data = None


def _facade():
    """Lazily import the data-access facade SDK (the single read path)."""
    global _data
    if _data is None:
        pkg = os.environ.get("DATA_ACCESS_PKG", os.path.expanduser("~/nimbus-os/services/data-access"))
        if pkg not in sys.path:
            sys.path.insert(0, pkg)
        import data_access as data  # noqa: PLC0415
        _data = data
    return _data


class ApiCallBudgetExceeded(Exception):
    """Raised when the API call budget has been exhausted."""

    pass


class FMPClient:
    """Facade-backed drop-in for the former FMP /stable client (v3-compatible shapes)."""

    US_EXCHANGES = ["NYSE", "NASDAQ", "AMEX", "NYSEArca", "BATS", "NMS", "NGM", "NCM"]

    def __init__(self, api_key: Optional[str] = None, max_api_calls: int = 200):
        self.api_key = api_key or os.getenv("FMP_API_KEY")  # unused; kept for compat
        self.cache: dict = {}
        self.rate_limit_reached = False
        self.api_calls_made = 0
        self.max_api_calls = max_api_calls

    def _budget(self) -> None:
        if self.api_calls_made >= self.max_api_calls:
            raise ApiCallBudgetExceeded(
                f"API call budget exceeded: {self.api_calls_made}/{self.max_api_calls} calls used."
            )
        self.api_calls_made += 1

    # ── 日历 ──────────────────────────────────────────────────────────────
    def get_earnings_calendar(self, from_date: str, to_date: str) -> Optional[list]:
        key = f"earnings_{from_date}_{to_date}"
        if key in self.cache:
            return self.cache[key]
        self._budget()
        rows = _facade().earnings_calendar(from_date, to_date) or []
        for e in rows:  # v3 兼容字段
            e.setdefault("time", "")
            e.setdefault("eps", e.get("epsActual"))
            e.setdefault("revenue", e.get("revenueActual"))
        self.cache[key] = rows
        return rows

    # ── 公司 / 行情 ───────────────────────────────────────────────────────
    def get_profile(self, symbol: str) -> Optional[list]:
        key = f"profile_{symbol}"
        if key in self.cache:
            return self.cache[key]
        self._budget()
        out = []
        for p in _facade().profile(symbol) or []:
            out.append({**p, "companyName": p.get("name"),
                        "mktCap": p.get("marketCap"), "marketCap": p.get("marketCap")})
        if out:
            self.cache[key] = out
        return out or None

    def get_company_profiles(self, symbols: list) -> dict:
        profiles = {}
        for sym in symbols:
            data = self.get_profile(sym)
            if data and data[0].get("symbol"):
                profiles[data[0]["symbol"]] = data[0]
        return profiles

    def get_quote(self, symbols: str) -> Optional[list]:
        key = f"quote_{symbols}"
        if key in self.cache:
            return self.cache[key]
        syms = [s.strip() for s in symbols.split(",") if s.strip()]
        self._budget()
        out = []
        for q in _facade().quote(*syms) or []:
            out.append({
                "symbol": q.get("symbol"), "name": q.get("name"),
                "price": q.get("last"), "change": q.get("change"),
                "changesPercentage": q.get("change_pct"),
                "dayHigh": q.get("high"), "dayLow": q.get("low"),
                "open": q.get("open"), "previousClose": q.get("prev_close"),
                "volume": q.get("volume"), "avgVolume": None,
            })
        if out:
            self.cache[key] = out
            return out
        return None

    def get_batch_quotes(self, symbols: list) -> dict:
        result = {}
        for sym in symbols:
            data = self.get_quote(sym)
            if data and data[0].get("symbol"):
                result[data[0]["symbol"]] = data[0]
        return result

    def get_historical_prices(self, symbol: str, days: int = 365) -> Optional[dict]:
        """历史日线，v3 兼容: {'symbol','historical':[{date,open,high,low,close,
        adjClose,volume}]}（most-recent-first）。"""
        key = f"prices_{symbol}_{days}"
        if key in self.cache:
            return self.cache[key]
        self._budget()
        hist = [{
            "date": b.get("trade_date"), "open": b.get("open"), "high": b.get("high"),
            "low": b.get("low"), "close": b.get("close"), "adjClose": b.get("close"),
            "volume": b.get("volume"),
        } for b in (_facade().history(symbol, limit=days) or [])]
        hist.sort(key=lambda x: x.get("date") or "", reverse=True)  # most-recent-first
        if not hist:
            return None
        result = {"symbol": symbol, "historical": hist}
        self.cache[key] = result
        return result

    def get_batch_historical(self, symbols: list, days: int = 50) -> dict:
        result = {}
        for sym in symbols:
            data = self.get_historical_prices(sym, days)
            if data and data.get("historical"):
                result[sym] = data["historical"]
        return result

    # ── 基本面 ────────────────────────────────────────────────────────────
    def get_income_statement(self, symbol: str, period: str = "quarter",
                             limit: int = 8) -> Optional[list]:
        key = f"income_{symbol}_{period}_{limit}"
        if key in self.cache:
            return self.cache[key]
        self._budget()
        rows = _facade().income_statement(symbol, period, limit) or []
        if rows:
            self.cache[key] = rows
        return rows or None

    # ── 宏观 ──────────────────────────────────────────────────────────────
    def get_treasury_rates(self, days: int = 600) -> Optional[list]:
        """美债收益率曲线: [{date,year10,year2}]（most-recent-first），由 FRED DGS10/DGS2 合成。"""
        key = f"treasury_{days}"
        if key in self.cache:
            return self.cache[key]
        self._budget()
        data = _facade()
        by_date: dict = {}
        for series, col in (("DGS10", "year10"), ("DGS2", "year2")):
            for r in data.macro(series, limit=max(days, 400)) or []:
                dt = (r.get("date") or "")[:10]
                if dt:
                    by_date.setdefault(dt, {})[col] = r.get(series)
        rows = [{"date": dt, "year10": v.get("year10"), "year2": v.get("year2")}
                for dt, v in by_date.items()]
        rows.sort(key=lambda x: x["date"], reverse=True)
        if rows:
            self.cache[key] = rows
        return rows or None

    # ── 衍生指标 ──────────────────────────────────────────────────────────
    def get_vix_term_structure(self) -> Optional[dict]:
        """VIX 期限结构: 比较 VIX 与 VIX3M。返回 ratio / classification。"""
        vix_quotes = self.get_quote("^VIX")
        vix3m_quotes = self.get_quote("^VIX3M")
        if not vix_quotes or not vix3m_quotes:
            return None
        vix_price = vix_quotes[0].get("price") or 0
        vix3m_price = vix3m_quotes[0].get("price") or 0
        if vix3m_price <= 0:
            return None
        ratio = vix_price / vix3m_price
        if ratio < 0.85:
            classification = "steep_contango"
        elif ratio < 0.95:
            classification = "contango"
        elif ratio <= 1.05:
            classification = "flat"
        else:
            classification = "backwardation"
        return {"vix": round(vix_price, 2), "vix3m": round(vix3m_price, 2),
                "ratio": round(ratio, 3), "classification": classification}

    @staticmethod
    def calculate_sma(prices: list, period: int) -> float:
        if not prices or len(prices) < period:
            return 0.0
        return sum(prices[:period]) / period

    @staticmethod
    def calculate_ema(prices: list, period: int = 50) -> float:
        """指数移动平均（prices 为 most-recent-first）。"""
        if not prices or len(prices) < period:
            return 0.0
        series = list(reversed(prices))
        k = 2 / (period + 1)
        ema = series[0]
        for p in series[1:]:
            ema = p * k + ema * (1 - k)
        return ema

    # ── 付费缺口：优雅降级（与原行为一致）────────────────────────────────
    def get_sp500_constituents(self) -> Optional[list]:
        """⚠️ S&P500 成分股为付费端点；facade 无对应能力，返回 None（调用方自备 universe）。"""
        return None

    def get_institutional_holders(self, symbol: str) -> Optional[list]:
        """⚠️ 机构持仓(13F by holder)为付费端点；返回 None。"""
        return None

    # ── 杂项 ──────────────────────────────────────────────────────────────
    def clear_cache(self):
        self.cache.clear()

    def get_api_stats(self) -> dict:
        return {
            "cache_entries": len(self.cache),
            "api_calls_made": self.api_calls_made,
            "max_api_calls": self.max_api_calls,
            "rate_limit_reached": self.rate_limit_reached,
        }


def get_data_client(api_key=None, ticker_hint=None):
    """根据 ticker 自动选择数据客户端。"""
    if ticker_hint:
        shared_dir = os.path.join(os.path.dirname(__file__), '..', '..', 'shared')
        if shared_dir not in sys.path:
            sys.path.insert(0, shared_dir)
        try:
            from market_router import detect_market, normalize_ticker
            market = detect_market(normalize_ticker(ticker_hint))
            if market in ("A_SHARE", "HK", "CRYPTO", "COMMODITY"):
                from data_client import DataClient
                return DataClient(fmp_api_key=api_key)
        except ImportError:
            pass
    return FMPClient(api_key=api_key)
