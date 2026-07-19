#!/usr/bin/env python3
"""
# === 多市场支持 ===
# 对于 A 股/港股数据，FMP/FINVIZ API 不可用。
# 使用 shared/akshare_client.py 和 shared/market_router.py 作为替代数据源。
# A 股财报日历可通过 AKShare 的 ak.stock_report_fund_hold_detail_em() 等接口获取。
# 港股财报日历可通过 AKShare 港股相关接口获取。

Economic Calendar Fetcher using FMP API
Retrieves economic events and data releases for specified date range
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from typing import Optional


def get_api_key() -> Optional[str]:
    """
    Get FMP API key from environment variable.

    Returns:
        API key string or None if not found
    """
    api_key = os.environ.get("FMP_API_KEY")
    if not api_key:
        print("Warning: FMP_API_KEY environment variable not set", file=sys.stderr)
    return api_key


_data = None


def _facade():
    """Lazily import the data-access facade SDK (the single read path)."""
    global _data
    if _data is None:
        pkg = os.environ.get("DATA_ACCESS_PKG", os.path.expanduser("~/nimbus-os/services/data-access"))
        if pkg not in sys.path:
            sys.path.insert(0, pkg)
        import data_access as data  # noqa: PLC0415
        _data = data
    return _data


def fetch_economic_calendar(from_date: str, to_date: str, api_key: str | None = None) -> list[dict]:
    """US economic data-release calendar via the data-access facade (FRED releases).

    [{date, event, country, currency, release_id}], oldest->newest. NOTE: release
    SCHEDULE only — no estimate/actual/impact (those need a paid feed; FMP/Finnhub
    economic-calendar are 402/403 on the free tier). `api_key` is accepted but
    ignored (kept for CLI backward compatibility)."""
    return _facade().economic_calendar(from_date, to_date) or []


def validate_date_range(from_date: str, to_date: str) -> None:
    """
    Validate date range is within FMP API limits (max 90 days).

    Args:
        from_date: Start date in YYYY-MM-DD format
        to_date: End date in YYYY-MM-DD format

    Raises:
        ValueError: If date range is invalid or exceeds 90 days
    """
    try:
        start = datetime.strptime(from_date, "%Y-%m-%d")
        end = datetime.strptime(to_date, "%Y-%m-%d")
    except ValueError as e:
        raise ValueError(f"Invalid date format. Use YYYY-MM-DD: {e}")

    if start > end:
        raise ValueError(f"Start date {from_date} is after end date {to_date}")

    delta = (end - start).days
    if delta > 90:
        raise ValueError(f"Date range ({delta} days) exceeds maximum of 90 days")

    # Warn if querying past dates
    today = datetime.now().date()
    if end.date() < today:
        print(f"Warning: End date {to_date} is in the past", file=sys.stderr)


def format_event_output(events: list[dict], output_format: str = "json") -> str:
    """
    Format economic events for output.

    Args:
        events: List of event dictionaries from FMP API
        output_format: Output format ('json' or 'text')

    Returns:
        Formatted string
    """
    if output_format == "json":
        return json.dumps(events, indent=2, ensure_ascii=False)

    elif output_format == "text":
        lines = []
        lines.append(f"Economic Calendar Events (Total: {len(events)})")
        lines.append("=" * 80)

        for event in events:
            lines.append(f"\nDate: {event.get('date', 'N/A')}")
            lines.append(f"Country: {event.get('country', 'N/A')}")
            lines.append(f"Event: {event.get('event', 'N/A')}")
            lines.append(f"Currency: {event.get('currency', 'N/A')}")
            lines.append(f"Impact: {event.get('impact', 'N/A')}")

            previous = event.get("previous")
            estimate = event.get("estimate")
            actual = event.get("actual")

            if previous is not None:
                lines.append(f"Previous: {previous}")
            if estimate is not None:
                lines.append(f"Estimate: {estimate}")
            if actual is not None:
                lines.append(f"Actual: {actual}")

            change = event.get("change")
            change_pct = event.get("changePercentage")
            if change is not None:
                lines.append(f"Change: {change}")
            if change_pct is not None:
                lines.append(f"Change %: {change_pct}%")

            lines.append("-" * 80)

        return "\n".join(lines)

    else:
        raise ValueError(f"Unknown output format: {output_format}")


def main():
    """Main execution function."""
    parser = argparse.ArgumentParser(
        description="Fetch economic calendar events from FMP API",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Fetch events for next 7 days (default)
  python get_economic_calendar.py

  # Fetch events for specific date range
  python get_economic_calendar.py --from 2025-01-01 --to 2025-01-31

  # Provide API key via argument (overrides environment variable)
  python get_economic_calendar.py --api-key YOUR_KEY_HERE

  # Output as formatted text instead of JSON
  python get_economic_calendar.py --format text

  # Save output to file
  python get_economic_calendar.py --output calendar.json
        """,
    )

    # Date range arguments
    today = datetime.now().date()
    default_from = today.strftime("%Y-%m-%d")
    default_to = (today + timedelta(days=7)).strftime("%Y-%m-%d")

    parser.add_argument(
        "--from",
        dest="from_date",
        default=default_from,
        help=f"Start date in YYYY-MM-DD format (default: {default_from})",
    )
    parser.add_argument(
        "--to",
        dest="to_date",
        default=default_to,
        help=f"End date in YYYY-MM-DD format (default: {default_to})",
    )

    # API key argument
    parser.add_argument(
        "--api-key", dest="api_key", help="FMP API key (overrides FMP_API_KEY environment variable)"
    )

    # Output format
    parser.add_argument(
        "--format", choices=["json", "text"], default="json", help="Output format (default: json)"
    )

    # Output file
    parser.add_argument("--output", "-o", help="Output file path (default: stdout)")

    # Parse arguments
    args = parser.parse_args()

    # The data-access facade needs no key (FMP_API_KEY / --api-key are ignored,
    # kept only for CLI backward compatibility).
    api_key = args.api_key

    try:
        # Validate date range
        validate_date_range(args.from_date, args.to_date)

        # Fetch events
        print(
            f"Fetching economic calendar from {args.from_date} to {args.to_date}...",
            file=sys.stderr,
        )
        events = fetch_economic_calendar(args.from_date, args.to_date, api_key)

        print(f"Retrieved {len(events)} events", file=sys.stderr)

        # Format output
        output = format_event_output(events, args.format)

        # Write output
        if args.output:
            with open(args.output, "w", encoding="utf-8") as f:
                f.write(output)
            print(f"Output written to {args.output}", file=sys.stderr)
        else:
            print(output)

        sys.exit(0)

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
