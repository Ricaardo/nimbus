"""Stop-loss and take-profit manager for active trades.

Calculates stop-loss levels using 4 strategies (fixed %, ATR, support, volatility percentile),
take-profit targets (R:R ratio, Fibonacci extensions), and trailing stop parameters.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


@dataclass
class StopLossResult:
    strategy: str
    stop_price: float
    stop_distance_pct: float
    risk_amount: float
    risk_per_share: float
    targets: list[dict]
    trailing: dict
    position_value: float
    entry_price: float
    position_size: float


def fixed_pct_stop(entry: float, pct: float) -> float:
    """Fixed percentage stop below entry."""
    return round(entry * (1 - pct / 100), 2)


def atr_stop(entry: float, atr: float, multiplier: float = 2.0) -> float:
    """ATR-based stop: entry - (ATR * multiplier)."""
    return round(entry - atr * multiplier, 2)


def support_stop(support_level: float, buffer_pct: float = 0.5) -> float:
    """Stop below technical support level with buffer."""
    return round(support_level * (1 - buffer_pct / 100), 2)


def volatility_percentile_stop(entry: float, daily_std: float, percentile: float = 95) -> float:
    """Stop based on historical volatility percentile (normal distribution approximation).

    Uses z-score for the given percentile to set stop distance.
    """
    z_scores = {90: 1.282, 95: 1.645, 99: 2.326}
    z = z_scores.get(int(percentile), 1.645)
    # Use 5-day horizon for swing trades
    multi_day_std = daily_std * math.sqrt(5)
    return round(entry * (1 - z * multi_day_std / 100), 2)


def calc_targets(entry: float, stop: float, rr_ratios: list[float] | None = None,
                 fib_extensions: bool = True) -> list[dict]:
    """Calculate take-profit targets using R:R ratios and Fibonacci extensions."""
    risk = entry - stop
    if risk <= 0:
        return []

    targets = []
    ratios = rr_ratios or [2.0, 3.0]
    for rr in ratios:
        tp = round(entry + risk * rr, 2)
        gain_pct = round((tp - entry) / entry * 100, 2)
        targets.append({
            "method": f"R:R 1:{rr:.0f}",
            "target_price": tp,
            "gain_pct": gain_pct,
            "reward_risk_ratio": rr,
        })

    if fib_extensions:
        fib_levels = [1.618, 2.618]
        for fib in fib_levels:
            tp = round(entry + risk * fib, 2)
            gain_pct = round((tp - entry) / entry * 100, 2)
            targets.append({
                "method": f"Fibonacci {fib:.3f}",
                "target_price": tp,
                "gain_pct": gain_pct,
                "reward_risk_ratio": round(fib, 2),
            })

    return sorted(targets, key=lambda x: x["target_price"])


def calc_trailing(entry: float, stop: float, atr: float | None = None) -> dict:
    """Generate trailing stop parameters."""
    initial_distance = entry - stop
    initial_pct = round(initial_distance / entry * 100, 2)

    trailing = {
        "initial_stop": stop,
        "trailing_type": "percentage",
        "trail_pct": initial_pct,
        "activation_note": f"Activate trailing stop after price moves {initial_pct}% above entry",
    }

    if atr is not None:
        trailing["atr_trail"] = {
            "atr_value": atr,
            "multiplier": 2.0,
            "trail_distance": round(atr * 2.0, 2),
            "note": "Trail by 2x ATR from highest close since entry",
        }
        trailing["trailing_type"] = "atr"

    # Stepped trailing: tighten stop as profit grows
    trailing["stepped_trail"] = [
        {"profit_pct": round(initial_pct, 1), "new_stop": "breakeven (entry price)"},
        {"profit_pct": round(initial_pct * 2, 1), "new_stop": f"lock {initial_pct}% profit"},
        {"profit_pct": round(initial_pct * 3, 1), "new_stop": f"lock {initial_pct * 2}% profit"},
    ]

    return trailing


def calculate_stop_loss(
    entry_price: float,
    position_size: float,
    account_size: float,
    strategy: str = "fixed",
    stop_pct: float = 5.0,
    atr: float | None = None,
    atr_multiplier: float = 2.0,
    support_level: float | None = None,
    support_buffer: float = 0.5,
    daily_std: float | None = None,
    vol_percentile: float = 95,
    rr_ratios: list[float] | None = None,
) -> dict:
    """Main calculation function."""

    # Calculate stop price based on strategy
    if strategy == "fixed":
        stop_price = fixed_pct_stop(entry_price, stop_pct)
    elif strategy == "atr":
        if atr is None:
            raise ValueError("ATR value required for atr strategy")
        stop_price = atr_stop(entry_price, atr, atr_multiplier)
    elif strategy == "support":
        if support_level is None:
            raise ValueError("support_level required for support strategy")
        stop_price = support_stop(support_level, support_buffer)
    elif strategy == "volatility":
        if daily_std is None:
            raise ValueError("daily_std required for volatility strategy")
        stop_price = volatility_percentile_stop(entry_price, daily_std, vol_percentile)
    else:
        raise ValueError(f"Unknown strategy: {strategy}. Use: fixed, atr, support, volatility")

    if stop_price <= 0:
        stop_price = 0.01

    risk_per_share = round(entry_price - stop_price, 2)
    risk_amount = round(risk_per_share * position_size, 2)
    stop_distance_pct = round((entry_price - stop_price) / entry_price * 100, 2)
    position_value = round(entry_price * position_size, 2)
    risk_of_account = round(risk_amount / account_size * 100, 2) if account_size > 0 else 0

    targets = calc_targets(entry_price, stop_price, rr_ratios)
    trailing = calc_trailing(entry_price, stop_price, atr)

    result = {
        "strategy": strategy,
        "entry_price": entry_price,
        "stop_price": stop_price,
        "stop_distance_pct": stop_distance_pct,
        "position_size": position_size,
        "position_value": position_value,
        "risk_per_share": risk_per_share,
        "risk_amount": risk_amount,
        "risk_of_account_pct": risk_of_account,
        "account_size": account_size,
        "targets": targets,
        "trailing": trailing,
        "generated_at": datetime.now().isoformat(),
    }

    # Add strategy-specific params
    if strategy == "fixed":
        result["params"] = {"stop_pct": stop_pct}
    elif strategy == "atr":
        result["params"] = {"atr": atr, "multiplier": atr_multiplier}
    elif strategy == "support":
        result["params"] = {"support_level": support_level, "buffer_pct": support_buffer}
    elif strategy == "volatility":
        result["params"] = {"daily_std": daily_std, "percentile": vol_percentile}

    return result


def format_markdown(result: dict) -> str:
    """Format result as markdown report."""
    lines = [
        f"# 止损/止盈分析报告",
        f"",
        f"**生成时间**: {result['generated_at']}",
        f"**策略**: {result['strategy']}",
        f"",
        f"## 仓位信息",
        f"| 项目 | 数值 |",
        f"|------|------|",
        f"| 入场价格 | ${result['entry_price']:.2f} |",
        f"| 持仓数量 | {result['position_size']:.0f} 股 |",
        f"| 仓位价值 | ${result['position_value']:,.2f} |",
        f"| 账户总值 | ${result['account_size']:,.2f} |",
        f"",
        f"## 止损设置",
        f"| 项目 | 数值 |",
        f"|------|------|",
        f"| **止损价格** | **${result['stop_price']:.2f}** |",
        f"| 止损距离 | {result['stop_distance_pct']:.2f}% |",
        f"| 每股风险 | ${result['risk_per_share']:.2f} |",
        f"| **总风险金额** | **${result['risk_amount']:,.2f}** |",
        f"| 账户风险占比 | {result['risk_of_account_pct']:.2f}% |",
        f"",
    ]

    if result.get("params"):
        lines.append("**策略参数**: " + ", ".join(f"{k}={v}" for k, v in result["params"].items()))
        lines.append("")

    if result["targets"]:
        lines.append("## 止盈目标")
        lines.append("| 方法 | 目标价格 | 预期收益 | 风险回报比 |")
        lines.append("|------|---------|---------|-----------|")
        for t in result["targets"]:
            lines.append(f"| {t['method']} | ${t['target_price']:.2f} | +{t['gain_pct']:.2f}% | 1:{t['reward_risk_ratio']:.1f} |")
        lines.append("")

    trailing = result["trailing"]
    lines.append("## 追踪止损建议")
    lines.append(f"- **类型**: {trailing['trailing_type']}")
    lines.append(f"- **初始止损**: ${trailing['initial_stop']:.2f}")
    lines.append(f"- {trailing['activation_note']}")
    lines.append("")

    if "atr_trail" in trailing:
        at = trailing["atr_trail"]
        lines.append(f"### ATR 追踪")
        lines.append(f"- ATR 值: {at['atr_value']:.2f}, 倍数: {at['multiplier']}x")
        lines.append(f"- 追踪距离: ${at['trail_distance']:.2f}")
        lines.append(f"- {at['note']}")
        lines.append("")

    if "stepped_trail" in trailing:
        lines.append("### 阶梯止损")
        lines.append("| 盈利达到 | 止损调整至 |")
        lines.append("|---------|----------|")
        for s in trailing["stepped_trail"]:
            lines.append(f"| +{s['profit_pct']}% | {s['new_stop']} |")
        lines.append("")

    # Risk warning
    lines.append("---")
    lines.append("**风险提示**: 止损不保证成交价格，缺口或流动性不足可能导致实际止损价格偏离设定值。")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(
        description="Stop-loss and take-profit manager",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Fixed percentage stop (5%)
  python3 stop_loss_manager.py --strategy fixed --entry 150 --size 100 --account 50000 --stop-pct 5

  # ATR-based stop (2x ATR)
  python3 stop_loss_manager.py --strategy atr --entry 150 --size 100 --account 50000 --atr 3.5

  # Support level stop
  python3 stop_loss_manager.py --strategy support --entry 150 --size 100 --account 50000 --support 142

  # Volatility percentile stop (95th percentile)
  python3 stop_loss_manager.py --strategy volatility --entry 150 --size 100 --account 50000 --daily-std 1.8
        """,
    )

    parser.add_argument("--strategy", choices=["fixed", "atr", "support", "volatility"],
                        default="fixed", help="Stop-loss strategy (default: fixed)")
    parser.add_argument("--entry", type=float, required=True, help="Entry price")
    parser.add_argument("--size", type=float, required=True, help="Position size (shares)")
    parser.add_argument("--account", type=float, required=True, help="Account size ($)")

    # Fixed pct params
    parser.add_argument("--stop-pct", type=float, default=5.0, help="Stop percentage for fixed strategy (default: 5%%)")

    # ATR params
    parser.add_argument("--atr", type=float, help="ATR value for atr strategy")
    parser.add_argument("--atr-multiplier", type=float, default=2.0, help="ATR multiplier (default: 2.0)")

    # Support params
    parser.add_argument("--support", type=float, help="Support level for support strategy")
    parser.add_argument("--support-buffer", type=float, default=0.5, help="Buffer below support %% (default: 0.5)")

    # Volatility params
    parser.add_argument("--daily-std", type=float, help="Daily standard deviation (%%) for volatility strategy")
    parser.add_argument("--vol-percentile", type=float, default=95, help="Volatility percentile (default: 95)")

    # Target params
    parser.add_argument("--rr-ratios", type=float, nargs="+", default=[2.0, 3.0],
                        help="Risk:Reward ratios for targets (default: 2 3)")

    # Output
    parser.add_argument("--output", type=str, help="Output JSON file path")
    parser.add_argument("--format", choices=["json", "markdown", "both"], default="both",
                        help="Output format (default: both)")

    args = parser.parse_args()

    try:
        result = calculate_stop_loss(
            entry_price=args.entry,
            position_size=args.size,
            account_size=args.account,
            strategy=args.strategy,
            stop_pct=args.stop_pct,
            atr=args.atr,
            atr_multiplier=args.atr_multiplier,
            support_level=args.support,
            support_buffer=args.support_buffer,
            daily_std=args.daily_std,
            vol_percentile=args.vol_percentile,
            rr_ratios=args.rr_ratios,
        )
    except ValueError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

    # Output
    if args.format in ("json", "both"):
        json_str = json.dumps(result, indent=2, ensure_ascii=False)
        if args.output:
            with open(args.output, "w") as f:
                f.write(json_str)
            print(f"JSON saved to {args.output}")
        else:
            print(json_str)

    if args.format in ("markdown", "both"):
        md = format_markdown(result)
        if args.format == "both":
            print("\n" + "=" * 60 + "\n")
        print(md)


if __name__ == "__main__":
    main()
