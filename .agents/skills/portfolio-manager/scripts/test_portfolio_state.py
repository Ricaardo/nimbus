#!/usr/bin/env python3
"""portfolio_state 关键逻辑测试（ticker 归一化 / 期权识别 / 对账 / 浮盈亏反推 / 净值历史 /
IBKR 现金 carry-forward），无需 futu。"""
import datetime as dt
import importlib.util
import json
import os
import shutil
import sys
import tempfile

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

print("单仓浮盈亏反推 position_pl_usd（mv_usd/pl_pct 反推，规避 avg_cost 未换算 USD 问题）:")
ck("正常仓位（cost_usd=100, mv=150 → pl=50）",
   ps.position_pl_usd({"avg_cost": 100, "mv_usd": 150.0, "pl_pct": 50.0}) == 50.0)
ck("pl_pct=-100（denom=0，除零保护）→ None",
   ps.position_pl_usd({"avg_cost": 100, "mv_usd": 0.0, "pl_pct": -100.0}) is None)
ck("avg_cost=0（无成本数据的哨兵）→ None",
   ps.position_pl_usd({"avg_cost": 0, "mv_usd": 100.0, "pl_pct": 0.0}) is None)
ck("avg_cost 键缺失 → None",
   ps.position_pl_usd({"mv_usd": 100.0, "pl_pct": 10.0}) is None)

print("账户浮盈亏合计 _account_pl_usd:")
ck("空持仓列表 → None", ps._account_pl_usd([]) is None)
ck("全部未知 → None", ps._account_pl_usd([{"pl_usd": None}, {"pl_usd": None}]) is None)
ck("混合：跳过未知，求和已知", ps._account_pl_usd(
    [{"pl_usd": 100.0}, {"pl_usd": None}, {"pl_usd": -20.0}]) == 80.0)

print("净值变化 nav_change_pct（历史边界）:")
_now = dt.datetime(2026, 7, 11, 12, 0)
ck("空历史 → None", ps.nav_change_pct([], 1000.0, 7, now=_now) is None)
ck("无 ≤cutoff 行（仅一条太新）→ None", ps.nav_change_pct(
    [{"ts": "2026-07-10 12:00", "nav_usd": 900.0}], 1000.0, 7, now=_now) is None)
ck("ref_nav=0 → None（除零保护）", ps.nav_change_pct(
    [{"ts": "2026-07-01 12:00", "nav_usd": 0.0}], 1000.0, 7, now=_now) is None)
ck("正常区间百分比（800→1000 = +25%）", ps.nav_change_pct(
    [{"ts": "2026-07-01 12:00", "nav_usd": 800.0}], 1000.0, 7, now=_now) == 25.0)
ck("恰好 7 天边界（<=cutoff 纳入）", ps.nav_change_pct(
    [{"ts": "2026-07-04 12:00", "nav_usd": 800.0}], 1000.0, 7, now=_now) == 25.0)

print("nav_history.jsonl 追加：幂等去重:")
_tmp_idem = tempfile.mkdtemp(prefix="ps_idem_")
_orig_hist = ps.NAV_HISTORY_FILE
_hist_idem = os.path.join(_tmp_idem, "nav_history.jsonl")
ps.NAV_HISTORY_FILE = _hist_idem
try:
    st_a = {"as_of": "2026-07-01 07:30", "nav_usd": 20000.0, "cash_usd": 2000.0, "ibkr_stale": False,
            "accounts": {"futu": {"total_usd": 18000.0}, "ibkr": {"cash_usd": 200.0}}}
    ps.append_nav_history(st_a)
    with open(_hist_idem) as fh:
        n1 = len(fh.read().splitlines())
    ps.append_nav_history(st_a)   # 同 ts 重跑（如 cron 手动重跑一次）
    with open(_hist_idem) as fh:
        n2 = len(fh.read().splitlines())
    ck("同 as_of 重复调用去重不追加", n1 == 1 and n2 == 1)
    st_b = dict(st_a); st_b["as_of"] = "2026-07-01 20:30"
    ps.append_nav_history(st_b)
    with open(_hist_idem) as fh:
        n3 = len(fh.read().splitlines())
    ck("不同 as_of 正常追加", n3 == 2)
finally:
    ps.NAV_HISTORY_FILE = _orig_hist
    shutil.rmtree(_tmp_idem)

