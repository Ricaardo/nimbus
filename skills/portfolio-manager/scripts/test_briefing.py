#!/usr/bin/env python3
"""briefing 纯逻辑测试（衰减档/日期/待办排序），无需 futu。"""
import datetime as dt
import importlib.util
import os
import sys

_spec = importlib.util.spec_from_file_location(
    "br", os.path.join(os.path.dirname(__file__), "briefing.py"))
br = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(br)

P, F = 0, 0


def ck(n, c):
    global P, F
    if c:
        P += 1; print(f"  ✅ {n}")
    else:
        F += 1; print(f"  ❌ {n}")


print("衰减档边界:")
ck("59天=Active", br.decay_label(59)[0] == "Active")
ck("60天=Stale", br.decay_label(60)[0] == "Stale")
ck("89天=Stale", br.decay_label(89)[0] == "Stale")
ck("90天=Decayed", br.decay_label(90)[0] == "Decayed")
ck("179天=Decayed", br.decay_label(179)[0] == "Decayed")
ck("180天=Zombie", br.decay_label(180)[0] == "Zombie")
ck("None→?", br.decay_label(None)[0] == "?")

print("日期 age:")
y = (br.TODAY - dt.timedelta(days=10)).isoformat()
ck("10天前=10", br._age_days(y) == 10)
ck("坏日期→None", br._age_days("不是日期") is None)

print("待办排序（high 在前、衰减/复审中、裸仓在后）:")
state = {"reconcile_flags": [
    {"type": "裸仓_无论点", "ticker": "AVGO", "severity": "medium", "detail": "x"},
    {"type": "超配_单标的>15%", "ticker": "MRVL", "severity": "high", "detail": "y"},
]}
theses = [
    {"ticker": "Z", "type": "held", "age": 200, "nr_due": None, "next_review": None},
    {"ticker": "D", "type": "held", "age": 5, "nr_due": -3, "next_review": "2026-06-01"},
]
items = br.action_items(state, theses)
ck("第1条是 high 超配", "超配" in items[0])
ck("裸仓排在 high 之后", any("裸仓" in m for m in items) and
   items.index(next(m for m in items if "裸仓" in m)) >
   items.index(next(m for m in items if "超配" in m)))
ck("僵尸论点(200天)入待办", any("衰减" in m and "[Z]" in m for m in items))
ck("复审到期入待办", any("复审到期" in m and "[D]" in m for m in items))

print(f"\n结果：{P} 通过 / {F} 失败")
sys.exit(1 if F else 0)
