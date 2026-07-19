#!/usr/bin/env python3
"""
thesis_report.py — 论点建仓周报

Generates a weekly thesis-based position report from:
  1. portfolio_state.json — current positions (with thesis/conviction/verdict)
  2. reports/theses/*.yaml — thesis details (pillars/risks/catalysts)
  3. nav_history.jsonl — NAV history for period returns

Reuses portfolio_state.py functions (load_theses, canon, load_nav_history, nav_change_pct)
via importlib, following the same convention as nav_view.py / briefing.py.

用法:
  python3 skills/portfolio-manager/scripts/thesis_report.py          # markdown 周报
  python3 skills/portfolio-manager/scripts/thesis_report.py --json   # 结构化 JSON
  python3 skills/portfolio-manager/scripts/thesis_report.py --wa     # 微信短版(浓缩,手机友好)

只读分析，不下单。
"""

import argparse
import datetime as dt
import importlib.util
import json
import os
import sys

import yaml

# ---- path setup (same convention as portfolio_state.py / nav_view.py) ----
_SKILLS = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_REPO_ROOT = os.path.dirname(_SKILLS)
STATE_DIR = f"{_SKILLS}/references/state"
STATE_FILE = f"{STATE_DIR}/portfolio_state.json"
THESES_DIR = f"{_REPO_ROOT}/reports/theses"


