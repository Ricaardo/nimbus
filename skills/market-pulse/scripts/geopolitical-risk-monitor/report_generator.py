"""Geopolitical Risk Monitor 报告生成器"""

import json
import logging
import os
from datetime import datetime

logger = logging.getLogger(__name__)


def generate_markdown(composite, top_articles=None, lang="zh"):
    lines = []
    ts = datetime.now().strftime("%Y-%m-%d %H:%M")
    lines.append("# 地缘政治风险监控报告")
    lines.append(f"> 生成时间: {ts}\n")

    score = composite["score"]
    zone = composite["zone"]
    zone_en = composite["zone_en"]
    guidance = composite["guidance"]

    lines.append(f"## 综合风险评分: {score}/100 — {zone} ({zone_en})")
    lines.append(f"**投资指引:** {guidance}")
    lines.append(f"**数据覆盖:** {composite['available_count']}/{composite['total_count']} 组件可用\n")

    # Risk bar
    filled = score // 5
    bar = "█" * filled + "░" * (20 - filled)
    lines.append(f"```\n[{bar}] {score}/100\n平静  关注  紧张  高度紧张  危机\n```\n")

    # Component table
    lines.append("## 各组件评分\n")
    lines.append("| 组件 | 权重 | 评分 | 信号 | 说明 |")
    lines.append("|------|------|------|------|------|")
    for c in composite.get("components", []):
        w = f"{c['weight']*100:.0f}%"
        s = c.get("score", "N/A")
        sig = c.get("signal", "N/A")
        r = c.get("reasoning", "")[:60]
        avail = "" if c.get("data_available") else " ⚠"
        lines.append(f"| {c['name']}{avail} | {w} | {s} | {sig} | {r} |")

    # Component details
    lines.append("\n## 组件详情\n")
    for c in composite.get("components", []):
        if not c.get("data_available"):
            continue
        lines.append(f"### {c['name']} (评分: {c['score']})")
        lines.append(f"**信号:** {c['signal']} | **权重:** {c['weight']*100:.0f}%")
        lines.append(f"**分析:** {c.get('reasoning', '')}")
        data = c.get("data", {})
        if data:
            for k, v in data.items():
                lines.append(f"- {k}: {v}")
        lines.append("")

    # Top geopolitical articles
    if top_articles:
        lines.append("## 地缘热点新闻\n")
        for i, art in enumerate(top_articles[:8], 1):
            headline = art.get("headline", "")
            source = art.get("source", "")
            geo = art.get("geo_classification", {})
            severity = geo.get("max_severity", 0)
            cats = ", ".join(geo.get("categories", []))
            regions = ", ".join(geo.get("regions", []))
            lines.append(f"**{i}. {headline}** ({source})")
            lines.append(f"   类别: {cats} | 区域: {regions} | 严重性: {severity}")
            lines.append("")

    return "\n".join(lines)


def generate_json(composite, top_articles=None):
    return {
        "title": "地缘政治风险监控",
        "generated_at": datetime.now().isoformat(),
        "score": composite["score"],
        "zone": composite["zone"],
        "zone_en": composite["zone_en"],
        "guidance": composite["guidance"],
        "components": composite["components"],
        "top_articles": [
            {"headline": a.get("headline"), "source": a.get("source"),
             "categories": a.get("geo_classification", {}).get("categories", [])}
            for a in (top_articles or [])[:5]
        ],
    }


def save_reports(composite, top_articles=None, output_dir=None):
    if output_dir is None:
        output_dir = os.path.join(os.path.dirname(__file__), "..", "reports")
    os.makedirs(output_dir, exist_ok=True)

    ts = datetime.now().strftime("%Y-%m-%d_%H%M%S")

    md_path = os.path.join(output_dir, f"geopolitical_risk_{ts}.md")
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(generate_markdown(composite, top_articles))

    json_path = os.path.join(output_dir, f"geopolitical_risk_{ts}.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(generate_json(composite, top_articles), f, ensure_ascii=False, indent=2)

    return {"markdown": md_path, "json": json_path}
