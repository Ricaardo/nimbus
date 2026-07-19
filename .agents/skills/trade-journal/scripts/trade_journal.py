"""Trade journal for logging, reviewing, and analyzing trades.

Records trades in YAML format, supports per-trade review scoring,
and generates statistics (win rate, profit factor, by-strategy breakdown).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

# Try to import yaml, fall back to simple serialization
try:
    import yaml
    HAS_YAML = True
except ImportError:
    HAS_YAML = False


# ---------- YAML helpers ----------

def _load_yaml(path: Path) -> dict:
    """Load a YAML file."""
    if not path.exists():
        return {}
    text = path.read_text(encoding="utf-8")
    if HAS_YAML:
        return yaml.safe_load(text) or {}
    # Simple fallback parser for our structured format
    return _simple_yaml_parse(text)


def _save_yaml(path: Path, data: dict) -> None:
    """Save data as YAML."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if HAS_YAML:
        text = yaml.dump(data, allow_unicode=True, default_flow_style=False, sort_keys=False)
    else:
        text = _simple_yaml_dump(data)
    path.write_text(text, encoding="utf-8")


def _simple_yaml_parse(text: str) -> dict:
    """Minimal YAML parser for flat key-value and list structures."""
    import re
    result = {}
    current_key = None
    for line in text.split("\n"):
        line_s = line.strip()
        if not line_s or line_s.startswith("#"):
            continue
        if line_s.startswith("- ") and current_key:
            if current_key not in result:
                result[current_key] = []
            result[current_key].append(line_s[2:].strip())
        elif ":" in line_s:
            k, _, v = line_s.partition(":")
            k = k.strip()
            v = v.strip()
            if v:
                # Try numeric
                try:
                    v = float(v) if "." in v else int(v)
                except ValueError:
                    if v.lower() in ("true", "false"):
                        v = v.lower() == "true"
                    elif v.startswith('"') and v.endswith('"'):
                        v = v[1:-1]
                result[k] = v
            else:
                current_key = k
                result[k] = {}
    return result


def _simple_yaml_dump(data: dict, indent: int = 0) -> str:
    """Minimal YAML dumper."""
    lines = []
    prefix = "  " * indent
    for k, v in data.items():
        if isinstance(v, dict):
            lines.append(f"{prefix}{k}:")
            lines.append(_simple_yaml_dump(v, indent + 1))
        elif isinstance(v, list):
            lines.append(f"{prefix}{k}:")
            for item in v:
                if isinstance(item, dict):
                    lines.append(f"{prefix}- ")
                    lines.append(_simple_yaml_dump(item, indent + 2))
                else:
                    lines.append(f"{prefix}- {item}")
        else:
            lines.append(f"{prefix}{k}: {v}")
    return "\n".join(lines)


# ---------- Trade data structures ----------

TRADE_TEMPLATE = {
    "ticker": "",
    "direction": "long",
    "entry_date": "",
    "entry_price": 0.0,
    "exit_date": "",
    "exit_price": 0.0,
    "size": 0,
    "strategy": "",
    "thesis": "",
    "status": "open",  # open, closed, adjusted
    "lessons": "",
    "tags": [],
    "adjustments": [],
    "review": {
        "entry_quality": 0,    # 1-5
        "execution": 0,        # 1-5
        "management": 0,       # 1-5
        "result_score": 0,     # 1-5
        "notes": "",
    },
}


def get_trades_dir() -> Path:
    """Get or create the trades directory."""
    trades_dir = Path("reports/trades")
    trades_dir.mkdir(parents=True, exist_ok=True)
    return trades_dir


def get_trade_path(ticker: str, entry_date: str) -> Path:
    """Generate trade file path."""
    safe_ticker = ticker.replace("/", "_").replace(".", "_")
    return get_trades_dir() / f"{safe_ticker}_{entry_date}.yaml"


# ---------- Actions ----------

def action_log(args) -> dict:
    """Log a new trade or update existing one."""
    trade = {
        "ticker": args.ticker.upper(),
        "direction": args.direction,
        "entry_date": args.entry_date or datetime.now().strftime("%Y-%m-%d"),
        "entry_price": args.entry_price,
        "size": args.size,
        "strategy": args.strategy or "",
        "thesis": args.thesis or "",
        "status": "open",
        "tags": args.tags.split(",") if args.tags else [],
        "logged_at": datetime.now().isoformat(),
        "adjustments": [],
        "review": {"entry_quality": 0, "execution": 0, "management": 0, "result_score": 0, "notes": ""},
    }

    # If exit info provided, close the trade
    if args.exit_price and args.exit_date:
        trade["exit_date"] = args.exit_date
        trade["exit_price"] = args.exit_price
        trade["status"] = "closed"
        pnl = (args.exit_price - args.entry_price) * args.size
        if args.direction == "short":
            pnl = -pnl
        trade["pnl"] = round(pnl, 2)
        trade["pnl_pct"] = round((args.exit_price - args.entry_price) / args.entry_price * 100, 2)
        if args.direction == "short":
            trade["pnl_pct"] = -trade["pnl_pct"]

    path = get_trade_path(trade["ticker"], trade["entry_date"])
    _save_yaml(path, trade)

    return {"action": "log", "path": str(path), "trade": trade}


