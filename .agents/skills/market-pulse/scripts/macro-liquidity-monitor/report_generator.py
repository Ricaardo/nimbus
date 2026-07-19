"""Macro Liquidity Monitor 报告生成器"""

import json
import logging
import os
from datetime import datetime

logger = logging.getLogger(__name__)


def generate_markdown(composite, lang="zh"):
    lines = []
    ts = datetime.now().strftime("%Y-%m-%d %H:%M")
    lines.append("# 宏观流动性监控报告")
    lines.append(f"> 生成时间: {ts}\n")

    score = composite["score"]
    zone = composite["zone"]
    zone_en = composite["zone_en"]
    guidance = composite["guidance"]

    lines.append(f"## 综合评分: {score}/100 — {zone} ({zone_en})")
    lines.append(f"**投资指引:** {guidance}")
    lines.append(f"**数据覆盖:** {composite['available_count']}/{composite['total_count']} 组件可用\n")

    # Score bar
    filled = score // 5
    bar = "█" * filled + "░" * (20 - filled)
    lines.append(f"```\n[{bar}] {score}/100\n枯竭  收紧  中性  宽松  泛滥\n```\n")

    # Component details
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
                if k != "as_of":
                    lines.append(f"- {k}: {v}")
            if "as_of" in data:
                lines.append(f"- 数据截至: {data['as_of']}")
        lines.append("")

    return "\n".join(lines)


def generate_json(composite):
    return {
        "title": "宏观流动性监控",
        "generated_at": datetime.now().isoformat(),
        "score": composite["score"],
        "zone": composite["zone"],
        "zone_en": composite["zone_en"],
        "guidance": composite["guidance"],
        "components": composite["components"],
    }


def save_reports(composite, output_dir=None):
    if output_dir is None:
        output_dir = os.path.join(os.path.dirname(__file__), "..", "reports")
    os.makedirs(output_dir, exist_ok=True)

    ts = datetime.now().strftime("%Y-%m-%d_%H%M%S")

    md_path = os.path.join(output_dir, f"macro_liquidity_{ts}.md")
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(generate_markdown(composite))

    json_path = os.path.join(output_dir, f"macro_liquidity_{ts}.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(generate_json(composite), f, ensure_ascii=False, indent=2)

    return {"markdown": md_path, "json": json_path}
