#!/usr/bin/env python3
"""portfolio_state 关键逻辑测试（ticker 归一化 / 期权识别 / 对账），无需 futu。"""
import importlib.util
import os
import sys

_spec = importlib.util.spec_from_file_location(
    "ps", os.path.join(os.path.dirname(__file__), "portfolio_state.py"))
ps = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ps)

P, F = 0, 0


def ck(name, cond):
    global P, F
    if cond:
        P += 1; print(f"  ✅ {name}")
    else:
        F += 1; print(f"  ❌ {name}")


print("canon 归一化（跨源匹配核心）:")
ck("US.MRVL→MRVL", ps.canon("US.MRVL") == "MRVL")
ck("HK.00700→HK:700", ps.canon("HK.00700") == "HK:700")
ck("0700.HK→HK:700（前导零归一）", ps.canon("0700.HK") == "HK:700")
ck("HK.00700 == 0700.HK", ps.canon("HK.00700") == ps.canon("0700.HK"))
ck("HK.02359 == 02359.HK", ps.canon("HK.02359") == ps.canon("02359.HK"))
ck("NOK→NOK", ps.canon("NOK") == "NOK")
ck("期权串不被误并", ps.canon("US.BABA260618C180000") == "BABA260618C180000")
# reviewer #1：跨市场同号不可误并
ck("SZ.000700 ≠ HK.00700（防跨市场误并）",
   ps.canon("SZ.000700") != ps.canon("HK.00700"))
ck("SH.600519 命名空间", ps.canon("SH.600519") == "SH:600519")

print("期权识别 / 标的提取:")
ck("BABA call → underlying BABA",
   ps.option_underlying("US.BABA260618C180000") == "BABA")
ck("普通股非期权", ps.option_underlying("US.MRVL") is None)
ck("市场识别 HK", ps.market_of("HK.00700") == "HK")

print("对账逻辑:")
positions = [
    {"canon": "AVGO", "name": "博通", "is_option": False, "weight_pct": 24.5,
     "thesis": None, "stop_loss": None, "price": 386},
    {"canon": "MRVL", "name": "迈威尔", "is_option": False, "weight_pct": 10.0,
     "thesis": "MRVL.yaml", "stop_loss": 200, "price": 180},   # 破止损
    {"canon": "700", "name": "腾讯", "is_option": False, "weight_pct": 12.0,
     "thesis": "0700HK.yaml", "stop_loss": 360, "price": 453},
]
theses = {"700": {"file": "0700HK.yaml", "type": "held"},
          "ZOMBIE": {"file": "ZOMBIE.yaml", "type": "held"}}  # 论点在但无持仓
held = {"AVGO", "MRVL", "700"}
flags = ps.reconcile(positions, theses, held, nav=100000, cash_usd=8000)
types = [f["type"] for f in flags]
ck("裸仓 AVGO 被抓", any("裸仓" in t and f["ticker"] == "AVGO"
                     for t, f in zip(types, flags)))
ck("超配 AVGO>15%", any("超配" in t and f["ticker"] == "AVGO"
                      for t, f in zip(types, flags)))
ck("僵尸论点 ZOMBIE 被抓", any("僵尸" in t and f["ticker"] == "ZOMBIE"
                         for t, f in zip(types, flags)))
ck("破止损 MRVL（180<200）", any("破止损" in t and f["ticker"] == "MRVL"
                            for t, f in zip(types, flags)))
ck("有论点的腾讯不报裸仓", not any(f["ticker"] == "700" and "裸仓" in f["type"]
                            for f in flags))

print(f"\n结果：{P} 通过 / {F} 失败")
sys.exit(1 if F else 0)
