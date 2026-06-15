#!/usr/bin/env python3
"""
Alpaca 数据源 —— vcp screener 的 universe + 行情/历史来源（替代已被阉割的 FMP）。

为什么用 Alpaca：
  - FMP 免费档已不再提供 S&P500 成分（sp500-constituent 付费）、CSV 批量报价（付费），
    逐只报价会瞬间打爆 FMP 免费日额度（~250/天）。
  - Alpaca 免费档：get_all_assets 给全美股 universe；StockBars(IEX feed) 支持
    **一次请求多 symbol** 的批量日线，几十个请求即可覆盖全市场。

接口对 vcp 保持 drop-in：方法名/返回结构与原 FMPClient 一致
  - get_sp500_constituents() -> [{symbol,name,sector,exchange}]  （实为全美股 universe）
  - get_batch_quotes(symbols) -> {symbol: {price,yearHigh,yearLow,avgVolume,name,...}}
  - get_historical_prices(symbol, days) -> {"symbol", "historical":[{date,open,high,low,close,adjClose,volume}]}
  - get_api_stats() -> dict

成本设计（两段批量）：
  1) 先批量拉最近 ~15 日 bars，按 price>$10 & 近 15 日均量>200k 粗筛（去掉绝大多数低质标的）；
  2) 幸存者再批量拉 ~1 年日线，本地算 52 周高/低 + 50 日均量，并缓存整段历史供 Phase 2 复用。

环境变量：APCA_API_KEY_ID / APCA_API_SECRET_KEY
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta
from typing import Optional

try:
    from alpaca.trading.client import TradingClient
    from alpaca.trading.requests import GetAssetsRequest
    from alpaca.trading.enums import AssetClass, AssetStatus
    from alpaca.data.historical import StockHistoricalDataClient
    from alpaca.data.requests import StockBarsRequest
    from alpaca.data.timeframe import TimeFrame
    from alpaca.data.enums import Adjustment, DataFeed
except ImportError:
    print("ERROR: alpaca-py not installed. Run: pip install alpaca-py", file=sys.stderr)
    raise

MAJOR_EXCHANGES = {"NYSE", "NASDAQ", "ARCA", "AMEX"}
# ETF/基金/信托名称特征（VCP 是个股形态工具，排除非个股）。按 name 小写子串匹配。
ETF_NAME_MARKERS = (
    "etf", "etn", " fund", "index fund", "ishares", "spdr", "proshares",
    "invesco", "vaneck", "wisdomtree", "direxion", "global x", "first trust",
    "trust ", " trust", "portfolio", " reit", "etfmg", " ucits",
)
BARS_CHUNK = 200          # 每次批量请求的 symbol 数
PREFILTER_MIN_PRICE = 10.0
PREFILTER_MIN_AVGVOL = 200_000
PREFILTER_RECENT_DAYS = 15


class AlpacaSource:
    """vcp 数据源（drop-in 替代 FMPClient）。"""

    def __init__(self, api_key: Optional[str] = None, api_secret: Optional[str] = None):
        self.api_key = api_key or os.getenv("APCA_API_KEY_ID")
        self.api_secret = api_secret or os.getenv("APCA_API_SECRET_KEY")
        if not self.api_key or not self.api_secret:
            raise ValueError(
                "Alpaca credentials required. Set APCA_API_KEY_ID / APCA_API_SECRET_KEY."
            )
        self._trading = TradingClient(self.api_key, self.api_secret, paper=True)
        self._data = StockHistoricalDataClient(self.api_key, self.api_secret)
        self._name_map: dict[str, str] = {}
        self._hist_cache: dict[str, list[dict]] = {}   # {symbol: bars desc}
        self._requests = 0

    # ── universe ──────────────────────────────────────────────────────────
    def get_sp500_constituents(self, limit: Optional[int] = None,
                               exclude_etf: bool = True) -> Optional[list[dict]]:
        """返回全美股可交易 universe（保留方法名以兼容 vcp）。exclude_etf=True 时
        按名称特征剔除 ETF/基金/信托/REIT（VCP 为个股形态工具）。"""
        try:
            req = GetAssetsRequest(asset_class=AssetClass.US_EQUITY, status=AssetStatus.ACTIVE)
            assets = self._trading.get_all_assets(req)
            self._requests += 1
        except Exception as exc:  # noqa: BLE001
            print(f"ERROR: Alpaca get_all_assets failed: {exc}", file=sys.stderr)
            return None

        out = []
        seen = set()
        for a in assets:
            if not a.tradable or a.symbol in seen:
                continue
            exch = a.exchange.value if a.exchange else ""
            if exch not in MAJOR_EXCHANGES:
                continue
            if "." in a.symbol or "/" in a.symbol:  # 跳过 warrant/units/异常符号
                continue
            name_l = (a.name or "").lower()
            if exclude_etf and any(m in name_l for m in ETF_NAME_MARKERS):
                continue
            seen.add(a.symbol)
            self._name_map[a.symbol] = a.name or a.symbol
            out.append(
                {"symbol": a.symbol, "name": a.name or a.symbol,
                 "sector": "Unknown", "exchange": exch}
            )
        if limit:
            out = out[:limit]
        return out

    # ── 批量历史（内部） ──────────────────────────────────────────────────
    def _fetch_bars(self, symbols: list[str], days: int) -> dict[str, list[dict]]:
        """批量日线，返回 {symbol: [bar...]}（most-recent-first）。bar 含
        date/open/high/low/close/adjClose/volume。按 BARS_CHUNK 分块。"""
        start = datetime.now() - timedelta(days=int(days) + 10)
        result: dict[str, list[dict]] = {}
        for i in range(0, len(symbols), BARS_CHUNK):
            chunk = symbols[i:i + BARS_CHUNK]
            try:
                req = StockBarsRequest(
                    symbol_or_symbols=chunk, timeframe=TimeFrame.Day, start=start,
                    adjustment=Adjustment.ALL, feed=DataFeed.IEX,
                )
                bars = self._data.get_stock_bars(req)
                self._requests += 1
            except Exception as exc:  # noqa: BLE001
                print(f"WARNING: Alpaca bars chunk failed ({chunk[0]}..): {exc}", file=sys.stderr)
                continue
            data = getattr(bars, "data", {}) or {}
            for sym, sym_bars in data.items():
                rows = [
                    {
                        "date": b.timestamp.strftime("%Y-%m-%d"),
                        "open": float(b.open), "high": float(b.high),
                        "low": float(b.low), "close": float(b.close),
                        "adjClose": float(b.close), "volume": float(b.volume),
                    }
                    for b in sym_bars
                ]
                rows.reverse()  # most-recent-first，与 FMP 一致
                result[sym] = rows
        return result

    @staticmethod
    def _derive_quote(bars: list[dict], name: str) -> Optional[dict]:
        """从 bars 推导 vcp pre_filter 需要的 quote 字段。"""
        if not bars:
            return None
        window = bars[:252]  # 约 52 周
        highs = [b["high"] for b in window]
        lows = [b["low"] for b in window]
        vols = [b["volume"] for b in bars[:50]] or [b["volume"] for b in window]
        return {
            "symbol": bars[0].get("symbol"),
            "price": bars[0]["close"],
            "yearHigh": max(highs) if highs else 0,
            "yearLow": min(lows) if lows else 0,
            "avgVolume": (sum(vols) / len(vols)) if vols else 0,
            "marketCap": 0,        # Alpaca 不提供，展示用，降级为 0
            "name": name,
            "sector": "Unknown",
        }

    # ── drop-in 接口 ──────────────────────────────────────────────────────
    def get_batch_quotes(self, symbols: list[str]) -> dict[str, dict]:
        """两段批量：粗筛(15d) → 幸存者拉满 1 年并缓存历史，返回 {symbol: quote}。"""
        # Stage A: 最近 15 日，廉价过滤 price/量
        recent = self._fetch_bars(symbols, PREFILTER_RECENT_DAYS)
        survivors = []
        for sym, bars in recent.items():
            if not bars:
                continue
            price = bars[0]["close"]
            avgvol = sum(b["volume"] for b in bars) / len(bars)
            if price > PREFILTER_MIN_PRICE and avgvol > PREFILTER_MIN_AVGVOL:
                survivors.append(sym)

        # Stage B: 幸存者拉 1 年日线（缓存供 Phase 2 复用）
        full = self._fetch_bars(survivors, 365)
        quotes: dict[str, dict] = {}
        for sym, bars in full.items():
            if not bars:
                continue
            self._hist_cache[sym] = bars
            q = self._derive_quote(bars, self._name_map.get(sym, sym))
            if q:
                q["symbol"] = sym
                quotes[sym] = q
        return quotes

    def get_historical_prices(self, symbol: str, days: int = 365) -> Optional[dict]:
        """单只历史。优先命中 get_batch_quotes 阶段的缓存（如 SPY 不在 universe 则现拉）。"""
        bars = self._hist_cache.get(symbol)
        if bars is None:
            fetched = self._fetch_bars([symbol], days)
            bars = fetched.get(symbol)
            if bars:
                self._hist_cache[symbol] = bars
        if not bars:
            return None
        return {"symbol": symbol, "historical": bars[:days] if days else bars}

    def get_api_stats(self) -> dict:
        return {
            "provider": "alpaca",
            "api_calls_made": self._requests,        # vcp/report 兼容键
            "cache_entries": len(self._hist_cache),  # vcp/report 兼容键
            "requests_made": self._requests,
            "cached_symbols": len(self._hist_cache),
        }
