"""Fear & Greed Index 报告生成器"""

import json
import logging
import os
from datetime import datetime

logger = logging.getLogger(__name__)


def generate_markdown(global_result, market_scores):
    lines = []
    ts = datetime.now().strftime("%Y-%m-%d %H:%M")
    lines.append("# 多市场贪恐指数报告")
    lines.append(f"> 生成时间: {ts}\n")

    # 全球综合
    score = global_result["score"]
    zone = global_result["zone"]
    zone_en = global_result["zone_en"]
    guidance = global_result["guidance"]

    lines.append(f"## 全球综合贪恐指数: {score}/100 — {zone} ({zone_en})")
    lines.append(f"**投资指引:** {guidance}\n")

    # Score bar with emoji
    filled = score // 5
    bar = "█" * filled + "░" * (20 - filled)
    lines.append(f"```")
    lines.append(f"[{bar}] {score}/100")
    lines.append(f"极恐  恐惧  中性  贪婪  极贪")
    lines.append(f"```\n")

    # 各市场概览
    lines.append("## 各市场贪恐指数\n")
    lines.append("| 市场 | 评分 | 情绪 | 信号 | 置信度 |")
    lines.append("|------|------|------|------|--------|")
    for ms in market_scores:
        emoji = _score_emoji(ms["score"])
        lines.append(
            f"| {ms['market']} | {ms['score']}/100 | {ms['zone']} | {emoji} | {ms.get('confidence', 'N/A')} |"
        )

    # 各市场详情
    for ms in market_scores:
        lines.append(f"\n---\n")
        lines.append(f"## {ms['market']} ({ms['market_en']}) — {ms['score']}/100 {ms['zone']}")

        filled_m = ms["score"] // 5
        bar_m = "█" * filled_m + "░" * (20 - filled_m)
        lines.append(f"```\n[{bar_m}] {ms['score']}/100\n```\n")

        lines.append(f"**指引:** {ms['guidance']}\n")

        lines.append("| 组件 | 权重 | 评分 | 信号 | 说明 |")
        lines.append("|------|------|------|------|------|")
        for c in ms.get("components", []):
            w = f"{c['weight']*100:.0f}%"
            s = c.get("score", "N/A")
            sig = c.get("signal", "N/A")
            r = c.get("reasoning", "")[:80]
            avail = "" if c.get("data_available") else " [缺失]"
            lines.append(f"| {c['name']}{avail} | {w} | {s} | {sig} | {r} |")

        # 组件详情
        for c in ms.get("components", []):
            if not c.get("data_available"):
                continue
            lines.append(f"\n### {c['name']} (评分: {c['score']})")
            lines.append(f"**信号:** {c['signal']} | **权重:** {c['weight']*100:.0f}%")
            lines.append(f"**分析:** {c.get('reasoning', '')}")
            data = c.get("data", {})
            if data:
                for k, v in data.items():
                    if k != "as_of":
                        lines.append(f"- {k}: {v}")
                if "as_of" in data:
                    lines.append(f"- 数据截至: {data['as_of']}")

    # 解读
    lines.append("\n---\n")
    lines.append("## 投资解读\n")
    lines.append("> **巴菲特法则:** \"别人恐惧时贪婪，别人贪婪时恐惧\" — 极端值往往是反向信号\n")

    if score >= 80:
        lines.append("- 市场处于**极度贪婪**状态，历史上此区间常伴随短期回调风险")
        lines.append("- 建议：审视持仓集中度，考虑部分获利了结或买入保护性期权")
    elif score >= 60:
        lines.append("- 市场情绪偏**贪婪**，趋势仍可能延续但需保持警惕")
        lines.append("- 建议：维持仓位，适当收紧止损位")
    elif score >= 40:
        lines.append("- 市场情绪**中性**，多空信号交织")
        lines.append("- 建议：保持均衡配置，关注催化剂事件")
    elif score >= 20:
        lines.append("- 市场情绪偏**恐惧**，可能出现错杀机会")
        lines.append("- 建议：制定观察名单，分批建仓优质标的")
    else:
        lines.append("- 市场处于**极度恐惧**，历史上此区间是长期投资者的机会窗口")
        lines.append("- 建议：逆向思维，但需确认恐惧是否有基本面支撑")

    return "\n".join(lines)


def generate_json(global_result, market_scores):
    charts = []

    # 各市场评分柱状图
    market_data = [{"market": ms["market"], "score": ms["score"]} for ms in market_scores]
    charts.append({
        "id": "market_scores",
        "type": "bar",
        "title": "各市场贪恐指数",
        "data": market_data,
        "xKey": "market",
        "yKeys": ["score"],
        "colors": ["#FF6B6B"],
    })

    # 各市场组件评分
    for ms in market_scores:
        comp_data = [
            {"component": c["name"], "score": c.get("effective_score", c["score"])}
            for c in ms.get("components", [])
        ]
        charts.append({
            "id": f"components_{ms['market_en'].lower()}",
            "type": "bar",
            "title": f"{ms['market']}组件评分",
            "data": comp_data,
            "xKey": "component",
            "yKeys": ["score"],
        })

    metrics = [
        {"label": "全球贪恐指数", "value": global_result["score"],
         "trend": "up" if global_result["score"] >= 55 else "down" if global_result["score"] <= 45 else "flat"},
    ]
    for ms in market_scores:
        metrics.append({
            "label": ms["market"],
            "value": ms["score"],
            "trend": "up" if ms["score"] >= 55 else "down" if ms["score"] <= 45 else "flat",
        })

    return {
        "title": "多市场贪恐指数",
        "generated_at": datetime.now().isoformat(),
        "charts": charts,
        "metrics": metrics,
        "summary": f"全球贪恐指数 {global_result['score']}/100 — {global_result['zone']}",
    }


def save_reports(global_result, market_scores, output_dir=None):
    if output_dir is None:
        output_dir = os.path.join(os.path.dirname(__file__), "..", "reports")
    os.makedirs(output_dir, exist_ok=True)

    ts = datetime.now().strftime("%Y-%m-%d_%H%M%S")

    md_path = os.path.join(output_dir, f"fear_greed_{ts}.md")
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(generate_markdown(global_result, market_scores))

    json_path = os.path.join(output_dir, f"fear_greed_{ts}.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(generate_json(global_result, market_scores), f, ensure_ascii=False, indent=2)

    return {"markdown": md_path, "json": json_path}


def _score_emoji(score):
    if score >= 80:
        return "🔴 极贪"
    elif score >= 60:
        return "🟠 贪婪"
    elif score >= 40:
        return "🟡 中性"
    elif score >= 20:
        return "🟢 恐惧"
    else:
        return "🔵 极恐"
