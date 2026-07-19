#!/usr/bin/env python3
"""
# === 多市场支持 ===
# 对于 A 股/港股数据，FMP/FINVIZ API 不可用。
# 使用 shared/akshare_client.py 和 shared/market_router.py 作为替代数据源。
# A 股财报日历可通过 AKShare 的 ak.stock_report_fund_hold_detail_em() 等接口获取。
# 港股财报日历可通过 AKShare 港股相关接口获取。

FMP Earnings Calendar Fetcher

Retrieves upcoming earnings announcements from Financial Modeling Prep API,
filters by market cap (>$2B), and outputs structured JSON data.

Usage:
    # With environment variable
    export FMP_API_KEY="your-key"
    python fetch_earnings_fmp.py 2025-11-03 2025-11-09

    # With API key as argument
    python fetch_earnings_fmp.py 2025-11-03 2025-11-09 YOUR_API_KEY

    # Help
    python fetch_earnings_fmp.py --help
"""

import json
import os
import sys
from datetime import datetime
from typing import Optional

sys.path.insert(0, "/Users/x/nimbus-os/services/data-access")


def _short_exchange(long_name: Optional[str]) -> str:
    """Finnhub's long exchange name -> legacy FMP short code (for US filters)."""
    s = (long_name or "").upper()
    if "NASDAQ" in s:
        return "NASDAQ"
    if "ARCA" in s:
        return "NYSEArca"
    if "NEW YORK STOCK EXCHANGE" in s or s.startswith("NYSE"):
        return "NYSE"
    if "BATS" in s or "CBOE" in s:
        return "BATS"
    if "AMERICAN" in s or "AMEX" in s or "NYSE MKT" in s:
        return "AMEX"
    return long_name or ""