# ---- import portfolio_state functions via importlib (matching nav_view.py) ----
def _load_ps():
    spec = importlib.util.spec_from_file_location(
        "ps", os.path.join(os.path.dirname(os.path.abspath(__file__)), "portfolio_state.py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


_ps = _load_ps()
load_theses_fn = _ps.load_theses
canon_fn = _ps.canon
load_nav_history = _ps.load_nav_history
nav_change_pct = _ps.nav_change_pct


# ---------- data loading ----------
def load_state():
    if not os.path.exists(STATE_FILE):
        return None
    try:
        with open(STATE_FILE) as fh:
            return json.load(fh)
    except Exception as e:
        print(f"[warn] 读 portfolio_state 失败: {e}", file=sys.stderr)
        return None


def load_thesis_yaml(ticker_canon):
    """Load full thesis YAML for a given canon'd ticker. Returns None if not found."""
    if not os.path.isdir(THESES_DIR):
        return None
    for fn in sorted(os.listdir(THESES_DIR)):
        if not fn.endswith((".yaml", ".yml")):
            continue
        try:
            with open(os.path.join(THESES_DIR, fn)) as fh:
                y = yaml.safe_load(fh) or {}
        except Exception as e:
            print(f"[warn] 解析论点 {fn} 失败: {e}", file=sys.stderr)
            continue
        if canon_fn(y.get("ticker", "")) == ticker_canon:
            return y
    return None


# ---------- helpers ----------
def _signed(x):
    if x is None:
        return "—"
    return f"{x:+.1f}%"


def _dollar(x):
    if x is None:
        return "$—"
    return f"${x:,.0f}"


def conviction_emoji(score):
    if score is None:
        return ("❓", "未知")
    if score >= 60:
        return ("✅", "高" if score >= 70 else "中")
    if score >= 40:
        return ("⚠️", "中")
    return ("🚨", "低")


def verdict_emoji(verdict):
    if verdict in ("failed", "decaying"):
        return "🚨"
    if verdict in ("bear_trap", "bull_correction"):
        return "⚠️"
    if verdict == "mania":
        return "⚠️"
    if verdict == "on_track":
        return "✅"
    return "❓"


def verdict_explain(verdict):
    """Map thesis_vs_price verdict to a one-line Chinese explanation."""
    m = {
        "on_track": "论点与价格方向一致，持有逻辑成立",
        "failed": "价格走势与论点预期背离，需复核底层逻辑",
        "bull_correction": "牛市回调——论点根基还在，但价格短期承压",
        "bear_trap": "熊市陷阱——价格反常反弹，基本面未见好转",
        "mania": "价格过度透支论点，警惕泡沫回撤",
        "decaying": "论点逐步失效，考虑减仓或退出",
    }
    return m.get(verdict, "待评估")


def coinsight(position_str, thesis_statement, score, verdict):
    """Derive coinsight (看多/看空/观望) from position + conviction + verdict."""
    if position_str == "long":
        direction = "看多"
    elif position_str == "short":
        direction = "看空"
    else:
        direction = "观望"

    # If thesis is failing/dead, override direction
    if verdict in ("failed", "decaying") and score is not None and score < 40:
        direction += "→⚠️建议复核"

    logic = (thesis_statement or "").strip()
    # Shorten for WeChat: take first sentence
    if logic:
        # Take first sentence-ish chunk (split on . or , or Chinese punctuation)
        for sep in (". ", "。", "，", ", "):
            if sep in logic:
                logic = logic.split(sep)[0] + sep.rstrip()
                break
        logic = logic[:120]  # hard cap
    return direction, logic


def weekly_changes(yaml_data, now, days=7):
    """Extract thesis changes within the last `days` days from pillars/risks/catalysts.

    Returns a list of human-readable strings describing what changed this week,
    or an empty list if nothing notable."""
    cutoff = now - dt.timedelta(days=days)
    notes = []

    # Check pillar evidence
    for p in (yaml_data.get("pillars") or []):
        pid = p.get("id", "?")
        desc = p.get("description", "")[:60]
        status = p.get("status", "")
        for ev in p.get("evidence") or []:
            try:
                ev_date = dt.date.fromisoformat(str(ev.get("date", ""))[:10])
            except Exception:
                continue
            if ev_date >= cutoff.date():
                impact = ev.get("impact", "")
                event = ev.get("event", "")[:80]
                tag = {"strengthens": "↑", "weakens": "↓", "neutral": "→"}.get(impact, "")
                notes.append(f"P{pid}({desc}): {tag}{event}")
        # If no recent evidence, note status if it's behind/failing
        if not [ev for ev in p.get("evidence") or []
                if _try_parse_date(ev.get("date", "")) and
                _try_parse_date(ev.get("date", "")) >= cutoff.date()]:
            if status == "behind":
                notes.append(f"P{pid}({desc}): 持续落后")

    # Check risk status
    for r in (yaml_data.get("risks") or []):
        rid = r.get("id", "?")
        desc = r.get("description", "")[:60]
        status = r.get("status", "")
        severity = r.get("severity", "")
        if status == "active" and severity == "high":
            notes.append(f"R{rid}: {desc} — 高严重度活跃")

    # Check catalyst dates approaching or passed
    for c in (yaml_data.get("catalysts") or []):
        try:
            cat_date = dt.date.fromisoformat(str(c.get("date", ""))[:10])
        except Exception:
            continue
        event = c.get("event", "")[:80]
        days_until = (cat_date - now.date()).days
        if 0 <= days_until <= 14:
            notes.append(f"催化剂 '{event}' — {days_until}天后到期")
        elif days_until < 0 and days_until >= -days:
            notes.append(f"催化剂 '{event}' — 已于{-days_until}天前到期")

    return notes


def _try_parse_date(d):
    try:
        return dt.date.fromisoformat(str(d)[:10])
    except Exception:
        return None


# ---------- build ----------
def build(now=None):
    now = now or dt.datetime.now()
    state = load_state()
    if state is None:
        return None

    nav = state.get("nav_usd", 0) or 0
    positions = state.get("positions", []) or []
    history = load_nav_history()

    week_pct = nav_change_pct(history, nav, 7, now)
    month_pct = nav_change_pct(history, nav, 30, now)

    # Separate non-option positions: with thesis vs naked
    with_thesis = []
    naked = []
    for p in positions:
        if p.get("is_option"):
            continue
        if p.get("thesis"):
            with_thesis.append(p)
        else:
            naked.append(p)

    # Load full YAML for each thesis-backed position
    thesis_details = []
    for p in with_thesis:
        canon_tk = p.get("canon", "")
        y = load_thesis_yaml(canon_tk)
        entry = {"position": p, "yaml": y}
        if y is None:
            entry["error"] = "论点YAML未找到"
            entry["weekly_changes"] = []
            entry["coinsight"] = ("观望", "")
        else:
            entry["weekly_changes"] = weekly_changes(y, now)
            score = p.get("conviction_score")
            verdict = p.get("thesis_verdict", "")
            position_str = y.get("position", "")
            thesis_stmt = y.get("thesis_statement", "")
            entry["coinsight"] = coinsight(position_str, thesis_stmt, score, verdict)
        thesis_details.append(entry)

    # Sort by conviction_score ascending (most dangerous first) for listing section
    thesis_details.sort(key=lambda x: x["position"].get("conviction_score") or 0)

    # Build health ranking (most healthy to most fragile)
    health_ranking = sorted(
        thesis_details,
        key=lambda x: x["position"].get("conviction_score") or 0,
        reverse=True,
    )

    return {
        "as_of": state.get("as_of", now.strftime("%Y-%m-%d")),
        "date_str": now.strftime("%Y-%m-%d"),
        "nav_usd": nav,
        "week_pct": week_pct,
        "month_pct": month_pct,
        "total_positions": len(positions),
        "with_thesis_count": len(with_thesis),
        "naked_count": len(naked),
        "thesis_details": thesis_details,
        "naked_positions": naked,
        "health_ranking": health_ranking,
    }


# ---------- render markdown ----------
def render_md(report):
    """Standard markdown weekly report."""
    if report is None:
        return "⚠ 无法读取 portfolio_state.json — 先跑 portfolio_state.py"

    d = report["date_str"]
    lines = [f"# 📋 论点建仓周报 — {d}", ""]

    # Overview
    lines.append("## 总览")
    wk = _signed(report["week_pct"])
    mo = _signed(report["month_pct"])
    nav_str = _dollar(report["nav_usd"])
    lines.append(f"- NAV {nav_str} · 本周 {wk} · 本月 {mo}")
    lines.append(f"- 持仓 {report['total_positions']} 个，有论点 {report['with_thesis_count']} 个，无论点 {report['naked_count']} 个")
    lines.append("")

    # Early exit: too few positions
    if report["total_positions"] < 2:
        lines.append("⚠️ 数据不足，持仓不足 2 个")
        return "\n".join(lines)

    # Per-ticker sections (sorted by conviction ascending = most dangerous first)
    lines.append("## 逐个标的")
    lines.append("")

    for td in report["thesis_details"]:
        p = td["position"]
        y = td.get("yaml")
        name = p.get("name", p.get("canon", "?"))
        canon_tk = p.get("canon", "?")
        score = p.get("conviction_score")
        emoji, label = conviction_emoji(score)
        price = p.get("price") or 0
        sl = p.get("stop_loss")
        tp = p.get("take_profit")

        # Header line
        lines.append(f"### {emoji} **{canon_tk} {name}** — conviction={score or '?'}({label}) · "
                     f"现价 {_dollar(price)} · 目标 {_dollar(tp)} · 止损 {_dollar(sl)}")

        # Thesis vs price verdict
        verdict = p.get("thesis_verdict", "") or ""
        v_emoji = verdict_emoji(verdict)
        v_explain = verdict_explain(verdict)
        if verdict:
            lines.append(f"- **thesis_vs_price**: {v_emoji} `{verdict}` — {v_explain}")

        # Weekly changes
        if y:
            changes = td.get("weekly_changes", [])
            if changes:
                lines.append("- **本周论点变化**:")
                for c in changes:
                    lines.append(f"  - {c}")
            else:
                lines.append("- **本周论点变化**: 无重大变化")

            # Coinsight
            direction, logic = td.get("coinsight", ("观望", ""))
            lines.append(f"- **coinsight**: {direction} — {logic}")

            # Decay risk alert
            if (score is not None and score < 40) or verdict in ("failed", "decaying"):
                lines.append(f"- 🚨 **decay 风险**: conviction={score} verdict={verdict}，建议复核底层逻辑与是否止损")
        else:
            lines.append(f"- ⚠️ 论点 YAML 未找到：{td.get('error', '')}")
            # Still show coinsight from position data
            direction = "观望"
            lines.append(f"- **coinsight**: {direction}")

        lines.append("")

    # Naked positions
    lines.append("## 无论点标的（裸仓）")
    if report["naked_positions"]:
        for n in report["naked_positions"]:
            wp = n.get("weight_pct") or 0
            warn = " ⚠️占比>5%" if wp > 5 else ""
            lines.append(f"- {n.get('name', n.get('canon', '?'))} "
                         f"({n.get('canon', '?')}) — 占比 {wp:.1f}% · "
                         f"市值 {_dollar(n.get('mv_usd', 0))} · "
                         f"盈亏 {_signed(n.get('pl_pct'))}{warn}")
    else:
        lines.append("- 无裸仓 ✅")
    lines.append("")

    # Health ranking
    lines.append("## 论点健康排序")
    for td in report["health_ranking"]:
        p = td["position"]
        score = p.get("conviction_score")
        emoji, label = conviction_emoji(score)
        verdict = p.get("thesis_verdict", "") or ""
        v_emoji = verdict_emoji(verdict) if verdict else ""
        lines.append(f"- {emoji} **{p.get('canon', '?')}** "
                     f"({p.get('name', p.get('canon', '?'))}) — "
                     f"conv={score} {v_emoji} · 占比 {p.get('weight_pct', 0):.1f}% · "
                     f"PL {_signed(p.get('pl_pct'))}")
    lines.append("")
    lines.append("> 论点周报只读，不下单。健康排序仅反映论点质量，不构成交易建议。")

    return "\n".join(lines)


# ---------- render WeChat short ----------
def render_wa(report):
    """WeChat-optimized short version — condensed for mobile."""
    if report is None:
        return "⚠ 无法读取 portfolio_state.json"

    d = report["date_str"]
    rows = [f"📋 论点周报 {d}", ""]

    # Overview
    wk = _signed(report["week_pct"])
    mo = _signed(report["month_pct"])
    rows.append(f"NAV {_dollar(report['nav_usd'])} · 本周{wk} · 本月{mo}")
    rows.append(f"持仓{report['total_positions']}·有论点{report['with_thesis_count']}·裸{report['naked_count']}")
    rows.append("")

    if report["total_positions"] < 2:
        rows.append("⚡数据不足")
        return "\n".join(rows)

    # Thesis positions (most dangerous first)
    for td in report["thesis_details"]:
        p = td["position"]
        y = td.get("yaml")
        name = p.get("name", p.get("canon", "?"))[:12]
        canon_tk = p.get("canon", "?")
        score = p.get("conviction_score")
        emoji, label = conviction_emoji(score)
        verdict = p.get("thesis_verdict", "") or ""
        v_emoji = verdict_emoji(verdict)

        flag = " 🚨" if (score is not None and score < 40) or verdict in ("failed", "decaying") else ""
        rows.append(f"{emoji}{canon_tk} {name}{flag}")
        rows.append(f"  conv={score} {v_emoji} · PL{_signed(p.get('pl_pct'))} · {p.get('weight_pct', 0):.1f}%")
        if y:
            direction, _ = td.get("coinsight", ("观望", ""))
            rows.append(f"  {direction}")
        rows.append("")

    # Naked summary
    if report["naked_positions"]:
        naked_str = " · ".join(
            f"{n.get('canon', '?')} {n.get('weight_pct', 0):.1f}%"
            + (" ⚠️" if (n.get('weight_pct') or 0) > 5 else "")
            for n in report["naked_positions"]
        )
        rows.append(f"裸仓: {naked_str}")
    else:
        rows.append("裸仓: 无")
    rows.append("")

    # Health ranking (show all in conviction order: most healthy first)
    hr = report["health_ranking"]
    if hr:
        rows.append("论点健康(最稳→最脆):")
        for td in hr:
            p = td["position"]
            emoji, _ = conviction_emoji(p.get("conviction_score"))
            rows.append(f"  {emoji} {p.get('canon', '?')} conv={p.get('conviction_score', '?')}")

    return "\n".join(rows)


# ---------- render JSON ----------
def render_json(report):
    """Structured JSON output for downstream consumers."""
    if report is None:
        return json.dumps({"error": "无法读取 portfolio_state.json"}, ensure_ascii=False)

    # Simplify: drop raw YAML blob, keep extracted fields
    out = {
        "date": report["date_str"],
        "as_of": report["as_of"],
        "nav_usd": report["nav_usd"],
        "week_pct": report["week_pct"],
        "month_pct": report["month_pct"],
        "total_positions": report["total_positions"],
        "with_thesis_count": report["with_thesis_count"],
        "naked_count": report["naked_count"],
    }

    def _simplify_td(td):
        p = td["position"]
        y = td.get("yaml")
        score = p.get("conviction_score")
        verdict = p.get("thesis_verdict", "") or ""
        return {
            "canon": p.get("canon"),
            "name": p.get("name"),
            "source": p.get("source"),
            "weight_pct": p.get("weight_pct"),
            "mv_usd": p.get("mv_usd"),
            "pl_pct": p.get("pl_pct"),
            "price": p.get("price"),
            "conviction_score": score,
            "conviction_label": conviction_emoji(score)[1],
            "conviction_flag": conviction_emoji(score)[0],
            "thesis_verdict": verdict,
            "verdict_flag": verdict_emoji(verdict),
            "stop_loss": p.get("stop_loss"),
            "take_profit": p.get("take_profit"),
            "thesis_statement": y.get("thesis_statement", "") if y else None,
            "position_direction": y.get("position", "") if y else None,
            "coinsight": coinsight(y.get("position", ""), y.get("thesis_statement", ""), score, verdict)[0] if y else "未知",
            "decay_risk": (score is not None and score < 40) or verdict in ("failed", "decaying"),
            "yaml_error": td.get("error"),
        }

    out["thesis_positions"] = [_simplify_td(td) for td in report["thesis_details"]]
    out["naked_positions"] = [
        {
            "canon": n.get("canon"),
            "name": n.get("name"),
            "source": n.get("source"),
            "weight_pct": n.get("weight_pct"),
            "mv_usd": n.get("mv_usd"),
            "pl_pct": n.get("pl_pct"),
            "naked_warning": (n.get("weight_pct") or 0) > 5,
        }
        for n in report["naked_positions"]
    ]
    out["health_ranking"] = [
        {
            "canon": td["position"].get("canon"),
            "name": td["position"].get("name"),
            "conviction_score": td["position"].get("conviction_score"),
            "conviction_flag": conviction_emoji(td["position"].get("conviction_score"))[0],
            "label": conviction_emoji(td["position"].get("conviction_score"))[1],
            "verdict": td["position"].get("thesis_verdict"),
            "weight_pct": td["position"].get("weight_pct"),
            "pl_pct": td["position"].get("pl_pct"),
        }
        for td in report["health_ranking"]
    ]

    return json.dumps(out, ensure_ascii=False, indent=2)


# ---------- main ----------
def main():
    ap = argparse.ArgumentParser(description="论点建仓周报")
    ap.add_argument("--json", action="store_true", help="输出结构化 JSON")
    ap.add_argument("--wa", action="store_true", help="微信短版（手机友好）")
    args = ap.parse_args()

    report = build()

    # Early exit: not enough data
    if report is not None and report["total_positions"] < 2:
        if args.json:
            print(json.dumps({"error": "数据不足", "reason": "持仓不足 2 个",
                              "total_positions": report["total_positions"]},
                             ensure_ascii=False, indent=2))
        else:
            print(f"# 📋 论点建仓周报 — {report['date_str']}\n\n⚠️ 数据不足，持仓不足 2 个（当前 {report['total_positions']} 个）")
        sys.exit(0)

    if args.json:
        print(render_json(report))
    elif args.wa:
        print(render_wa(report))
    else:
        print(render_md(report))


if __name__ == "__main__":
    main()
