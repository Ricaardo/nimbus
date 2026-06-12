"""Fed Data Tracker 报告生成器"""

import json
import logging
import os
from datetime import datetime

logger = logging.getLogger(__name__)


def generate_markdown(results, lang="zh"):
    """生成 Markdown 报告"""
    lines = []
    ts = datetime.now().strftime("%Y-%m-%d %H:%M")
    lines.append(f"# 美联储数据仪表盘" if lang == "zh" else "# Fed Data Dashboard")
    lines.append(f"> 生成时间: {ts}\n")

    # 1. Rates
    rates = results.get("rates")
    if rates and rates.get("data_available"):
        lines.append("## 1. 利率 Interest Rates")
        lines.append(f"数据截至: {rates['as_of']}\n")
        lines.append("| 指标 | 当前值 (%) | 1 周变动 | 1 月变动 | 3 月变动 |")
        lines.append("|------|-----------|---------|---------|---------|")
        for sid, m in rates.get("metrics", {}).items():
            ch = rates.get("changes", {}).get(sid, {})
            w = _fmt_bp(ch.get("1w"))
            mo = _fmt_bp(ch.get("1m"))
            q = _fmt_bp(ch.get("3m"))
            lines.append(f"| {m['name']} | {m['value']:.2f} | {w} | {mo} | {q} |")
        spreads = rates.get("spreads", {})
        if spreads:
            lines.append(f"\n**利差:** 2s10s = {spreads.get('2s10s', 'N/A')}% | 3m10y = {spreads.get('3m10y', 'N/A')}% | 2s30s = {spreads.get('2s30s', 'N/A')}%\n")

    # 2. Balance Sheet
    bs = results.get("balance_sheet")
    if bs and bs.get("data_available"):
        lines.append("## 2. 资产负债表 Balance Sheet")
        lines.append(f"数据截至: {bs['as_of']}\n")
        lines.append("| 指标 | 规模（万亿美元）| 周变动（十亿）| 月变动（十亿）|")
        lines.append("|------|---------------|-------------|-------------|")
        for sid, m in bs.get("metrics", {}).items():
            ch = bs.get("changes", {}).get(sid, {})
            w = ch.get("1w", {}).get("billions", "N/A")
            mo = ch.get("1m", {}).get("billions", "N/A")
            lines.append(f"| {m['name']} | {m['value_trillions']:.3f} | {w} | {mo} |")
        if bs.get("qt_pace_billions_per_month") is not None:
            pace = bs["qt_pace_billions_per_month"]
            direction = "缩表" if pace < 0 else "扩表"
            lines.append(f"\n**QT 速度:** {direction} {abs(pace):.1f} 十亿美元/月\n")

    # 3. TGA & RRP
    res = results.get("reserves")
    if res and res.get("data_available"):
        lines.append("## 3. TGA & RRP")
        lines.append(f"数据截至: {res['as_of']}\n")
        for sid, m in res.get("metrics", {}).items():
            ch = res.get("changes", {}).get(sid, {})
            w = ch.get("1w", {}).get("billions", "N/A")
            mo = ch.get("1m", {}).get("billions", "N/A")
            lines.append(f"**{m['name']}:** {m['value_billions']:.1f} 十亿美元 (周变动: {w}B, 月变动: {mo}B)\n")

    # 4. Inflation
    inf = results.get("inflation")
    if inf and inf.get("data_available"):
        lines.append("## 4. 通胀 Inflation")
        lines.append(f"数据截至: {inf['as_of']} | Fed 目标: {inf.get('fed_target', 2.0)}%\n")
        lines.append("| 指标 | YoY% | MoM% | 3 月年化% | vs 目标 |")
        lines.append("|------|------|------|----------|---------|")
        for sid, m in inf.get("metrics", {}).items():
            yoy = f"{m.get('yoy_pct', 'N/A')}" if "yoy_pct" in m else "N/A"
            mom = f"{m.get('mom_pct', 'N/A')}" if "mom_pct" in m else "N/A"
            ann3 = f"{m.get('three_month_annualized', 'N/A')}" if "three_month_annualized" in m else "N/A"
            vs = f"{m.get('vs_target', 'N/A'):+.2f}" if "vs_target" in m else "N/A"
            lines.append(f"| {m['name']} | {yoy} | {mom} | {ann3} | {vs} |")
        lines.append("")

    # 5. Employment
    emp = results.get("employment")
    if emp and emp.get("data_available"):
        lines.append("## 5. 就业 Employment")
        lines.append(f"数据截至: {emp['as_of']}\n")
        ur = emp.get("metrics", {}).get("UNRATE")
        if ur:
            lines.append(f"**失业率:** {ur['value']}% (月变动: {ur.get('change_mom', 'N/A')}%)")
        nfp = emp.get("metrics", {}).get("PAYEMS")
        if nfp:
            lines.append(f"**非农新增:** {nfp.get('monthly_change_thousands', 'N/A')}K (3 月均值: {nfp.get('three_month_avg_thousands', 'N/A')}K)")
        ic = emp.get("metrics", {}).get("ICSA")
        if ic:
            lines.append(f"**初请:** {ic['value']:,.0f} (4 周均值: {ic.get('four_week_avg', 'N/A'):,.0f})")
        lines.append("")

    # 6. Dollar
    dol = results.get("dollar")
    if dol and dol.get("data_available"):
        lines.append("## 6. 美元 Dollar Index")
        m = dol.get("metrics", {})
        lines.append(f"**当前值:** {m.get('current', 'N/A')} (来源: {m.get('source', 'N/A')})")
        ch = dol.get("changes", {})
        if "30d" in ch:
            lines.append(f"**30 天变动:** {ch['30d'].get('pct', 'N/A')}%")
        if "90d" in ch:
            lines.append(f"**90 天变动:** {ch['90d'].get('pct', 'N/A')}%")
        if "percentile_2y" in m:
            lines.append(f"**2 年百分位:** {m['percentile_2y']}%")
        lines.append("")

    return "\n".join(lines)


def generate_json(results):
    """生成 JSON 报告"""
    return {
        "title": "美联储数据仪表盘",
        "generated_at": datetime.now().isoformat(),
        "sections": results,
    }


def save_reports(results, output_dir=None):
    """保存报告文件"""
    if output_dir is None:
        output_dir = os.path.join(os.path.dirname(__file__), "..", "reports")
    os.makedirs(output_dir, exist_ok=True)

    ts = datetime.now().strftime("%Y-%m-%d_%H%M%S")

    md_path = os.path.join(output_dir, f"fed_data_{ts}.md")
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(generate_markdown(results))
    logger.info("Markdown 报告: %s", md_path)

    json_path = os.path.join(output_dir, f"fed_data_{ts}.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(generate_json(results), f, ensure_ascii=False, indent=2)
    logger.info("JSON 报告: %s", json_path)

    return {"markdown": md_path, "json": json_path}


def _fmt_bp(val):
    """格式化基点变动"""
    if val is None:
        return "N/A"
    bp = round(val * 100)
    sign = "+" if bp > 0 else ""
    return f"{sign}{bp}bp"