print("nav_history 追加：futu_ok=False 门控不追加（main() 只在 meta['futu_ok'] 真时才调用）:")
_tmp_gate = tempfile.mkdtemp(prefix="ps_gate_")
_hist_gate = os.path.join(_tmp_gate, "nav_history.jsonl")
_orig_pull_futu, _orig_load_ibkr = ps.pull_futu, ps.load_ibkr
ps.NAV_HISTORY_FILE = _hist_gate
ps.pull_futu = lambda rates=None: ([], 0.0, 0.0, False)   # 模拟 futu 拉取失败/OpenD 未运行
ps.load_ibkr = lambda: ([], 0.0, False, None)
try:
    meta = {}
    st_fail = ps.build(_meta=meta)
    ck("futu 失败时 meta['futu_ok']=False", meta.get("futu_ok") is False)
    if meta.get("futu_ok"):        # 复刻 main() 里的门控写法
        ps.append_nav_history(st_fail)
    ck("futu_ok=False → 未追加，文件未创建", not os.path.exists(_hist_gate))
finally:
    ps.pull_futu, ps.load_ibkr, ps.NAV_HISTORY_FILE = _orig_pull_futu, _orig_load_ibkr, _orig_hist
    shutil.rmtree(_tmp_gate)

print("IBKR 现金 carry-forward（本次缺 total_cash 时不让 nav 塌陷）:")
_tmp_carry = tempfile.mkdtemp(prefix="ps_navcarry_")
_hist_carry = os.path.join(_tmp_carry, "nav_history.jsonl")
with open(_hist_carry, "w") as fh:
    fh.write(json.dumps({"ts": "2026-07-10 20:30", "nav_usd": 25050.0, "cash_usd": 20160.0,
                          "futu_usd": 23000.0, "ibkr_usd": 2050.0, "ibkr_cash_usd": 360.0,
                          "ibkr_stale": False}) + "\n")
ps.NAV_HISTORY_FILE = _hist_carry
ps.pull_futu = lambda rates=None: ([], 23000.0, 19800.0, True)     # futu 本次正常
ps.load_ibkr = lambda: ([], 1690.0, False, None)        # IBKR 本次漏写 total_cash → None
try:
    st_carry = ps.build()
finally:
    ps.pull_futu, ps.load_ibkr, ps.NAV_HISTORY_FILE = _orig_pull_futu, _orig_load_ibkr, _orig_hist
    shutil.rmtree(_tmp_carry)
ck("carry-forward: accounts.ibkr.cash_carried=True", st_carry["accounts"]["ibkr"]["cash_carried"] is True)
ck("carry-forward: cash_usd 携带历史前值 360.0", st_carry["accounts"]["ibkr"]["cash_usd"] == 360.0)
ck("carry-forward: nav_usd 未塌陷（23000+1690+360=25050）", st_carry["nav_usd"] == 25050.0)

print("IBKR 现金无前值可携带时：保持原口径，不误 carry:")
_tmp_nohist = tempfile.mkdtemp(prefix="ps_nocarry_")
ps.NAV_HISTORY_FILE = os.path.join(_tmp_nohist, "does_not_exist.jsonl")  # 历史文件不存在
ps.pull_futu = lambda rates=None: ([], 23000.0, 19800.0, True)
ps.load_ibkr = lambda: ([], 1690.0, False, None)
try:
    st_nohist = ps.build()
finally:
    ps.pull_futu, ps.load_ibkr, ps.NAV_HISTORY_FILE = _orig_pull_futu, _orig_load_ibkr, _orig_hist
    shutil.rmtree(_tmp_nohist)
ck("无历史可携带: cash_carried=False", st_nohist["accounts"]["ibkr"]["cash_carried"] is False)
ck("无历史可携带: cash_usd=null（口径不变，不并入）", st_nohist["accounts"]["ibkr"]["cash_usd"] is None)
ck("无历史可携带: nav_usd 不含 IBKR 现金（23000+1690=24690）", st_nohist["nav_usd"] == 24690.0)

