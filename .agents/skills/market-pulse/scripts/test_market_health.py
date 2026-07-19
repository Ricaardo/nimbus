#!/usr/bin/env python3
"""market_health 评分逻辑测试（合成数据，不依赖 yfinance）。"""
import importlib.util
import os
import sys

import numpy as np
import pandas as pd

_spec = importlib.util.spec_from_file_location(
    "mh", os.path.join(os.path.dirname(__file__), "market_health.py"))
mh = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mh)

P, F = 0, 0


def ck(n, c):
    global P, F
    if c:
        P += 1; print(f"  ✅ {n}")
    else:
        F += 1; print(f"  ❌ {n}")


def make_df(spy_trend, vix, dxy_trend, curve_pos=True, n=260):
    """构造合成收盘 df。spy_trend/dxy_trend: 末段斜率(正=涨)。"""
    idx = pd.date_range("2025-06-01", periods=n)
    t = np.arange(n)
    spy = 500 + spy_trend * t                      # 线性趋势
    dxy = 100 + dxy_trend * t
    tnx = np.full(n, 4.5)
    irx = np.full(n, 4.5 - (1.0 if curve_pos else -1.0))   # 曲线正/倒挂
    data = {
        "SPY": spy, "QQQ": spy * 1.4, "SMH": spy * 1.1,
        "^VIX": np.full(n, vix), "DX-Y.NYB": dxy,
        "^TNX": tnx, "^IRX": irx,
        "HYG": 100 + 0.01 * t, "IEF": np.full(n, 95.0), "RSP": 150 + spy_trend * t * 0.3,
    }
    return pd.DataFrame(data, index=idx)


print("评分情景:")
bull = mh.score(make_df(spy_trend=0.5, vix=15, dxy_trend=-0.02), geo=60)[0]
bear = mh.score(make_df(spy_trend=-0.5, vix=30, dxy_trend=0.05, curve_pos=False), geo=40)[0]
ck(f"牛市情景 MHS 高 ({bull})", bull > 58)
ck(f"熊市情景 MHS 低 ({bear})", bear < 42)
ck("牛 > 熊", bull > bear)

print("情绪 VIX 帐篷型:")
calm = mh.score(make_df(0.3, 16, -0.01), 50)[1]["情绪"]
panic = mh.score(make_df(0.3, 35, -0.01), 50)[1]["情绪"]
complacent = mh.score(make_df(0.3, 10, -0.01), 50)[1]["情绪"]
ck(f"VIX16 情绪高 ({calm})", calm > 75)
ck(f"VIX35 情绪低 ({panic})", panic < 40)
ck(f"VIX10 自满折扣 ({complacent})", complacent < calm)

print("地缘覆盖:")
g30 = mh.score(make_df(0.3, 16, -0.01), 30)
g70 = mh.score(make_df(0.3, 16, -0.01), 70)
ck("地缘 30<70 影响 MHS", g30[0] < g70[0])
ck("地缘分量透传", g30[1]["地缘"] == 30)

print("仓位映射:")
ck("85→RiskOn", mh.position_guide(85)[0].endswith("Risk-On"))
ck("45→Cautious", "Cautious" in mh.position_guide(45)[0])
ck("15→Crash", "Crash" in mh.position_guide(15)[0])

print("健壮性:")
ck("缺 RSP/HYG 仍算", isinstance(
    mh.score(make_df(0.3, 16, -0.01).drop(columns=["RSP", "HYG"]), 50)[0], float))
ck("render(None) 优雅降级", "失败" in mh.render(None))
ck("MHS 在 0-100", 0 <= bull <= 100 and 0 <= bear <= 100)

print(f"\n结果：{P} 通过 / {F} 失败")
sys.exit(1 if F else 0)