def action_close(args) -> dict:
    """Close an existing open trade."""
    path = get_trade_path(args.ticker.upper(), args.entry_date)
    if not path.exists():
        return {"error": f"Trade not found: {path}"}

    trade = _load_yaml(path)
    trade["exit_date"] = args.exit_date or datetime.now().strftime("%Y-%m-%d")
    trade["exit_price"] = args.exit_price
    trade["status"] = "closed"

    entry = trade.get("entry_price", 0)
    size = trade.get("size", 0)
    direction = trade.get("direction", "long")
    pnl = (args.exit_price - entry) * size
    if direction == "short":
        pnl = -pnl
    trade["pnl"] = round(pnl, 2)
    trade["pnl_pct"] = round((args.exit_price - entry) / entry * 100, 2) if entry else 0
    if direction == "short":
        trade["pnl_pct"] = -trade["pnl_pct"]

    _save_yaml(path, trade)
    return {"action": "close", "path": str(path), "trade": trade}


def action_review(args) -> dict:
    """Review a closed trade with scores."""
    path = get_trade_path(args.ticker.upper(), args.entry_date)
    if not path.exists():
        return {"error": f"Trade not found: {path}"}

    trade = _load_yaml(path)
    trade["review"] = {
        "entry_quality": args.entry_quality,
        "execution": args.execution,
        "management": args.management,
        "result_score": args.result_score,
        "notes": args.review_notes or "",
        "reviewed_at": datetime.now().isoformat(),
    }

    avg_score = round((args.entry_quality + args.execution + args.management + args.result_score) / 4, 1)
    trade["review"]["avg_score"] = avg_score

    _save_yaml(path, trade)
    return {"action": "review", "path": str(path), "trade": trade}


def action_stats(args) -> dict:
    """Generate trading statistics."""
    trades_dir = get_trades_dir()
    all_trades = []

    for f in sorted(trades_dir.glob("*.yaml")):
        trade = _load_yaml(f)
        if trade:
            all_trades.append(trade)

    if not all_trades:
        return {"error": "No trades found in reports/trades/"}

    closed = [t for t in all_trades if t.get("status") == "closed"]
    open_trades = [t for t in all_trades if t.get("status") == "open"]

    if not closed:
        return {
            "total_trades": len(all_trades),
            "open_trades": len(open_trades),
            "closed_trades": 0,
            "note": "No closed trades for statistics",
        }

    # Basic stats
    wins = [t for t in closed if t.get("pnl", 0) > 0]
    losses = [t for t in closed if t.get("pnl", 0) <= 0]
    total_pnl = sum(t.get("pnl", 0) for t in closed)
    gross_profit = sum(t.get("pnl", 0) for t in wins) if wins else 0
    gross_loss = abs(sum(t.get("pnl", 0) for t in losses)) if losses else 0
    avg_win = gross_profit / len(wins) if wins else 0
    avg_loss = gross_loss / len(losses) if losses else 0

    stats = {
        "summary": {
            "total_trades": len(all_trades),
            "open_trades": len(open_trades),
            "closed_trades": len(closed),
            "winning_trades": len(wins),
            "losing_trades": len(losses),
            "win_rate_pct": round(len(wins) / len(closed) * 100, 1) if closed else 0,
            "total_pnl": round(total_pnl, 2),
            "avg_pnl": round(total_pnl / len(closed), 2) if closed else 0,
            "avg_win": round(avg_win, 2),
            "avg_loss": round(avg_loss, 2),
            "profit_factor": round(gross_profit / gross_loss, 2) if gross_loss > 0 else float("inf"),
            "payoff_ratio": round(avg_win / avg_loss, 2) if avg_loss > 0 else float("inf"),
        },
        "by_strategy": {},
        "by_month": {},
        "recent_trades": [],
    }

    # By strategy
    by_strat = defaultdict(list)
    for t in closed:
        by_strat[t.get("strategy", "unknown")].append(t)
    for strat, trades in by_strat.items():
        s_wins = [t for t in trades if t.get("pnl", 0) > 0]
        s_pnl = sum(t.get("pnl", 0) for t in trades)
        stats["by_strategy"][strat] = {
            "trades": len(trades),
            "win_rate_pct": round(len(s_wins) / len(trades) * 100, 1),
            "total_pnl": round(s_pnl, 2),
        }

    # By month
    by_month = defaultdict(list)
    for t in closed:
        month = t.get("exit_date", "")[:7]
        if month:
            by_month[month].append(t)
    for month, trades in sorted(by_month.items()):
        m_pnl = sum(t.get("pnl", 0) for t in trades)
        m_wins = [t for t in trades if t.get("pnl", 0) > 0]
        stats["by_month"][month] = {
            "trades": len(trades),
            "pnl": round(m_pnl, 2),
            "win_rate_pct": round(len(m_wins) / len(trades) * 100, 1),
        }

    # Recent trades
    recent = sorted(closed, key=lambda t: t.get("exit_date", ""), reverse=True)[:10]
    for t in recent:
        stats["recent_trades"].append({
            "ticker": t.get("ticker"),
            "entry_date": t.get("entry_date"),
            "exit_date": t.get("exit_date"),
            "pnl": t.get("pnl", 0),
            "pnl_pct": t.get("pnl_pct", 0),
            "strategy": t.get("strategy", ""),
        })

    # Review stats
    reviewed = [t for t in closed if t.get("review", {}).get("avg_score", 0) > 0]
    if reviewed:
        stats["review_summary"] = {
            "reviewed_trades": len(reviewed),
            "avg_entry_quality": round(sum(t["review"]["entry_quality"] for t in reviewed) / len(reviewed), 1),
            "avg_execution": round(sum(t["review"]["execution"] for t in reviewed) / len(reviewed), 1),
            "avg_management": round(sum(t["review"]["management"] for t in reviewed) / len(reviewed), 1),
            "avg_result_score": round(sum(t["review"]["result_score"] for t in reviewed) / len(reviewed), 1),
        }

    return stats