class FMPEarningsCalendar:
    """Earnings calendar client backed by the data-access facade (Tier-1)."""

    MIN_MARKET_CAP = 2_000_000_000  # $2B
    US_EXCHANGES = ["NYSE", "NASDAQ", "AMEX", "NYSEArca", "BATS", "NMS", "NGM", "NCM"]

    def __init__(self, api_key: Optional[str] = None, us_only: bool = True):
        """
        Args:
            api_key: accepted for backward compatibility; unused (facade needs none)
            us_only: If True, filter for US stocks only (default: True)
        """
        self.api_key = api_key
        self.us_only = us_only

    def fetch_earnings_calendar(self, start_date: str, end_date: str) -> Optional[list[dict]]:
        """
        Fetch earnings calendar from FMP API

        Args:
            start_date: Start date (YYYY-MM-DD)
            end_date: End date (YYYY-MM-DD)

        Returns:
            List of earnings announcements or None on error
        """
        try:
            import data_access as data  # noqa: PLC0415

            rows = data.earnings_calendar(start_date, end_date) or []
        except Exception as e:  # noqa: BLE001
            print(f"❌ ERROR: {str(e)}", file=sys.stderr)
            return None

        # Map facade (Finnhub-shaped) rows to the legacy FMP earning_calendar shape.
        out = [
            {
                "symbol": e.get("symbol"),
                "date": e.get("date"),
                "time": e.get("hour", ""),  # Finnhub 'hour' (bmo/amc) -> legacy 'time'
                "eps": e.get("epsActual"),
                "epsEstimated": e.get("epsEstimate"),
                "revenue": e.get("revenueActual"),
                "revenueEstimated": e.get("revenueEstimate"),
            }
            for e in rows
        ]
        print(f"✓ Retrieved {len(out)} earnings announcements", file=sys.stderr)
        return out

    def fetch_company_profiles(self, symbols: list[str]) -> dict[str, dict]:
        """
        Fetch company profiles for multiple symbols (batch)

        Args:
            symbols: List of ticker symbols

        Returns:
            Dictionary mapping symbol to profile data
        """
        profiles: dict[str, dict] = {}
        print(f"✓ Fetching profiles for {len(symbols)} companies...", file=sys.stderr)

        import data_access as data  # noqa: PLC0415

        for sym in symbols:
            canon = sym if ":" in str(sym).upper() else f"US:{sym}"
            try:
                rows = data.profile(canon) or []
            except Exception:  # noqa: BLE001
                rows = []
            if rows:
                p = rows[0]
                profiles[sym] = {
                    "symbol": sym,
                    "companyName": p.get("name"),
                    "sector": p.get("sector"),
                    "industry": p.get("industry"),
                    "exchangeShortName": _short_exchange(p.get("exchange")),
                    "mktCap": p.get("marketCap"),
                }

        print(f"✓ Retrieved {len(profiles)} company profiles", file=sys.stderr)
        return profiles

    def filter_by_market_cap(self, earnings: list[dict], profiles: dict[str, dict]) -> list[dict]:
        """
        Filter earnings by minimum market cap and enrich with company data

        Args:
            earnings: List of earnings announcements
            profiles: Dictionary of company profiles

        Returns:
            Filtered and enriched list of earnings
        """
        filtered = []

        for earning in earnings:
            symbol = earning.get("symbol")
            if not symbol:
                continue

            profile = profiles.get(symbol)

            # Filter by market cap and exchange
            if profile:
                market_cap = profile.get("mktCap", 0)
                if market_cap < self.MIN_MARKET_CAP:
                    continue

                exchange = profile.get("exchangeShortName", "N/A")

                # Filter by US exchanges if us_only is True
                if self.us_only and exchange not in self.US_EXCHANGES:
                    continue

                # Enrich with profile data
                earning["marketCap"] = market_cap
                earning["companyName"] = profile.get("companyName", symbol)
                earning["sector"] = profile.get("sector", "N/A")
                earning["industry"] = profile.get("industry", "N/A")
                earning["exchange"] = exchange

                filtered.append(earning)

        if self.us_only:
            print(
                f"✓ Filtered to {len(filtered)} US mid-cap+ companies (>${self.MIN_MARKET_CAP / 1e9:.0f}B)",
                file=sys.stderr,
            )
        else:
            print(
                f"✓ Filtered to {len(filtered)} mid-cap+ companies (>${self.MIN_MARKET_CAP / 1e9:.0f}B)",
                file=sys.stderr,
            )

        return filtered

    def normalize_timing(self, time_value: Optional[str]) -> str:
        """
        Normalize timing values to BMO/AMC/TAS

        Args:
            time_value: Raw time value from API

        Returns:
            Normalized timing: BMO, AMC, or TAS
        """
        if not time_value:
            return "TAS"

        time_lower = time_value.lower()

        if time_lower in ["bmo", "pre-market", "before market open"]:
            return "BMO"
        elif time_lower in ["amc", "after-market", "after market close"]:
            return "AMC"
        else:
            return "TAS"

    def format_market_cap(self, market_cap: float) -> str:
        """
        Format market cap in human-readable format

        Args:
            market_cap: Market cap in dollars

        Returns:
            Formatted string (e.g., "$3.0T", "$150B")
        """
        if market_cap >= 1e12:
            return f"${market_cap / 1e12:.1f}T"
        elif market_cap >= 1e9:
            return f"${market_cap / 1e9:.1f}B"
        elif market_cap >= 1e6:
            return f"${market_cap / 1e6:.0f}M"
        else:
            return f"${market_cap:,.0f}"

    def process_earnings(self, earnings: list[dict]) -> list[dict]:
        """
        Process and standardize earnings data

        Args:
            earnings: Raw earnings data

        Returns:
            Processed earnings data
        """
        processed = []

        for earning in earnings:
            # Normalize timing
            timing = self.normalize_timing(earning.get("time"))

            # Format market cap
            market_cap = earning.get("marketCap", 0)
            market_cap_formatted = self.format_market_cap(market_cap)

            processed_earning = {
                "symbol": earning.get("symbol"),
                "companyName": earning.get("companyName", earning.get("symbol")),
                "date": earning.get("date"),
                "timing": timing,
                "marketCap": market_cap,
                "marketCapFormatted": market_cap_formatted,
                "sector": earning.get("sector", "N/A"),
                "industry": earning.get("industry", "N/A"),
                "epsEstimated": earning.get("epsEstimated"),
                "revenueEstimated": earning.get("revenueEstimated"),
                "fiscalDateEnding": earning.get("fiscalDateEnding"),
                "exchange": earning.get("exchange", "N/A"),
            }

            processed.append(processed_earning)

        return processed

    def sort_earnings(self, earnings: list[dict]) -> list[dict]:
        """
        Sort earnings by date, timing, and market cap

        Args:
            earnings: Processed earnings data

        Returns:
            Sorted earnings data
        """
        # Define timing order
        timing_order = {"BMO": 1, "AMC": 2, "TAS": 3}

        return sorted(
            earnings,
            key=lambda x: (
                x.get("date", ""),
                timing_order.get(x.get("timing", "TAS"), 3),
                -x.get("marketCap", 0),  # Descending market cap
            ),
        )


def get_api_key() -> Optional[str]:
    """
    Get API key from environment or command line

    Returns:
        API key or None
    """
    # Method 1: Command line argument (position 3)
    if len(sys.argv) >= 4:
        api_key = sys.argv[3]
        print("✓ API key provided via command line argument", file=sys.stderr)
        return api_key

    # Method 2: Environment variable
    api_key = os.environ.get("FMP_API_KEY")
    if api_key:
        print("✓ API key loaded from FMP_API_KEY environment variable", file=sys.stderr)
        return api_key

    # Not found
    print("❌ ERROR: No API key found", file=sys.stderr)
    print("", file=sys.stderr)
    print("Options:", file=sys.stderr)
    return None


