#!/usr/bin/env python3
# ABOUTME: CLI wrapper for option Greeks calculation.
# ABOUTME: Computes IV from market price via Newton-Raphson.

import argparse
import json
import os
import sys

try:
    from trading_skills.greeks import calculate_greeks
except ImportError:
    # Fallback: 使用 shared/options_client 提供基础期权数据
    # calculate_greeks 需要 trading_skills 包，此处仅导入兼容
    calculate_greeks = None


def main():
    parser = argparse.ArgumentParser(description="Calculate option Greeks")
    parser.add_argument("--spot", type=float, required=True, help="Underlying spot price")
    parser.add_argument("--strike", type=float, required=True, help="Strike price")
    parser.add_argument("--type", choices=["call", "put"], required=True, help="Option type")
    parser.add_argument("--expiry", help="Expiry date (YYYY-MM-DD)")
    parser.add_argument("--dte", type=int, help="Days to expiration (alternative to --expiry)")
    parser.add_argument("--date", help="Calculate as of this date (YYYY-MM-DD), default: today")
    parser.add_argument("--price", type=float, help="Option market price (for IV calculation)")
    parser.add_argument("--vol", type=float, help="Override volatility (decimal, e.g., 0.30)")
    parser.add_argument("--rate", type=float, default=0.05, help="Risk-free rate")

    args = parser.parse_args()

    if not args.expiry and args.dte is None:
        parser.error("Must provide either --expiry or --dte")

    if calculate_greeks is None:
        print(json.dumps({"error": "trading_skills package not installed. Install with: pip install trading_skills"}))
        sys.exit(1)

    result = calculate_greeks(
        spot=args.spot,
        strike=args.strike,
        option_type=args.type,
        expiry=args.expiry,
        dte=args.dte,
        as_of_date=args.date,
        market_price=args.price,
        rate=args.rate,
        volatility=args.vol,
    )
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
