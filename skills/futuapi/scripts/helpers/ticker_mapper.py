"""Ticker format mapping: yfinance/common formats <-> futu code.

Usage as module:
    from ticker_mapper import to_futu, to_yf, detect_market

Usage as CLI:
    python3 ticker_mapper.py AAPL 600519.SH 00700.HK ^HSI
"""
import re
import sys
import json

# US index -> representative ETF (futu has no US index snapshot support)
US_INDEX_ETF = {
    "^GSPC": "US.SPY",   # S&P 500 -> SPY
    "^SPX": "US.SPY",
    "^IXIC": "US.QQQ",   # Nasdaq -> QQQ (approx, use NDX proxy)
    "^NDX": "US.QQQ",
    "^DJI": "US.DIA",
    "^RUT": "US.IWM",
    "^VIX": "US.VIXY",   # VIX -> VIXY ETF proxy
}

# HK indices in futu
HK_INDEX = {
    "^HSI": "HK.800000",      # 恒生指数
    "HSI": "HK.800000",
    "^HSCEI": "HK.800100",    # 国企指数
    "^HSTECH": "HK.800700",   # 恒生科技
}

# A-share indices
CN_INDEX = {
    "000001.SS": "SH.000001",   # 上证指数
    "^SSEC": "SH.000001",
    "399001.SZ": "SZ.399001",   # 深证成指
    "399006.SZ": "SZ.399006",   # 创业板
    "000300.SS": "SH.000300",   # 沪深300
    "000905.SS": "SH.000905",   # 中证500
}


def to_futu(ticker: str) -> str | None:
    """Convert common ticker format to futu code. Returns None if unsupported."""
    if not ticker:
        return None
    t = ticker.strip()

    # Already futu format
    if re.match(r"^(US|HK|SH|SZ|SG)\.", t):
        return t

    # Index mappings
    if t in US_INDEX_ETF:
        return US_INDEX_ETF[t]
    if t in HK_INDEX:
        return HK_INDEX[t]
    if t in CN_INDEX:
        return CN_INDEX[t]

    # yfinance suffix formats
    # 600519.SH, 000001.SS -> SH.600519
    m = re.match(r"^(\d{6})\.(SS|SH)$", t, re.IGNORECASE)
    if m:
        return f"SH.{m.group(1)}"
    # 000858.SZ -> SZ.000858
    m = re.match(r"^(\d{6})\.SZ$", t, re.IGNORECASE)
    if m:
        return f"SZ.{m.group(1)}"
    # 00700.HK / 0700.HK -> HK.00700
    m = re.match(r"^(\d{4,5})\.HK$", t, re.IGNORECASE)
    if m:
        return f"HK.{m.group(1).zfill(5)}"

    # Plain A-share 6-digit code
    if re.match(r"^\d{6}$", t):
        if t.startswith(("60", "68", "90", "51", "58")):
            return f"SH.{t}"
        if t.startswith(("00", "30", "15", "16", "12")):
            return f"SZ.{t}"
        return f"SH.{t}"

    # Plain HK 4-5 digit code
    if re.match(r"^\d{4,5}$", t):
        return f"HK.{t.zfill(5)}"

    # Crypto/commodity that futu doesn't support
    if re.match(r"^(BTC|ETH|SOL|BNB|XRP|DOGE|ADA|XAU|XAG|GC=F|CL=F|SI=F)", t, re.IGNORECASE):
        return None

    # Default: assume US equity ticker (1-5 letters, may include . or -)
    if re.match(r"^[A-Z]{1,5}([.\-][A-Z]{1,3})?$", t.upper()):
        return f"US.{t.upper()}"

    return None


def to_yf(futu_code: str) -> str:
    """Convert futu code to yfinance format (best-effort)."""
    if "." not in futu_code:
        return futu_code
    mkt, sym = futu_code.split(".", 1)
    if mkt == "US":
        return sym
    if mkt == "HK":
        return f"{sym.lstrip('0') or '0'}.HK"
    if mkt == "SH":
        return f"{sym}.SS"
    if mkt == "SZ":
        return f"{sym}.SZ"
    return futu_code


def detect_market(ticker: str) -> str:
    """Return market label: US, HK, CN, CRYPTO, INDEX_US, UNKNOWN."""
    t = ticker.strip()
    if t in US_INDEX_ETF:
        return "INDEX_US"
    if t in HK_INDEX:
        return "INDEX_HK"
    if t in CN_INDEX:
        return "INDEX_CN"
    if re.match(r"^(BTC|ETH|SOL|BNB|XRP|DOGE|ADA)", t, re.IGNORECASE):
        return "CRYPTO"
    futu = to_futu(t)
    if not futu:
        return "UNKNOWN"
    return futu.split(".")[0]


if __name__ == "__main__":
    out = []
    for t in sys.argv[1:]:
        out.append({"input": t, "futu": to_futu(t), "market": detect_market(t)})
    print(json.dumps(out, ensure_ascii=False, indent=2))
