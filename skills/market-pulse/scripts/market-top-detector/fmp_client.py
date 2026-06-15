#!/usr/bin/env python3
"""
# === 多市场支持 ===
# 对于 A 股/港股 ticker，FMP API 不可用。
# 使用 shared/akshare_client.py 和 shared/market_router.py 作为替代数据源。
# 用法: from shared.market_router import detect_market
#       from shared.akshare_client import AKShareClient
# 当 detect_market(ticker) 返回 "A_SHARE" 或 "HK" 时，
# 应使用 AKShareClient 替代 FMPClient 获取数据。

FMP API Client (stable endpoints)

==============================================================================
重要：FMP 已于 2025 下线 /api/v3 旧端点（403 Legacy Endpoint），本 client 全部
改用新的 /stable 端点。返回结构经字段重映射，对调用方保持 v3 兼容（drop-in）。

免费档实测可用：quote / profile / historical-price-eod / income-statement /
balance-sheet / cash-flow / ratios(-ttm) / key-metrics(-ttm) / grades /
analyst-estimates / earnings / dividends / splits / market-cap /
earnings-calendar / treasury-rates / economic-indicators / sector-performance /
biggest-gainers·losers·most-actives / search-symbol。

免费档已不可用（402 付费），下列方法将优雅返回 None 并告警：
  - quote/profile 的 CSV 批量（改为逐只循环，见 get_batch_*）
  - sp500-constituent（get_sp500_constituents）
  - institutional-ownership/holder（get_institutional_holders）
  - news/*（新闻改用 finnhub_client）
==============================================================================

Features:
- Rate limiting (0.3s between requests)
- Automatic retry on 429 errors
- Session caching for duplicate requests
- API call budget enforcement
- v3→stable 字段重映射，调用方零改动
"""

import os
import sys
import time
from datetime import datetime, timedelta
from typing import Optional

try:
    import requests
except ImportError:
    print("ERROR: requests library not found. Install with: pip install requests", file=sys.stderr)
    sys.exit(1)


class ApiCallBudgetExceeded(Exception):
    """Raised when the API call budget has been exhausted."""

    pass


