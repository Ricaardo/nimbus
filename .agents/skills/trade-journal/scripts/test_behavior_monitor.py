#!/usr/bin/env python3
"""behavior_monitor 检测逻辑冒烟测试（无需 futu，纯合成数据）。
运行：python3 test_behavior_monitor.py  → 全绿即通过。"""
import importlib.util
import os
import sys

_spec = importlib.util.spec_from_file_location(
    "bm", os.path.join(os.path.dirname(__file__), "behavior_monitor.py"))
bm = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bm)

PASS, FAIL = 0, 0


def check(name, cond):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ✅ {name}")
    else:
        FAIL += 1
        print(f"  ❌ {name}")


def fill(tk, qty, price, side, t, fx=1.0):
    return {"ticker": tk, "code": f"US.{tk}", "market": "US",
            "qty": qty, "price": price, "fx": fx, "side": side, "time": t}


def has_flag(rep, typ_prefix, tk=None):
    return any(f["type"].startswith(typ_prefix) and (tk is None or f["ticker"] == tk)
              for f in rep["flags"])


print("时间解析（含/不含微秒）:")
check("微秒格式", bm._parse_time("2026-06-05 09:30:00.123") is not None)
check("无微秒格式", bm._parse_time("2026-06-05 09:30:00") is not None)
check("两格式分钟差=1", abs(bm._minutes_between(
    "2026-06-05 09:30:00", "2026-06-05 09:31:00.000") - 1.0) < 1e-6)

print("FX 换算（HK/JP → USD）:")
hk = [fill("X", 100, 780, "BUY", "2026-06-05 09:30:00", fx=1/7.8),
      fill("X", 100, 780, "SELL", "2026-06-05 09:31:00", fx=1/7.8)]
r = bm.analyze(hk, 10000, 7)
check("HK 周转≈$20k(USD)", abs(r["gross_turnover"] - 20000) < 5)

print("摊低成本（持仓期内递降 vs 平仓后独立 dip）:")
# 持仓期内越跌越买：BUY100@10, BUY100@9, BUY100@8 → 应报警
avg_down = [fill("A", 100, 10, "BUY", "2026-06-05 09:30:00"),
            fill("A", 100, 9, "BUY", "2026-06-05 09:31:00"),
            fill("A", 100, 8, "BUY", "2026-06-05 09:32:00"),
            fill("A", 300, 8.5, "SELL", "2026-06-05 09:40:00")]
check("持仓期内递降 → M02 报警", has_flag(bm.analyze(avg_down, 10000, 7), "M02"))
# 平仓后独立 dip-buy：BUY@10,SELL,BUY@9,SELL,BUY@8,SELL → 不应报警
dips = [fill("B", 100, 10, "BUY", "2026-06-05 09:30:00"),
        fill("B", 100, 10, "SELL", "2026-06-05 09:31:00"),
        fill("B", 100, 9, "BUY", "2026-06-05 10:30:00"),
        fill("B", 100, 9, "SELL", "2026-06-05 10:31:00"),
        fill("B", 100, 8, "BUY", "2026-06-05 11:30:00"),
        fill("B", 100, 8, "SELL", "2026-06-05 11:31:00")]
check("平仓后独立 dip → 不报警", not has_flag(bm.analyze(dips, 10000, 7), "M02"))

print("反手/翻向（穿越零轴真反向 vs 正常 scalp）:")
# long→flat→short 60min 内 → 应报警
flip = [fill("C", 100, 10, "BUY", "2026-06-05 09:30:00"),
        fill("C", 100, 10, "SELL", "2026-06-05 09:40:00"),   # flat
        fill("C", 100, 10, "SELL", "2026-06-05 09:50:00")]   # 转空
check("long→flat→short → M01 报警", has_flag(bm.analyze(flip, 10000, 7), "M01"))
# 正常 scalp：long→flat→long（不反向）→ 不应报警
scalp = [fill("D", 100, 10, "BUY", "2026-06-05 09:30:00"),
         fill("D", 100, 10, "SELL", "2026-06-05 09:40:00"),
         fill("D", 100, 10, "BUY", "2026-06-05 09:50:00"),
         fill("D", 100, 10, "SELL", "2026-06-05 09:55:00")]
check("long→flat→long(同向) → 不报警", not has_flag(bm.analyze(scalp, 10000, 7), "M01"))

print("杠杆 ETF 对敲亏损:")
lev = [fill("SOXL", 10, 200, "BUY", "2026-06-05 09:30:00"),
       fill("SOXL", 10, 195, "SELL", "2026-06-05 09:40:00")]   # flat, -50
check("SOXL 亏损 → M08 报警", has_flag(bm.analyze(lev, 10000, 7), "M08"))

print("边界:")
check("空 fills 不崩", bm.analyze([], 10000, 7)["total_fills"] == 0)
check("nav=0 不除零", bm.analyze(avg_down, 0, 7)["turnover_ratio_week"] == 0)

print(f"\n结果：{PASS} 通过 / {FAIL} 失败")
sys.exit(1 if FAIL else 0)