def format_stats_markdown(stats: dict) -> str:
    """Format stats as markdown report."""
    if "error" in stats:
        return f"**Error**: {stats['error']}"

    s = stats.get("summary", {})
    lines = [
        "# 交易日志统计报告",
        f"",
        f"**生成时间**: {datetime.now().isoformat()}",
        f"",
        f"## 总体统计",
        f"| 指标 | 数值 |",
        f"|------|------|",
        f"| 总交易数 | {s.get('total_trades', 0)} |",
        f"| 未平仓 | {s.get('open_trades', 0)} |",
        f"| 已平仓 | {s.get('closed_trades', 0)} |",
        f"| 盈利交易 | {s.get('winning_trades', 0)} |",
        f"| 亏损交易 | {s.get('losing_trades', 0)} |",
        f"| **胜率** | **{s.get('win_rate_pct', 0)}%** |",
        f"| **总盈亏** | **${s.get('total_pnl', 0):,.2f}** |",
        f"| 平均盈亏 | ${s.get('avg_pnl', 0):,.2f} |",
        f"| 平均盈利 | ${s.get('avg_win', 0):,.2f} |",
        f"| 平均亏损 | ${s.get('avg_loss', 0):,.2f} |",
        f"| **盈亏比** | **{s.get('payoff_ratio', 0):.2f}** |",
        f"| 利润因子 | {s.get('profit_factor', 0):.2f} |",
        f"",
    ]

    # By strategy
    by_strat = stats.get("by_strategy", {})
    if by_strat:
        lines.append("## 按策略统计")
        lines.append("| 策略 | 交易数 | 胜率 | 总盈亏 |")
        lines.append("|------|--------|------|--------|")
        for strat, data in by_strat.items():
            lines.append(f"| {strat} | {data['trades']} | {data['win_rate_pct']}% | ${data['total_pnl']:,.2f} |")
        lines.append("")

    # By month
    by_month = stats.get("by_month", {})
    if by_month:
        lines.append("## 月度统计")
        lines.append("| 月份 | 交易数 | 胜率 | 盈亏 |")
        lines.append("|------|--------|------|------|")
        for month, data in by_month.items():
            lines.append(f"| {month} | {data['trades']} | {data['win_rate_pct']}% | ${data['pnl']:,.2f} |")
        lines.append("")

    # Recent trades
    recent = stats.get("recent_trades", [])
    if recent:
        lines.append("## 最近交易")
        lines.append("| Ticker | 入场 | 出场 | 盈亏 | 盈亏% | 策略 |")
        lines.append("|--------|------|------|------|-------|------|")
        for t in recent:
            pnl_sign = "+" if t["pnl"] > 0 else ""
            lines.append(f"| {t['ticker']} | {t['entry_date']} | {t['exit_date']} | {pnl_sign}${t['pnl']:,.2f} | {pnl_sign}{t['pnl_pct']:.1f}% | {t['strategy']} |")
        lines.append("")

    # Review summary
    review = stats.get("review_summary", {})
    if review:
        lines.append("## 复盘评分均值")
        lines.append("| 维度 | 平均分(1-5) |")
        lines.append("|------|-----------|")
        lines.append(f"| 进场质量 | {review['avg_entry_quality']:.1f} |")
        lines.append(f"| 执行 | {review['avg_execution']:.1f} |")
        lines.append(f"| 管理 | {review['avg_management']:.1f} |")
        lines.append(f"| 结果 | {review['avg_result_score']:.1f} |")
        lines.append("")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(
        description="Trade journal: log, review, and analyze trades",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Log a new trade
  python3 trade_journal.py log --ticker AAPL --entry-price 175 --size 100 --strategy breakout --thesis "VCP breakout on earnings beat"

  # Close a trade
  python3 trade_journal.py close --ticker AAPL --entry-date 2026-03-01 --exit-price 190 --exit-date 2026-03-10

  # Review a trade
  python3 trade_journal.py review --ticker AAPL --entry-date 2026-03-01 --entry-quality 4 --execution 3 --management 4 --result-score 5

  # Get statistics
  python3 trade_journal.py stats
        """,
    )

    subparsers = parser.add_subparsers(dest="action", help="Action to perform")

    # Log subcommand
    log_p = subparsers.add_parser("log", help="Log a new trade")
    log_p.add_argument("--ticker", required=True, help="Ticker symbol")
    log_p.add_argument("--entry-price", type=float, required=True, help="Entry price")
    log_p.add_argument("--size", type=int, required=True, help="Position size (shares)")
    log_p.add_argument("--entry-date", help="Entry date YYYY-MM-DD (default: today)")
    log_p.add_argument("--direction", choices=["long", "short"], default="long")
    log_p.add_argument("--strategy", help="Trading strategy name")
    log_p.add_argument("--thesis", help="Trade thesis")
    log_p.add_argument("--tags", help="Comma-separated tags")
    log_p.add_argument("--exit-price", type=float, help="Exit price (if closing immediately)")
    log_p.add_argument("--exit-date", help="Exit date (if closing immediately)")

    # Close subcommand
    close_p = subparsers.add_parser("close", help="Close an existing trade")
    close_p.add_argument("--ticker", required=True)
    close_p.add_argument("--entry-date", required=True, help="Original entry date")
    close_p.add_argument("--exit-price", type=float, required=True)
    close_p.add_argument("--exit-date", help="Exit date (default: today)")

    # Review subcommand
    review_p = subparsers.add_parser("review", help="Review a closed trade")
    review_p.add_argument("--ticker", required=True)
    review_p.add_argument("--entry-date", required=True)
    review_p.add_argument("--entry-quality", type=int, choices=[1, 2, 3, 4, 5], required=True)
    review_p.add_argument("--execution", type=int, choices=[1, 2, 3, 4, 5], required=True)
    review_p.add_argument("--management", type=int, choices=[1, 2, 3, 4, 5], required=True)
    review_p.add_argument("--result-score", type=int, choices=[1, 2, 3, 4, 5], required=True)
    review_p.add_argument("--review-notes", help="Review notes")

    # Stats subcommand
    subparsers.add_parser("stats", help="Generate trading statistics")

    # Global options
    parser.add_argument("--format", choices=["json", "markdown", "both"], default="both")
    parser.add_argument("--output", help="Output file path")

    args = parser.parse_args()

    if not args.action:
        parser.print_help()
        sys.exit(1)

    # Execute action
    if args.action == "log":
        result = action_log(args)
    elif args.action == "close":
        result = action_close(args)
    elif args.action == "review":
        result = action_review(args)
    elif args.action == "stats":
        result = action_stats(args)
    else:
        print(f"Unknown action: {args.action}", file=sys.stderr)
        sys.exit(1)

    # Output
    if "error" in result:
        print(f"ERROR: {result['error']}", file=sys.stderr)
        sys.exit(1)

    if args.format in ("json", "both"):
        json_str = json.dumps(result, indent=2, ensure_ascii=False, default=str)
        if args.output:
            with open(args.output, "w") as f:
                f.write(json_str)
            print(f"JSON saved to {args.output}")
        else:
            print(json_str)

    if args.format in ("markdown", "both") and args.action == "stats":
        md = format_stats_markdown(result)
        if args.format == "both":
            print("\n" + "=" * 60 + "\n")
        print(md)


if __name__ == "__main__":
    main()
