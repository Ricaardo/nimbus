#!/usr/bin/env python3
"""nav_view / briefing._nav_line 测试（统一净值视图：回撤 / 跨账户重叠 / 出入金 / 排序防御 /
briefing NAV 行退化），无需 futu，同目录 importlib 装载（与 test_portfolio_state.py 同惯例）。"""
import datetime as dt
import importlib.util
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))


def _load(mod_name, path):
    spec = importlib.util.spec_from_file_location(mod_name, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


nv = _load("nv", os.path.join(_HERE, "nav_view.py"))
br = _load("br", os.path.join(_HERE, "briefing.py"))

P, F = 0, 0


def ck(name, cond):
    global P, F
    if cond:
        P += 1; print(f"  ✅ {name}")
    else:
        F += 1; print(f"  ❌ {name}")


NOW = dt.datetime(2026, 7, 11, 20, 30)

print("max_drawdown（peak-to-trough，含防御性排序）:")
ck("有效点 < 2 → None（空历史，只有当前一点）", nv.max_drawdown([], 10000.0) is None)
ck("恰好 1 条历史 + 当前 = 2 点，无回撤 → 0.0",
   nv.max_drawdown([{"nav_usd": 10000.0}], 10000.0) == 0.0)

# 手验序列：18000 -> 19000 -> 17000 -> 21000 -> 当前 22000
# peak 序列：18000,19000,19000,21000,22000；最大回撤发生在 19000->17000 = (19000-17000)/19000
hist_ordered = [
    {"ts": "2026-06-01 20:30", "nav_usd": 18000.0},
    {"ts": "2026-07-04 20:30", "nav_usd": 19000.0},
    {"ts": "2026-07-09 07:30", "nav_usd": 17000.0},
    {"ts": "2026-07-11 07:30", "nav_usd": 21000.0},
]
expected_dd = round((19000.0 - 17000.0) / 19000.0 * 100, 1)
dd = nv.max_drawdown(hist_ordered, 22000.0)
ck(f"手验序列最大回撤 = {expected_dd}%", dd == expected_dd)

# 防御性排序：nav_view.build() 内部会先排序，直接测 _sorted_history + 用乱序调用 max_drawdown/
# since_inception 的等价路径（通过 build() 整体验证，而不是裸调用 max_drawdown，因为 max_drawdown
# 本身不做排序——排序防御在 build() 里做一次，覆盖 since_inception 和 max_drawdown 两处依赖）
hist_shuffled = [hist_ordered[2], hist_ordered[0], hist_ordered[3], hist_ordered[1]]  # 乱序
ck("_sorted_history 把乱序历史排回时间升序",
   [r["ts"] for r in nv._sorted_history(hist_shuffled)] == [r["ts"] for r in hist_ordered])

synthetic_state = {
    "as_of": "2026-07-11 20:30",
    "nav_usd": 22000.0,
    "cash_usd": 2000.0,
    "cash_pct": 9.09,
    "pl_usd": 1500.0,
    "ibkr_stale": False,
    "accounts": {
        "futu": {"total_usd": 20200.0, "cash_usd": 1800.0, "pl_usd": 1200.0},
        "ibkr": {"mv_usd": 1800.0, "cash_usd": 200.0, "stale": False, "pl_usd": 300.0,
                 "cash_carried": False},
    },
    "positions": [],
}
v_ordered = nv.build(now=NOW, state=synthetic_state, history=hist_ordered, flows=[])
v_shuffled = nv.build(now=NOW, state=synthetic_state, history=hist_shuffled, flows=[])
ck("build() 对乱序/有序历史结果一致（max_drawdown）",
   v_ordered["max_drawdown_pct"] == v_shuffled["max_drawdown_pct"] == expected_dd)
ck("build() 对乱序/有序历史结果一致（since_inception 用最早一条 18000）",
   v_ordered["since_inception"]["ref_nav"] == v_shuffled["since_inception"]["ref_nav"] == 18000.0)

print("\noverlap（跨账户重仓重叠）:")
positions_overlap = [
    {"canon": "NBIS", "source": "futu", "name": "Nebius", "weight_pct": 5.0, "mv_usd": 1000.0},
    {"canon": "NBIS", "source": "ibkr", "name": "Nebius", "weight_pct": 2.0, "mv_usd": 400.0},
    {"canon": "AVGO", "source": "futu", "name": "Broadcom", "weight_pct": 20.0, "mv_usd": 4000.0},
]
ov = nv.overlap(positions_overlap)
ck("跨账户命中：NBIS 同现 futu+ibkr", len(ov) == 1 and ov[0]["canon"] == "NBIS")
ck("跨账户命中：合并 weight_pct/mv_usd", ov[0]["weight_pct"] == 7.0 and ov[0]["mv_usd"] == 1400.0)
ck("单账户标的不误判为重叠（AVGO 只在 futu）",
   not any(o["canon"] == "AVGO" for o in ov))

# 期权不误并：同一 underlying 的正股(futu)与期权(ibkr)不应被当成"重叠标的"——用真实 canon()（经
# nav_view 内部装载的 ps 模块）算出的 canon 值构造，期权串 canon 与正股 canon 天然不同，
# 不会被 overlap() 误合并（overlap 只按 canon 分组，不做 underlying 归并）。
_canon_stock = nv.ps.canon("US.MRVL")
_canon_option = nv.ps.canon("US.MRVL260618C100000")
ck("前置断言：期权 canon 与正股 canon 确实不同（否则下面测试没意义）",
   _canon_stock != _canon_option and _canon_stock == "MRVL")
positions_option = [
    {"canon": _canon_stock, "source": "futu", "name": "Marvell", "weight_pct": 10.0, "mv_usd": 2000.0},
    {"canon": _canon_option, "source": "ibkr", "name": "MRVL Call",
     "weight_pct": 3.0, "mv_usd": 600.0, "is_option": True, "underlying": "MRVL"},
]
ov_opt = nv.overlap(positions_option)
ck("期权与正股 canon 不同，不误并入重叠列表", ov_opt == [])

print("\nnet_flow（区间净流入，符号与边界）:")
flows = [
    {"ts": "2026-07-05", "amount_usd": 500.0, "note": "存入"},
    {"ts": "2026-07-08", "amount_usd": -200.0, "note": "取出"},
    {"ts": "2026-06-01", "amount_usd": 1000.0, "note": "区间外"},
]
since = dt.datetime(2026, 7, 4, 20, 30)
ck("区间内净流入求和（500-200=300）", nv.net_flow(flows, since, NOW) == 300.0)
ck("空 flows → 0.0（非 hit，但返回值一致为 0）", nv.net_flow([], since, NOW) == 0.0)
ck("区间外的流水不计入（1000 那笔被排除）",
   nv.net_flow(flows, since, NOW) != 1300.0)
only_out = [{"ts": "2026-06-15", "amount_usd": 999.0}]
ck("区间外单笔也应为 0（不误纳入）", nv.net_flow(only_out, since, NOW) == 0.0)

print("\nrender()：历史 0/1 条时优雅省略，不报错:")
state_no_hist = dict(synthetic_state)
v_empty_hist = nv.build(now=NOW, state=state_no_hist, history=[], flows=[])
ck("0 条历史 → week/month/since_inception 均 None", v_empty_hist["week"] is None
   and v_empty_hist["month"] is None and v_empty_hist["since_inception"] is None)
md_empty = nv.render(v_empty_hist)
ck("0 条历史 render() 正常出串且提示'历史不足'", isinstance(md_empty, str) and "历史不足" in md_empty)

v_one_hist = nv.build(now=NOW, state=state_no_hist,
                       history=[{"ts": "2026-07-11 07:30", "nav_usd": 21000.0}], flows=[])
ck("1 条历史（太新，< 7天）→ week 仍 None（不报错）", v_one_hist["week"] is None)
ck("1 条历史 → since_inception 用这条", v_one_hist["since_inception"] is not None
   and v_one_hist["since_inception"]["ref_nav"] == 21000.0)
md_one = nv.render(v_one_hist)
ck("1 条历史 render() 不抛异常", isinstance(md_one, str) and len(md_one) > 50)

ck("render(None)（state 缺失）优雅降级不报错", "先跑 portfolio_state.py" in nv.render(None))

print("\nbriefing._nav_line：无 accounts 字段退回旧格式:")
state_legacy = {"nav_usd": 20000.0, "cash_usd": 2000.0, "cash_pct": 10.0,
                 "positions": [1, 2, 3], "ibkr_stale": False}   # 无 'accounts' 键（老快照）
line_legacy = br._nav_line(state_legacy)
ck("无 accounts 时不含 futu/IBKR 拆分括号", "futu" not in line_legacy and "IBKR" not in line_legacy)
ck("无 accounts 时仍显示 NAV/现金/持仓数",
   "NAV **$20,000**" in line_legacy and "现金 10.0%" in line_legacy and "3 持仓" in line_legacy)

state_with_accounts = {"nav_usd": 22000.0, "cash_usd": 2000.0, "cash_pct": 9.09,
                        "positions": [1, 2], "ibkr_stale": False,
                        "accounts": {"futu": {"total_usd": 20200.0}, "ibkr": {"mv_usd": 1800.0}}}
line_new = br._nav_line(state_with_accounts)
ck("有 accounts 时展示 futu/IBKR 拆分",
   "futu $20,200" in line_new and "IBKR $1,800" in line_new)

print(f"\n结果：{P} 通过 / {F} 失败")
sys.exit(1 if F else 0)
