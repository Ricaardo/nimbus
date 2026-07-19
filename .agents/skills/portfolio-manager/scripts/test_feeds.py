#!/usr/bin/env python3
"""idea_feed / macro_feed 解析与降级测试（合成数据，不触网/不读真实文件）。"""
import importlib.util
import os
import sys

D = os.path.dirname(__file__)


def load(name, fn):
    s = importlib.util.spec_from_file_location(name, os.path.join(D, fn))
    m = importlib.util.module_from_spec(s)
    s.loader.exec_module(m)
    return m


idf = load("idf", "idea_feed.py")
mf = load("mf", "macro_feed.py")
P, F = 0, 0


def ck(n, c):
    global P, F
    if c:
        P += 1; print(f"  ✅ {n}")
    else:
        F += 1; print(f"  ❌ {n}")


print("idea_feed 渲染/持仓标记:")
r = {"report_date": "2026-06-06", "stale_days": 0, "strategy": "x",
     "top_actions": [{"market": "HK", "symbol": "02359", "name": "药明康德",
                      "score": 74.0, "action": "新增", "delta": None}],
     "core_candidates": [{"market": "A", "symbol": "688256", "name": "寒武纪", "score": 80}],
     "counts": {}}
out = idf.render(r, holdings=["2359"])      # canon 后 02359→? 用 symbol 比对
ck("含候选名", "药明康德" in out and "688256" in out)
ck("None 报告优雅降级", "未找到" in idf.render(None))
ck("市场码映射 a→A", idf.MKT["a"] == "A")

print("macro_feed 评分逻辑 _score:")
s_on, r_on, _ = mf._score(hy=2.7, vix=15, curve=0.4)     # 利差紧+低VIX+正曲线
s_off, r_off, _ = mf._score(hy=6.0, vix=32, curve=-0.5)  # 利差宽+高VIX+倒挂
ck(f"risk-on 高分({s_on})", s_on > 60 and r_on == "risk_on")
ck(f"risk-off 低分({s_off})", s_off < 42 and r_off == "risk_off")
ck("全缺→None/neutral", mf._score(None, None, None)[0] is None)
ck("clamp 上界", mf._clamp(150) == 100 and mf._clamp(-5) == 0)

print("macro_feed 渲染/降级:")
snap = {"as_of": "2026-06-06", "fred_score": 55, "regime": "neutral",
        "series": {"10Y": 4.5, "2Y": 4.2, "curve_10y2y": 0.3, "fed_funds_upper": 4.5,
                   "hy_spread": 3.1, "dollar_broad": 100, "breakeven_10y": 2.3, "cpi": 320}}
o = mf.render(snap)
ck("含 FRED 分", "55" in o and "regime neutral" in o)
ck("含 10Y/利差", "4.5%" in o and "3.1" in o)
ck("None 缓存优雅降级", "无缓存" in mf.render(None))
ck("缺值显 —", "—" in mf.render({"as_of": "2026-06-06", "fred_score": None,
                                  "regime": None, "series": {}}))

print(f"\n结果：{P} 通过 / {F} 失败")
sys.exit(1 if F else 0)
