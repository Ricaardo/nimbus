"""Shared helper for market-data skill scripts: data-access SDK path + symbol
normalization. Tier-2 scripts import this, never a data-source SDK."""
import re
import sys

sys.path.insert(0, "/Users/x/nimbus-os/services/data-access")


def to_canonical(tok: str) -> str:
    """AAPL->US:AAPL; 00700.HK->HK:00700; 600519(.SH/.SS)->CN:600519; US.AAPL->US:AAPL."""
    t = tok.strip().upper()
    if ":" in t:
        return t
    m = re.match(r"^(US|HK|SH|SZ)\.(.+)$", t)
    if m:
        mk, loc = m.group(1), m.group(2)
        return {"US": f"US:{loc}", "HK": f"HK:{loc.zfill(5)}", "SH": f"CN:{loc}", "SZ": f"CN:{loc}"}[mk]
    m = re.match(r"^(\d{4,5})\.HK$", t)
    if m:
        return f"HK:{m.group(1).zfill(5)}"
    m = re.match(r"^(\d{6})\.(SH|SS|SZ)$", t)
    if m:
        return f"CN:{m.group(1)}"
    if re.match(r"^\d{6}$", t):           # bare 6-digit -> A-share
        return f"CN:{t}"
    if re.match(r"^[A-Z]{1,6}([.\-][A-Z])?$", t):
        return f"US:{t}"
    return f"US:{t}"