def validate_date(date_str: str) -> bool:
    """
    Validate date format (YYYY-MM-DD)

    Args:
        date_str: Date string

    Returns:
        True if valid, False otherwise
    """
    try:
        datetime.strptime(date_str, "%Y-%m-%d")
        return True
    except ValueError:
        return False


def print_usage():
    """Print usage instructions"""
    print("Usage:", file=sys.stderr)
    print("  python fetch_earnings_fmp.py START_DATE END_DATE [API_KEY]", file=sys.stderr)
    print("", file=sys.stderr)
    print("Arguments:", file=sys.stderr)
    print("  START_DATE  Start date in YYYY-MM-DD format", file=sys.stderr)
    print("  END_DATE    End date in YYYY-MM-DD format", file=sys.stderr)
    print("  API_KEY     (Optional) FMP API key (or use FMP_API_KEY env var)", file=sys.stderr)
    print("", file=sys.stderr)
    print("Examples:", file=sys.stderr)
    print("  export FMP_API_KEY='your-key'", file=sys.stderr)
    print("  python fetch_earnings_fmp.py 2025-11-03 2025-11-09", file=sys.stderr)
    print("", file=sys.stderr)
    print("  python fetch_earnings_fmp.py 2025-11-03 2025-11-09 your-key", file=sys.stderr)
    print("", file=sys.stderr)
    print("Output:", file=sys.stderr)
    print("  JSON data is written to stdout", file=sys.stderr)
    print("  Progress messages are written to stderr", file=sys.stderr)


def main():
    """Main execution"""
    # Check for help flag
    if len(sys.argv) > 1 and sys.argv[1] in ["-h", "--help", "help"]:
        print_usage()
        sys.exit(0)

    # Validate arguments
    if len(sys.argv) < 3:
        print("❌ ERROR: Missing required arguments", file=sys.stderr)
        print("", file=sys.stderr)
        print_usage()
        sys.exit(1)

    start_date = sys.argv[1]
    end_date = sys.argv[2]

    # Validate dates
    if not validate_date(start_date):
        print(f"❌ ERROR: Invalid start date format: {start_date}", file=sys.stderr)
        print("Expected format: YYYY-MM-DD", file=sys.stderr)
        sys.exit(1)

    if not validate_date(end_date):
        print(f"❌ ERROR: Invalid end date format: {end_date}", file=sys.stderr)
        print("Expected format: YYYY-MM-DD", file=sys.stderr)
        sys.exit(1)

    # API key is optional now (data comes from the facade); kept for back-compat.
    api_key = get_api_key()

    print("", file=sys.stderr)
    print(f"📅 Fetching earnings calendar: {start_date} to {end_date}", file=sys.stderr)
    print("", file=sys.stderr)

    # Initialize client
    client = FMPEarningsCalendar(api_key)

    # Step 1: Fetch earnings calendar
    print("Step 1: Fetching earnings calendar...", file=sys.stderr)
    earnings = client.fetch_earnings_calendar(start_date, end_date)
    if earnings is None:
        sys.exit(1)

    if len(earnings) == 0:
        print("⚠️  Warning: No earnings announcements found for date range", file=sys.stderr)
        print(json.dumps([], indent=2))
        sys.exit(0)

    # Step 2: Fetch company profiles
    print("", file=sys.stderr)
    print("Step 2: Fetching company profiles...", file=sys.stderr)
    symbols = list(set([e.get("symbol") for e in earnings if e.get("symbol")]))
    profiles = client.fetch_company_profiles(symbols)

    # Step 3: Filter by market cap
    print("", file=sys.stderr)
    print("Step 3: Filtering by market cap...", file=sys.stderr)
    filtered_earnings = client.filter_by_market_cap(earnings, profiles)

    if len(filtered_earnings) == 0:
        print("⚠️  Warning: No companies with market cap >$2B found", file=sys.stderr)
        print(json.dumps([], indent=2))
        sys.exit(0)

    # Step 4: Process earnings data
    print("", file=sys.stderr)
    print("Step 4: Processing earnings data...", file=sys.stderr)
    processed_earnings = client.process_earnings(filtered_earnings)

    # Step 5: Sort earnings
    print("", file=sys.stderr)
    print("Step 5: Sorting by date, timing, and market cap...", file=sys.stderr)
    sorted_earnings = client.sort_earnings(processed_earnings)

    print(f"✓ Final dataset: {len(sorted_earnings)} companies", file=sys.stderr)

    # Output JSON to stdout
    print("", file=sys.stderr)
    print("✓ Complete! Writing JSON output...", file=sys.stderr)
    print(json.dumps(sorted_earnings, indent=2))


if __name__ == "__main__":
    main()
