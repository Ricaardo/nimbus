#!/usr/bin/env python3
"""Collect lightweight market context for Binance Square content generation."""

from __future__ import annotations

import argparse
import html
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any

from botlib import connect_db, init_db, load_config


BINANCE_24H_URL = "https://api.binance.com/api/v3/ticker/24hr"
BINANCE_ANNOUNCEMENTS_URL = "https://www.binance.com/bapi/composite/v1/public/cms/article/list/query"
GDELT_DOC_URL = "https://api.gdeltproject.org/api/v2/doc/doc"


def fetch_json(url: str, timeout: int = 10, data: bytes | None = None) -> Any:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https":
        raise ValueError(f"unsupported URL scheme: {parsed.scheme}")
    headers = {"User-Agent": "binance-square-bot/1.0"}
    request = urllib.request.Request(url, data=data, headers=headers, method="POST" if data else "GET")
    if data:
        request.add_header("Content-Type", "application/json")
    # URL scheme is restricted to https above.
    with urllib.request.urlopen(request, timeout=timeout) as response:  # nosec B310
        return json.loads(response.read().decode("utf-8"))


def fetch_text(url: str, timeout: int = 10) -> str:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https":
        raise ValueError(f"unsupported URL scheme: {parsed.scheme}")
    request = urllib.request.Request(url, headers={"User-Agent": "binance-square-bot/1.0"})
    # URL scheme is restricted to https above.
    with urllib.request.urlopen(request, timeout=timeout) as response:  # nosec B310
        return response.read().decode("utf-8", errors="replace")


def offline_tickers(symbols: list[str]) -> list[dict[str, Any]]:
    return [
        {
            "symbol": symbol,
            "lastPrice": "0",
            "priceChangePercent": "0",
            "highPrice": "0",
            "lowPrice": "0",
            "volume": "0",
            "quoteVolume": "0",
            "offline": True,
        }
        for symbol in symbols
    ]


def normalize_ticker(item: dict[str, Any]) -> dict[str, Any]:
    def number(key: str) -> float:
        try:
            return float(item.get(key) or 0)
        except (TypeError, ValueError):
            return 0.0

    return {
        "symbol": item.get("symbol", ""),
        "price": number("lastPrice"),
        "change_pct": number("priceChangePercent"),
        "high_24h": number("highPrice"),
        "low_24h": number("lowPrice"),
        "volume": number("volume"),
        "quote_volume": number("quoteVolume"),
        "raw": item,
    }


def severity_from_ticker(ticker: dict[str, Any]) -> str:
    change = abs(float(ticker.get("change_pct") or 0))
    if change >= 10:
        return "S2"
    if change >= 4:
        return "S1"
    return "S0"


def collect_tickers(config: dict[str, Any], offline: bool) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    symbols = config.get("watch_symbols", ["BTCUSDT", "ETHUSDT", "BNBUSDT"])
    min_quote_volume = float(config.get("market_filters", {}).get("top_mover_min_quote_volume_usdt", 0))
    try:
        all_tickers = offline_tickers(symbols) if offline else fetch_json(BINANCE_24H_URL)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        all_tickers = offline_tickers(symbols)
        for item in all_tickers:
            item["fallback_error"] = str(exc)

    by_symbol = {item.get("symbol"): item for item in all_tickers if item.get("symbol")}
    watch = [normalize_ticker(by_symbol.get(symbol, {"symbol": symbol})) for symbol in symbols]

    candidates = [
        normalize_ticker(item)
        for item in all_tickers
        if str(item.get("symbol", "")).endswith("USDT")
        and not str(item.get("symbol", "")).endswith(("UPUSDT", "DOWNUSDT", "BULLUSDT", "BEARUSDT"))
    ]
    candidates = [ticker for ticker in candidates if ticker["quote_volume"] >= min_quote_volume]
    top_movers = sorted(candidates, key=lambda t: abs(t["change_pct"]), reverse=True)[:10]
    return watch, top_movers


