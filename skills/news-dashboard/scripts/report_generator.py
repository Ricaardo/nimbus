"""Macro News Dashboard 报告生成器"""

import json
import logging
import os
from datetime import datetime

logger = logging.getLogger(__name__)


def generate_markdown(data, lang="zh"):
    lines = []
    ts = datetime.now().strftime("%Y-%m-%d %H:%M")
    lines.append("# 宏观新闻仪表盘")
    lines.append(f"> 生成时间: {ts}\n")

    # 1. 热点话题
    clusters = data.get("clusters", [])
    if clusters:
        lines.append("## 1. 热点话题\n")
        for i, cluster in enumerate(clusters[:10], 1):
            count = cluster["count"]
            headline = cluster["headline"]
            impact = cluster["articles"][0].get("impact", "low") if cluster["articles"] else "low"
            impact_badge = {"high": "🔴", "medium": "🟡", "low": "⚪"}.get(impact, "⚪")
            lines.append(f"**{i}. {headline}** {impact_badge}")
            lines.append(f"   - 相关文章: {count} 篇 | 关键词: {cluster['topic']}")
            if count > 1:
                for art in cluster["articles"][1:3]:
                    lines.append(f"   - {art.get('headline', '')}")
            lines.append("")

    # 2. 央行动态
    fed_news = data.get("fed_news", [])
    if fed_news:
        lines.append("## 2. 央行动态\n")
        for article in fed_news[:8]:
            dt_raw = article.get("datetime", "")
            if isinstance(dt_raw, (int, float)):
                from datetime import datetime as _dt, timezone as _tz
                dt = _dt.fromtimestamp(dt_raw, tz=_tz.utc).strftime("%Y-%m-%d %H:%M")
            else:
                dt = str(dt_raw)[:16]
            headline = article.get("headline", "")
            source = article.get("source", "")
            keywords = ", ".join(article.get("fed_keywords", [])[:3])
            lines.append(f"- **{headline}** ({source}, {dt})")
            lines.append(f"  关键词: {keywords}")
        lines.append("")

    # 3. 经济日历
    calendar = data.get("calendar", [])
    if calendar:
        lines.append("## 3. 经济日历（未来 14 天）\n")
        lines.append("| 日期 | 事件 | 国家 | 影响 | 预期 | 前值 |")
        lines.append("|------|------|------|------|------|------|")
        for evt in calendar[:20]:
            date = evt.get("date", "")
            event = evt.get("event", "")[:40]
            country = evt.get("country", "")
            importance = evt.get("importance", "medium")
            estimate = evt.get("estimate", "—") or "—"
            prev = evt.get("prev", "—") or "—"
            lines.append(f"| {date} | {event} | {country} | {importance} | {estimate} | {prev} |")
        lines.append("")

    # 4. 板块新闻
    sector = data.get("sector_news", {})
    if sector:
        lines.append("## 4. 板块新闻\n")
        for ticker, articles in sector.items():
            if not articles:
                continue
            lines.append(f"### {ticker} ({len(articles)} 篇)\n")
            for art in articles[:5]:
                headline = art.get("headline", "")
                source = art.get("source", "")
                _raw = art.get("datetime", "")
                if isinstance(_raw, (int, float)):
                    from datetime import datetime as _dt, timezone as _tz
                    dt = _dt.fromtimestamp(_raw, tz=_tz.utc).strftime("%Y-%m-%d")
                else:
                    dt = str(_raw)[:10]
                lines.append(f"- {headline} ({source}, {dt})")
            lines.append("")

    # 5. 分类统计
    counts = data.get("category_counts", {})
    if counts:
        lines.append("## 5. 新闻分类统计\n")
        lines.append("| 类别 | 数量 |")
        lines.append("|------|------|")
        for cat, cnt in sorted(counts.items(), key=lambda x: x[1], reverse=True):
            lines.append(f"| {cat} | {cnt} |")
        lines.append("")

    return "\n".join(lines)


def generate_json(data):
    return {
        "title": "宏观新闻仪表盘",
        "generated_at": datetime.now().isoformat(),
        "clusters": [
            {"topic": c["topic"], "headline": c["headline"], "count": c["count"]}
            for c in data.get("clusters", [])[:10]
        ],
        "fed_news_count": len(data.get("fed_news", [])),
        "calendar_events": len(data.get("calendar", [])),
        "category_counts": data.get("category_counts", {}),
    }


def save_reports(data, output_dir=None):
    if output_dir is None:
        output_dir = os.path.join(os.path.dirname(__file__), "..", "reports")
    os.makedirs(output_dir, exist_ok=True)

    ts = datetime.now().strftime("%Y-%m-%d_%H%M%S")

    md_path = os.path.join(output_dir, f"macro_news_{ts}.md")
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(generate_markdown(data))

    json_path = os.path.join(output_dir, f"macro_news_{ts}.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(generate_json(data), f, ensure_ascii=False, indent=2)

    return {"markdown": md_path, "json": json_path}
