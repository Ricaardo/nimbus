"""Unified historical OHLCV fetcher via futu. Returns standard DataFrame.

Standard columns (matches yfinance convention):
    Date (index), Open, High, Low, Close, Volume, Turnover

Usage as module:
    from get_ohlcv import fetch_ohlcv
    df = fetch_ohlcv("AAPL", period="1y", ktype="K_DAY")

Usage as CLI:
    python3 get_ohlcv.py AAPL --period 1y --ktype K_DAY [--format csv|json]
    python3 get_ohlcv.py 600519.SH --start 2024-01-01 --end 2024-12-31
"""
import sys
import os
import json
import argparse
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ticker_mapper import to_futu

try:
    from futu import OpenQuoteContext, RET_OK, KLType, AuType
except ImportError:
    print("futu-api not installed. Run: pip install futu-api", file=sys.stderr)
    sys.exit(1)


PERIOD_DAYS = {
    "1mo": 30, "3mo": 90, "6mo": 180,
    "1y": 365, "2y": 730, "5y": 1825, "10y": 3650, "ytd": None, "max": 3650,
}

KTYPE_MAP = {
    "1m": KLType.K_1M, "3m": KLType.K_3M, "5m": KLType.K_5M,
    "15m": KLType.K_15M, "30m": KLType.K_30M, "60m": KLType.K_60M, "1h": KLType.K_60M,
    "1d": KLType.K_DAY, "1day": KLType.K_DAY, "daily": KLType.K_DAY, "K_DAY": KLType.K_DAY,
    "1w": KLType.K_WEEK, "weekly": KLType.K_WEEK, "K_WEEK": KLType.K_WEEK,
    "1mo_bar": KLType.K_MON, "K_MON": KLType.K_MON, "monthly": KLType.K_MON,
}


def _resolve_dates(period: str | None, start: str | None, end: str | None) -> tuple[str, str]:
    today = datetime.now().date()
    if start and end:
        return start, end
    end_d = end or today.isoformat()
    if period == "ytd":
        start_d = f"{today.year}-01-01"
    else:
        days = PERIOD_DAYS.get(period or "1y", 365)
        start_d = start or (today - timedelta(days=days)).isoformat()
    return start_d, end_d


def fetch_ohlcv(ticker: str, period: str | None = "1y",
                start: str | None = None, end: str | None = None,
                ktype: str = "1d", adjust: str = "forward",
                host: str = "127.0.0.1", port: int = 11111):
    """Return pandas DataFrame with standard OHLCV columns."""
    import pandas as pd

    futu_code = to_futu(ticker)
    if not futu_code:
        raise ValueError(f"Unsupported ticker: {ticker}")

    kt = KTYPE_MAP.get(ktype, KLType.K_DAY)
    au = {"forward": AuType.QFQ, "backward": AuType.HFQ, "none": AuType.NONE}.get(adjust, AuType.QFQ)
    s, e = _resolve_dates(period, start, end)

    q = OpenQuoteContext(host=host, port=port)
    try:
        all_rows = []
        page_key = None
        while True:
            ret, data, page_key = q.request_history_kline(
                futu_code, start=s, end=e, ktype=kt, autype=au, max_count=1000, page_req_key=page_key
            )
            if ret != RET_OK:
                raise RuntimeError(f"futu error: {data}")
            all_rows.append(data)
            if not page_key:
                break
        df = pd.concat(all_rows, ignore_index=True) if all_rows else pd.DataFrame()
    finally:
        q.close()

    if df.empty:
        return df

    df = df.rename(columns={
        "time_key": "Date", "open": "Open", "high": "High", "low": "Low",
        "close": "Close", "volume": "Volume", "turnover": "Turnover",
    })
    df["Date"] = pd.to_datetime(df["Date"])
    df = df[["Date", "Open", "High", "Low", "Close", "Volume", "Turnover"]].set_index("Date")
    return df


def main():
    p = argparse.ArgumentParser()
    p.add_argument("ticker")
    p.add_argument("--period", default="1y")
    p.add_argument("--start")
    p.add_argument("--end")
    p.add_argument("--ktype", default="1d")
    p.add_argument("--adjust", default="forward", choices=["forward", "backward", "none"])
    p.add_argument("--format", default="csv", choices=["csv", "json", "head"])
    args = p.parse_args()

    df = fetch_ohlcv(args.ticker, period=args.period, start=args.start, end=args.end,
                     ktype=args.ktype, adjust=args.adjust)
    if args.format == "csv":
        print(df.to_csv())
    elif args.format == "json":
        print(df.reset_index().to_json(orient="records", date_format="iso"))
    else:
        print(df.tail(10).to_string())
        print(f"\nTotal rows: {len(df)}")


if __name__ == "__main__":
    main()