def collect_announcements(offline: bool) -> list[dict[str, Any]]:
    if offline:
        return []
    payload = json.dumps({"type": 1, "pageNo": 1, "pageSize": 5}).encode("utf-8")
    try:
        data = fetch_json(BINANCE_ANNOUNCEMENTS_URL, data=payload)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return []
    articles = data.get("data", {}).get("catalogs", [])
    flattened = []
    for catalog in articles:
        for article in catalog.get("articles", [])[:5]:
            flattened.append(
                {
                    "title": article.get("title", ""),
                    "url": f"https://www.binance.com/en/support/announcement/{article.get('code', '')}",
                    "release_date": article.get("releaseDate"),
                }
            )
    return flattened[:5]


def clean_text(value: str | None) -> str:
    if not value:
        return ""
    value = re.sub(r"<!\[CDATA\[(.*?)\]\]>", r"\1", value, flags=re.DOTALL)
    value = html.unescape(value)
    value = re.sub(r"<[^>]+>", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def first_tag_text(block: str, names: tuple[str, ...]) -> str:
    for name in names:
        match = re.search(rf"<(?:[A-Za-z0-9_-]+:)?{name}\b[^>]*>(.*?)</(?:[A-Za-z0-9_-]+:)?{name}>", block, re.IGNORECASE | re.DOTALL)
        if match:
            return clean_text(match.group(1))
    return ""


def first_tag_attr(block: str, name: str, attr: str) -> str:
    tag_match = re.search(rf"<(?:[A-Za-z0-9_-]+:)?{name}\b([^>]*)>", block, re.IGNORECASE | re.DOTALL)
    if not tag_match:
        return ""
    attr_match = re.search(rf'{attr}=["\']([^"\']+)["\']', tag_match.group(1), re.IGNORECASE)
    if attr_match:
        return clean_text(attr_match.group(1))
    return ""


def parse_feed_items(xml_text: str, limit: int) -> list[dict[str, str]]:
    rss_items = re.findall(r"<item\b[^>]*>(.*?)</item>", xml_text, re.IGNORECASE | re.DOTALL)
    atom_items = re.findall(r"<entry\b[^>]*>(.*?)</entry>", xml_text, re.IGNORECASE | re.DOTALL)
    items = rss_items or atom_items
    parsed = []
    for item in items[:limit]:
        title = first_tag_text(item, ("title",))
        link = first_tag_text(item, ("link",)) or first_tag_attr(item, "link", "href") or first_tag_text(item, ("guid", "id"))
        summary = first_tag_text(item, ("description", "summary", "content"))
        published = first_tag_text(item, ("pubDate", "published", "updated"))
        if title:
            parsed.append({"title": title, "url": link, "summary": summary, "published": published})
    return parsed


def severity_from_hotspot(item: dict[str, str], config: dict[str, Any]) -> str:
    text = f"{item.get('title', '')} {item.get('summary', '')}".lower()
    discovery = config.get("hotspot_discovery", {})
    if any(str(keyword).lower() in text for keyword in discovery.get("keywords_s2", [])):
        return "S2"
    if any(str(keyword).lower() in text for keyword in discovery.get("keywords_s1", [])):
        return "S1"
    return "S0"


def collect_external_hotspots(config: dict[str, Any], offline: bool) -> list[dict[str, Any]]:
    discovery = config.get("hotspot_discovery", {})
    if offline or not discovery.get("enabled", False):
        return []
    limit = int(discovery.get("max_items_per_feed", 5))
    hotspots: list[dict[str, Any]] = []
    for feed in discovery.get("feeds", []):
        url = feed.get("url")
        if not url:
            continue
        try:
            xml_text = fetch_text(url)
        except (ValueError, urllib.error.URLError, TimeoutError):
            continue
        for item in parse_feed_items(xml_text, limit=limit):
            item["source"] = feed.get("name", "external_feed")
            item["severity"] = severity_from_hotspot(item, config)
            hotspots.append(item)
    for query in discovery.get("queries", []):
        query_text = query.get("query")
        if not query_text:
            continue
        url = (
            f"{GDELT_DOC_URL}?query={urllib.parse.quote(query_text)}"
            f"&mode=ArtList&format=json&maxrecords={limit}&sort=HybridRel"
        )
        try:
            data = fetch_json(url, timeout=15)
        except (ValueError, urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            continue
        for article in data.get("articles", [])[:limit]:
            item = {
                "title": clean_text(article.get("title", "")),
                "url": article.get("url", ""),
                "summary": clean_text(article.get("seendate", "")),
                "published": article.get("seendate", ""),
                "source": f"gdelt:{query.get('name', 'query')}",
            }
            item["severity"] = severity_from_hotspot(item, config)
            if item["severity"] == "S0":
                item["severity"] = query.get("default_severity", "S1")
            if item["title"]:
                hotspots.append(item)
    return hotspots


def write_db(config: dict[str, Any], context: dict[str, Any]) -> None:
    init_db(config)
    conn = connect_db(config)
    observed_at = context["observed_at"]
    try:
        for ticker in context["watch"]:
            conn.execute(
                """
                INSERT INTO market_snapshots
                  (source, symbol, observed_at, price, change_pct, high_24h, low_24h, volume, raw_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "binance_24h",
                    ticker["symbol"],
                    observed_at,
                    ticker["price"],
                    ticker["change_pct"],
                    ticker["high_24h"],
                    ticker["low_24h"],
                    ticker["volume"],
                    json.dumps(ticker["raw"], ensure_ascii=False),
                ),
            )
        for mover in context["top_movers"][:5]:
            conn.execute(
                """
                INSERT INTO events (source, severity, title, url, observed_at, summary, raw_json)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "binance_top_mover",
                    severity_from_ticker(mover),
                    f"{mover['symbol']} 24h change {mover['change_pct']:.2f}%",
                    "",
                    observed_at,
                    f"{mover['symbol']} price {mover['price']:.6g}, 24h range {mover['low_24h']:.6g}-{mover['high_24h']:.6g}.",
                    json.dumps(mover, ensure_ascii=False),
                ),
            )
        for item in context.get("announcements", []):
            if not item.get("title"):
                continue
            conn.execute(
                """
                INSERT INTO events (source, severity, title, url, observed_at, summary, raw_json)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "binance_announcement",
                    "S1",
                    item["title"],
                    item.get("url", ""),
                    observed_at,
                    item["title"],
                    json.dumps(item, ensure_ascii=False),
                ),
            )
        for item in context.get("external_hotspots", []):
            if not item.get("title"):
                continue
            conn.execute(
                """
                INSERT INTO events (source, severity, title, url, observed_at, summary, raw_json)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    f"external_hotspot:{item.get('source', 'external_feed')}",
                    item.get("severity", "S1"),
                    item["title"],
                    item.get("url", ""),
                    observed_at,
                    item.get("summary", "") or item["title"],
                    json.dumps(item, ensure_ascii=False),
                ),
            )
        conn.commit()
    finally:
        conn.close()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--offline", action="store_true", help="Do not call remote APIs; write fallback context.")
    args = parser.parse_args()

    config = load_config()
    watch, top_movers = collect_tickers(config, offline=args.offline)
    announcements = collect_announcements(offline=args.offline)
    external_hotspots = collect_external_hotspots(config, offline=args.offline)
    context = {
        "observed_at": datetime.now().isoformat(timespec="seconds"),
        "watch": watch,
        "top_movers": top_movers,
        "announcements": announcements,
        "external_hotspots": external_hotspots,
    }
    write_db(config, context)

    output_path = Path(config["market_context_path"])
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(context, ensure_ascii=False, indent=2), encoding="utf-8")
    print(output_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
