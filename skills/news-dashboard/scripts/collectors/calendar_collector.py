"""经济日历收集器 — Finnhub → FRED releases → Investing.com fallback"""

import logging
import re
import time
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False

HIGH_IMPACT_KEYWORDS = [
    "interest rate", "fed", "fomc", "nonfarm", "payroll", "cpi",
    "gdp", "pce", "unemployment", "retail sales", "pmi", "ism",
    "ecb", "boj", "pboc", "bank of england",
]

# 重要 FRED Release IDs 及其对应的事件名
FRED_RELEASES = {
    10: ("Employment Situation", "US", "high"),         # 非农
    21: ("Consumer Price Index", "US", "high"),          # CPI
    46: ("Producer Price Index", "US", "medium"),        # PPI
    53: ("Gross Domestic Product", "US", "high"),        # GDP
    22: ("Retail Sales", "US", "high"),                  # 零售销售
    197: ("PCE Price Index", "US", "high"),              # PCE
    18: ("Industrial Production", "US", "medium"),       # 工业生产
    19: ("New Residential Construction", "US", "medium"), # 新屋开工
    309: ("ISM Manufacturing", "US", "high"),            # ISM 制造业
    310: ("ISM Services", "US", "high"),                 # ISM 服务业
    101: ("FOMC Press Release", "US", "high"),           # FOMC 声明
    52: ("Consumer Confidence", "US", "medium"),         # 消费者信心
    82: ("Initial Claims", "US", "medium"),              # 初请
    96: ("Durable Goods", "US", "medium"),               # 耐用品
}


def collect(finnhub_client=None, days=14, fred_client=None):
    """获取经济日历，多源 fallback"""

    # 方案 1: Finnhub
    if finnhub_client:
        events = _try_finnhub(finnhub_client)
        if events:
            return events

    # 方案 2: FRED Release Calendar（最稳定的免费方案）
    if fred_client:
        events = _try_fred_releases(fred_client, days)
        if events:
            return events

    # 方案 3: Investing.com 抓取
    events = _try_investing_scrape(days)
    if events:
        return events

    logger.warning("所有经济日历数据源均不可用")
    return []


def _try_finnhub(finnhub_client):
    """尝试 Finnhub 经济日历"""
    try:
        events = finnhub_client.get_economic_calendar()
        if events:
            filtered = _filter_events(events)
            logger.info("Finnhub 经济日历: %d/%d 个高/中影响事件", len(filtered), len(events))
            return filtered
    except Exception as e:
        logger.debug("Finnhub 经济日历失败: %s", e)
    return []


def _try_fred_releases(fred_client, days=14):
    """通过 FRED Release Calendar 获取经济日历"""
    from_date = datetime.now().strftime("%Y-%m-%d")
    to_date = (datetime.now() + timedelta(days=days)).strftime("%Y-%m-%d")

    events = []
    try:
        # 使用 FRED /release/dates 接口获取所有即将发布的数据
        for release_id, (name, country, impact) in FRED_RELEASES.items():
            try:
                data = fred_client._get("release/dates", {
                    "release_id": release_id,
                    "include_release_dates_with_no_data": "true",
                    "sort_order": "asc",
                })
                if data and "release_dates" in data:
                    for rd in data["release_dates"]:
                        release_date = rd.get("date", "")
                        if from_date <= release_date <= to_date:
                            events.append({
                                "event": name,
                                "country": country,
                                "date": release_date,
                                "impact": impact,
                                "importance": impact,
                                "actual": None,
                                "estimate": None,
                                "prev": None,
                                "source": "FRED",
                            })
            except Exception as e:
                logger.debug("FRED release %d 获取失败: %s", release_id, e)
                continue
            time.sleep(0.3)  # 限速

        if events:
            events.sort(key=lambda x: x.get("date", ""))
            logger.info("FRED 经济日历: %d 个事件（未来 %d 天）", len(events), days)
            return events

    except Exception as e:
        logger.debug("FRED 经济日历获取失败: %s", e)

    return []


def _try_investing_scrape(days=14):
    """抓取 Investing.com 经济日历（备选方案）"""
    if not HAS_REQUESTS:
        return []

    from_date = datetime.now().strftime("%Y-%m-%d")
    to_date = (datetime.now() + timedelta(days=days)).strftime("%Y-%m-%d")

    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            "X-Requested-With": "XMLHttpRequest",
            "Referer": "https://www.investing.com/economic-calendar/",
        }
        session = requests.Session()
        session.headers.update(headers)

        # Investing.com 日历 API
        resp = session.post(
            "https://sslecal2.investing.com/economic-calendar/Service/getCalendarFilteredData",
            data={
                "dateFrom": from_date,
                "dateTo": to_date,
                "timeZone": 8,
                "timeFilter": "timeRemain",
                "currentTab": "custom",
                "limit_from": 0,
            },
            timeout=15,
        )
        if resp.status_code != 200:
            logger.debug("Investing.com 日历返回 %d", resp.status_code)
            return []

        result = resp.json()
        html = result.get("data", "")
        if not html:
            return []

        events = _parse_investing_html(html)
        filtered = _filter_events(events)
        logger.info("Investing.com 经济日历: %d/%d 个高/中影响事件", len(filtered), len(events))
        return filtered

    except Exception as e:
        logger.debug("Investing.com 日历抓取失败: %s", e)
        return []


def _parse_investing_html(html):
    """解析 Investing.com 日历 HTML"""
    events = []
    rows = re.findall(r'<tr[^>]*class="js-event-item[^"]*"[^>]*>(.*?)</tr>', html, re.DOTALL)

    for row in rows:
        event = {}

        dt_match = re.search(r'data-event-datetime="([^"]+)"', row)
        if dt_match:
            event["date"] = dt_match.group(1)[:10]

        country_match = re.search(r'title="([^"]+)"[^>]*class="[^"]*cemark', row)
        if not country_match:
            country_match = re.search(r'<span[^>]*title="([^"]+)"', row)
        if country_match:
            event["country"] = country_match.group(1)

        bulls = len(re.findall(r'grayFullBullishIcon', row))
        event["impact"] = "high" if bulls >= 3 else "medium" if bulls >= 2 else "low"

        event_match = re.search(r'<td[^>]*class="[^"]*event[^"]*"[^>]*>\s*<a[^>]*>([^<]+)</a>', row)
        if not event_match:
            event_match = re.search(r'class="[^"]*event[^"]*"[^>]*>([^<]+)<', row)
        if event_match:
            event["event"] = event_match.group(1).strip()

        if event.get("event"):
            events.append(event)

    return events


def _filter_events(events):
    """筛选高/中影响事件"""
    filtered = []
    for evt in events:
        impact = evt.get("impact", "").lower()
        event_name = evt.get("event", "").lower()

        is_high = impact in ("high", "medium")
        is_keyword = any(kw in event_name for kw in HIGH_IMPACT_KEYWORDS)

        if is_high or is_keyword:
            evt["importance"] = "high" if (impact == "high" or is_keyword) else "medium"
            filtered.append(evt)

    filtered.sort(key=lambda x: x.get("date", ""))
    return filtered