class FMPClient:
    """Client for Financial Modeling Prep /stable API with rate limiting, caching, budget control."""

    BASE_URL = "https://financialmodelingprep.com/stable"
    RATE_LIMIT_DELAY = 0.3  # 300ms between requests
    US_EXCHANGES = ["NYSE", "NASDAQ", "AMEX", "NYSEArca", "BATS", "NMS", "NGM", "NCM"]

    def __init__(self, api_key: Optional[str] = None, max_api_calls: int = 200):
        self.api_key = api_key or os.getenv("FMP_API_KEY")
        if not self.api_key:
            raise ValueError(
                "FMP API key required. Set FMP_API_KEY environment variable "
                "or pass api_key parameter."
            )
        self.session = requests.Session()
        self.cache = {}
        self.last_call_time = 0
        self.rate_limit_reached = False
        self.retry_count = 0
        self.max_retries = 1
        self.api_calls_made = 0
        self.max_api_calls = max_api_calls

    def _rate_limited_get(self, url: str, params: Optional[dict] = None) -> Optional[dict]:
        """Execute a rate-limited GET request with budget enforcement.

        url 可为 /stable 端点全路径；params 不含 apikey（自动注入）。
        402（付费受限）静默返回 None，由上层方法处理降级。
        """
        if self.rate_limit_reached:
            return None

        if self.api_calls_made >= self.max_api_calls:
            raise ApiCallBudgetExceeded(
                f"API call budget exceeded: {self.api_calls_made}/{self.max_api_calls} calls used."
            )

        if params is None:
            params = {}
        params["apikey"] = self.api_key

        elapsed = time.time() - self.last_call_time
        if elapsed < self.RATE_LIMIT_DELAY:
            time.sleep(self.RATE_LIMIT_DELAY - elapsed)

        try:
            response = self.session.get(url, params=params, timeout=30)
            self.last_call_time = time.time()
            self.api_calls_made += 1

            if response.status_code == 200:
                self.retry_count = 0
                return response.json()
            elif response.status_code == 402:
                # 付费受限端点：静默降级（上层方法决定 fallback）
                print(
                    f"WARNING: FMP restricted (paid) endpoint, skipping: {url}",
                    file=sys.stderr,
                )
                return None
            elif response.status_code == 429:
                self.retry_count += 1
                if self.retry_count <= self.max_retries:
                    print("WARNING: Rate limit exceeded. Waiting 60 seconds...", file=sys.stderr)
                    time.sleep(60)
                    return self._rate_limited_get(url, params)
                else:
                    print("ERROR: Daily API rate limit reached.", file=sys.stderr)
                    self.rate_limit_reached = True
                    return None
            else:
                print(
                    f"ERROR: API request failed: {response.status_code} - {response.text[:200]}",
                    file=sys.stderr,
                )
                return None
        except requests.exceptions.Timeout:
            print(f"WARNING: Request timed out for {url}", file=sys.stderr)
            return None
        except requests.exceptions.RequestException as e:
            print(f"ERROR: Request exception: {e}", file=sys.stderr)
            return None

    # ── 内部工具 ──────────────────────────────────────────────────────────
    @staticmethod
    def _days_to_range(days: int) -> tuple[str, str]:
        """把 days 转成 stable 需要的 from/to 日历日范围（多取 1.5x 缓冲覆盖周末/节假日）。"""
        to_d = datetime.utcnow().date()
        from_d = to_d - timedelta(days=int(days * 1.5) + 5)
        return from_d.isoformat(), to_d.isoformat()

    # ── 日历 ──────────────────────────────────────────────────────────────
    def get_earnings_calendar(self, from_date: str, to_date: str) -> Optional[list]:
        """财报日历 [from,to]。注：stable 无 'time'(bmo/amc) 字段，已补空串保持兼容。"""
        cache_key = f"earnings_{from_date}_{to_date}"
        if cache_key in self.cache:
            return self.cache[cache_key]

        url = f"{self.BASE_URL}/earnings-calendar"
        params = {"from": from_date, "to": to_date}
        data = self._rate_limited_get(url, params)
        if data and isinstance(data, list):
            for e in data:
                # v3 兼容字段
                e.setdefault("time", "")
                if "eps" not in e:
                    e["eps"] = e.get("epsActual")
                if "revenue" not in e:
                    e["revenue"] = e.get("revenueActual")
            self.cache[cache_key] = data
        return data

    # ── 公司 / 行情 ───────────────────────────────────────────────────────
    def get_profile(self, symbol: str) -> Optional[list]:
        """公司简介（返回单元素 list，字段含 companyName/sector/industry/marketCap）。"""
        cache_key = f"profile_{symbol}"
        if cache_key in self.cache:
            return self.cache[cache_key]

        url = f"{self.BASE_URL}/profile"
        data = self._rate_limited_get(url, {"symbol": symbol})
        if data and isinstance(data, list):
            for p in data:
                p.setdefault("mktCap", p.get("marketCap"))  # v3 别名
            self.cache[cache_key] = data
        return data

    def get_company_profiles(self, symbols: list[str]) -> dict[str, dict]:
        """批量公司简介。stable CSV 批量为付费，改为逐只循环。返回 {symbol: profile}。"""
        profiles = {}
        for sym in symbols:
            data = self.get_profile(sym)
            if data and isinstance(data, list) and data:
                p = data[0]
                if isinstance(p, dict) and p.get("symbol"):
                    profiles[p["symbol"]] = p
        return profiles

    def get_quote(self, symbols: str) -> Optional[list[dict]]:
        """实时报价。symbols 可为单只或逗号分隔；stable CSV 批量付费，故按逗号拆分逐只查。
        字段对 v3 兼容：补 changesPercentage / avgVolume 别名。"""
        cache_key = f"quote_{symbols}"
        if cache_key in self.cache:
            return self.cache[cache_key]

        out: list[dict] = []
        for sym in [s.strip() for s in symbols.split(",") if s.strip()]:
            data = self._rate_limited_get(f"{self.BASE_URL}/quote", {"symbol": sym})
            if data and isinstance(data, list):
                for q in data:
                    q.setdefault("changesPercentage", q.get("changePercentage"))
                    q.setdefault("avgVolume", q.get("averageVolume"))
                out.extend(data)
        if out:
            self.cache[cache_key] = out
            return out
        return None

    def get_batch_quotes(self, symbols: list[str]) -> dict[str, dict]:
        """逐只报价，返回 {symbol: quote}。"""
        result = {}
        for sym in symbols:
            data = self.get_quote(sym)
            if data and isinstance(data, list) and data:
                q = data[0]
                if isinstance(q, dict) and q.get("symbol"):
                    result[q["symbol"]] = q
        return result

    def get_historical_prices(self, symbol: str, days: int = 365) -> Optional[dict]:
        """历史日线。返回 v3 兼容结构 {'symbol', 'historical':[{date,open,high,low,close,
        adjClose,volume,...}]}（most-recent-first）。stable 已分红/拆股调整，adjClose=close 别名。"""
        cache_key = f"prices_{symbol}_{days}"
        if cache_key in self.cache:
            return self.cache[cache_key]

        from_d, to_d = self._days_to_range(days)
        url = f"{self.BASE_URL}/historical-price-eod/full"
        data = self._rate_limited_get(url, {"symbol": symbol, "from": from_d, "to": to_d})
        if not data or not isinstance(data, list):
            return None

        # stable 返回 most-recent-first 的 flat list；补 adjClose 别名
        for bar in data:
            bar.setdefault("adjClose", bar.get("close"))
        result = {"symbol": symbol, "historical": data}
        self.cache[cache_key] = result
        return result

    def get_batch_historical(self, symbols: list[str], days: int = 50) -> dict[str, list[dict]]:
        """逐只历史日线，返回 {symbol: [bars...]}。"""
        result = {}
        for sym in symbols:
            data = self.get_historical_prices(sym, days)
            if data and data.get("historical"):
                result[sym] = data["historical"]
        return result

    # ── 基本面 ────────────────────────────────────────────────────────────
    def get_income_statement(
        self, symbol: str, period: str = "quarter", limit: int = 8
    ) -> Optional[list[dict]]:
        """利润表（period: quarter|annual）。"""
        cache_key = f"income_{symbol}_{period}_{limit}"
        if cache_key in self.cache:
            return self.cache[cache_key]

        url = f"{self.BASE_URL}/income-statement"
        params = {"symbol": symbol, "period": period, "limit": limit}
        data = self._rate_limited_get(url, params)
        if data:
            self.cache[cache_key] = data
        return data

    # ── 宏观（macro-regime 已在用 stable）────────────────────────────────
    def get_treasury_rates(self, days: int = 600) -> Optional[list[dict]]:
        """美债收益率曲线历史。"""
        cache_key = f"treasury_{days}"
        if cache_key in self.cache:
            return self.cache[cache_key]

        from_d, to_d = self._days_to_range(days)
        url = f"{self.BASE_URL}/treasury-rates"
        data = self._rate_limited_get(url, {"from": from_d, "to": to_d})
        if data:
            self.cache[cache_key] = data
        return data

    # ── 衍生指标 ──────────────────────────────────────────────────────────
    def get_vix_term_structure(self) -> Optional[dict]:
        """VIX 期限结构：比较 VIX 与 VIX3M。返回 ratio / classification。"""
        vix_quotes = self.get_quote("^VIX")
        vix3m_quotes = self.get_quote("^VIX3M")
        if not vix_quotes or not vix3m_quotes:
            return None

        vix_price = vix_quotes[0].get("price", 0)
        vix3m_price = vix3m_quotes[0].get("price", 0)
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

        return {
            "vix": round(vix_price, 2),
            "vix3m": round(vix3m_price, 2),
            "ratio": round(ratio, 3),
            "classification": classification,
        }

    @staticmethod
    def calculate_sma(prices: list[float], period: int) -> float:
        """简单移动平均（取最近 period 个）。"""
        if not prices or len(prices) < period:
            return 0.0
        return sum(prices[:period]) / period

    @staticmethod
    def calculate_ema(prices: list[float], period: int = 50) -> float:
        """指数移动平均（prices 为 most-recent-first）。"""
        if not prices or len(prices) < period:
            return 0.0
        series = list(reversed(prices))
        k = 2 / (period + 1)
        ema = series[0]
        for p in series[1:]:
            ema = p * k + ema * (1 - k)
        return ema

    # ── 付费缺口：优雅降级 ────────────────────────────────────────────────
    def get_sp500_constituents(self) -> Optional[list[dict]]:
        """⚠️ S&P500 成分股在 FMP 免费档为付费端点（402）。返回 None；
        调用方需自备 universe（如静态列表 / 其他免费源）。"""
        print(
            "WARNING: sp500-constituent is a paid FMP endpoint; returning None. "
            "Provide a universe via static list or alternate source.",
            file=sys.stderr,
        )
        return None

    def get_institutional_holders(self, symbol: str) -> Optional[list[dict]]:
        """⚠️ 机构持仓（13F）在 FMP 免费档为付费端点（402）。返回 None。"""
        print(
            f"WARNING: institutional-holder is a paid FMP endpoint; returning None for {symbol}.",
            file=sys.stderr,
        )
        return None

    # ── 杂项 ──────────────────────────────────────────────────────────────
    def clear_cache(self):
        """清空会话缓存。"""
        self.cache.clear()

    def get_api_stats(self) -> dict:
        """API 用量统计。"""
        return {
            "cache_entries": len(self.cache),
            "api_calls_made": self.api_calls_made,
            "max_api_calls": self.max_api_calls,
            "rate_limit_reached": self.rate_limit_reached,
        }


def get_data_client(api_key=None, ticker_hint=None):
    """根据 ticker 自动选择数据客户端"""
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