print("旧格式历史行（无 ibkr_cash_usd 键，2026-07-11 之前写入）→ 兼容读取为未知，不 carry:")
_tmp_oldrow = tempfile.mkdtemp(prefix="ps_oldrow_")
_hist_old = os.path.join(_tmp_oldrow, "nav_history.jsonl")
with open(_hist_old, "w") as fh:
    fh.write(json.dumps({"ts": "2026-07-09 07:30", "nav_usd": 24000.0, "cash_usd": 19500.0,
                          "futu_usd": 22500.0, "ibkr_usd": 1500.0, "ibkr_stale": False}) + "\n")
ps.NAV_HISTORY_FILE = _hist_old
ps.pull_futu = lambda rates=None: ([], 23000.0, 19800.0, True)
ps.load_ibkr = lambda: ([], 1690.0, False, None)
try:
    st_oldrow = ps.build()
finally:
    ps.pull_futu, ps.load_ibkr, ps.NAV_HISTORY_FILE = _orig_pull_futu, _orig_load_ibkr, _orig_hist
    shutil.rmtree(_tmp_oldrow)
ck("旧行缺 ibkr_cash_usd 键 → 视为未知，不 carry", st_oldrow["accounts"]["ibkr"]["cash_carried"] is False)

print("FUTU NAV carry-forward（OpenD 掉线时携带上次 futu_usd，避免假回撤/假集中度告警）:")
_tmp_fcarry = tempfile.mkdtemp(prefix="ps_fcarry_")
_hist_fcarry = os.path.join(_tmp_fcarry, "nav_history.jsonl")
with open(_hist_fcarry, "w") as fh:
    fh.write(json.dumps({"ts": "2026-07-15 07:31", "nav_usd": 25604.79, "cash_usd": 19610.11,
                          "futu_usd": 23516.17, "ibkr_usd": 2088.62, "ibkr_cash_usd": -77.38,
                          "ibkr_stale": False}) + "\n")
ps.NAV_HISTORY_FILE = _hist_fcarry
ps.pull_futu = lambda rates=None: ([], 0.0, 0.0, False)   # OpenD 掉线 → futu 拉取失败
ps.load_ibkr = lambda: ([{"code": "USO", "name": "USO", "source": "ibkr", "qty": 20.0,
                          "avg_cost": 110.23, "price": 120.14, "mv_usd": 2402.8,
                          "pl_pct": 9.0}], 2402.8, False, -77.38)
try:
    st_fc = ps.build()
finally:
    ps.pull_futu, ps.load_ibkr, ps.NAV_HISTORY_FILE = _orig_pull_futu, _orig_load_ibkr, _orig_hist
    shutil.rmtree(_tmp_fcarry)
_uso = next(p for p in st_fc["positions"] if p["code"] == "USO")
ck("futu carry: nav_usd 保持完整（23516.17+2402.8-77.38=25841.59）",
   abs(st_fc["nav_usd"] - 25841.59) < 0.01)
ck("futu carry: accounts.futu.total_usd 携带前值 23516.17",
   st_fc["accounts"]["futu"]["total_usd"] == 23516.17)
ck("futu carry: USO 占比 <25%（无假集中度告警）", _uso["weight_pct"] < 25)
ck("futu carry: 携带标记 flag 存在",
   any(f["type"] == "FUTU数据陈旧_携带" for f in st_fc["reconcile_flags"]))

print("FUTU 拉取失败且无历史可携带：不误 carry，保持原口径:")
_tmp_fnh = tempfile.mkdtemp(prefix="ps_fnohist_")
ps.NAV_HISTORY_FILE = os.path.join(_tmp_fnh, "does_not_exist.jsonl")
ps.pull_futu = lambda rates=None: ([], 0.0, 0.0, False)
ps.load_ibkr = lambda: ([], 2402.8, False, 0.0)
try:
    st_fnh = ps.build()
finally:
    ps.pull_futu, ps.load_ibkr, ps.NAV_HISTORY_FILE = _orig_pull_futu, _orig_load_ibkr, _orig_hist
    shutil.rmtree(_tmp_fnh)
ck("无历史可携带: 无 FUTU 携带标记",
   not any(f["type"] == "FUTU数据陈旧_携带" for f in st_fnh["reconcile_flags"]))
ck("无历史可携带: nav_usd 仅 IBKR（口径不变，不虚增）", st_fnh["nav_usd"] == 2402.8)

print(f"\n结果：{P} 通过 / {F} 失败")
sys.exit(1 if F else 0)
