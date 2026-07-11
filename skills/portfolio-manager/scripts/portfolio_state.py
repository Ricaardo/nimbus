#!/usr/bin/env python3
"""
portfolio_state.py — L1 统一状态层（单一真相）

把分散的真相收口成一份 portfolio_state.json，供所有投资 skill 读取：
  · 真实持仓（futu 主账户自动拉 + IBKR 小号从 ibkr_positions.json 合并）
  · 成本 / 现价 / 市值(USD) / 占比 / 浮盈亏
  · 每个持仓关联论点（thesis-tracker）状态 + conviction + 止损
  · 对账：裸仓(无论点) / 僵尸论点(论点在但仓没了) / 超配(>15%) / 半导体集中 / 破止损 / 期权到期

用法：
  python3 portfolio_state.py            # 构建 + 打印摘要
  python3 portfolio_state.py --json     # 输出完整 JSON
  python3 portfolio_state.py --quiet    # 仅写文件不打印

⚠ 只读分析，不下单。IBKR 部分依赖 AI 经 MCP 刷新 ibkr_positions.json。
"""
import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
import time

import yaml

HOME = os.path.expanduser("~")
_SKILLS = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # 自包含:相对脚本定位 skills 根,不依赖 ~/.claude
_REPO_ROOT = os.path.dirname(_SKILLS)
FUTU_PF = f"{_SKILLS}/futuapi/scripts/trade/get_all_portfolios.py"
THESES_DIR = f"{_REPO_ROOT}/reports/theses"  # canonical:仓库根 reports/theses(非 skill 内嵌目录,见 thesis-tracker/SKILL.md)
TRADES_DIR = f"{_SKILLS}/trade-journal/reports/trades"
STATE_DIR = f"{_SKILLS}/references/state"
IBKR_FILE = f"{STATE_DIR}/ibkr_positions.json"
OUT_FILE = f"{STATE_DIR}/portfolio_state.json"
NAV_HISTORY_FILE = f"{STATE_DIR}/nav_history.jsonl"
FX_CACHE_FILE = f"{STATE_DIR}/fx_cache.json"

FX_USD = {"US": 1.0, "HK": 1 / 7.80, "CN": 1 / 7.20, "SG": 1 / 1.35, "JP": 1 / 150.0}  # 静态兜底（三级降级的最后一级）
FX_LIVE_TICKERS = {"HK": "HKDUSD=X", "CN": "CNYUSD=X", "SG": "SGDUSD=X", "JP": "JPYUSD=X"}  # US 恒 1.0，不查
FX_LIVE_TIMEOUT_SEC = 8    # 整体墙钟预算（非单请求）——不得让脚本明显变慢
FX_CACHE_TTL_SEC = 12 * 3600  # 仅用于陈旧提示；缓存本身即使过期也照用（降级链见 resolve_fx）
MARKETS = {"US", "HK", "SG", "JP", "CN", "SH", "SZ"}

# 行业映射（可扩展）— 仅用于集中度对账。数字代码用 market:sym 命名空间（见 canon）。
SECTORS = {
    "SEMI": {"AVGO", "MRVL", "NVDA", "AMD", "TSM", "ASML", "SOXL", "SOXS", "MU", "SMH"},
    "CHINA_TECH": {"HK:700", "HK:9988", "BABA", "HK:3690", "HK:9618", "HK:1024"},
}
THRESH_SINGLE = 15.0      # 单标的占比上限 %
THRESH_SECTOR = 30.0      # 单行业占比上限 %


# ---------- ticker 归一化 ----------
def canon(code):
    """归一化 ticker 用于跨源匹配。
    US.MRVL→MRVL；HK.00700/0700.HK→HK:700；SZ.000700→SZ:700（与 HK:700 区分）；02359.HK→HK:2359。
    数字代码按市场加命名空间，避免不同市场同号被误并（reviewer #1）。"""
    s = str(code).upper().strip()
    mkt, sym = "", s
    if "." in s:
        a, b = s.split(".", 1)
        if a in MARKETS:
            mkt, sym = a, b
        elif b in MARKETS:
            mkt, sym = b, a
        else:
            sym = s.replace(".", "")
    if sym.isdigit():
        sym = sym.lstrip("0") or "0"
        return f"{mkt}:{sym}" if mkt else sym
    return sym


def market_of(code):
    s = str(code).upper()
    if "." in s:
        a, b = s.split(".", 1)
        if a in MARKETS:
            return a
        if b in MARKETS:
            return b
    return "US"


OPT_RE = re.compile(r"^([A-Z]+)\d{6}[CP]\d+$")


def option_underlying(code):
    """期权代码 → 标的；非期权返回 None。BABA260618C180000 → BABA"""
    sym = canon(code)
    m = OPT_RE.match(sym)
    return m.group(1) if m else None


# ---------- 数据源 ----------
def _extract_json(raw):
    m = re.search(r"(\{\s*\"|\[\s*\{)", raw)
    if not m:
        return None
    try:
        return json.JSONDecoder().raw_decode(raw[m.start():])[0]
    except Exception:
        return None


def pull_futu(rates=None):
    """拉 futu 全账户，返回 (positions[], total_nav_usd, cash_usd, ok)。
    ok=False 表示拉取失败/无数据（调用方据此判断是否可信，如是否写 nav 历史）。
    rates：生效汇率 dict（resolve_fx() 的产物，live/cache/static 三级降级后的结果）；
    未传时退回静态 FX_USD（供未走 build() 的直接调用方兼容）。"""
    rates = rates or FX_USD
    base_fx = rates.get("HK", FX_USD["HK"])   # futu 主账户基币 = HKD
    try:
        raw = subprocess.run([sys.executable, FUTU_PF, "--trd-env", "REAL", "--json"],
                             capture_output=True, text=True, timeout=90).stdout
    except Exception as e:
        print(f"[warn] 拉 futu 失败: {e}", file=sys.stderr)
        return [], 0.0, 0.0, False
    data = _extract_json(raw)
    if not data or "accounts" not in data:
        print("[warn] futu 无 accounts 数据（OpenD 是否运行？）", file=sys.stderr)
        return [], 0.0, 0.0, False
    positions, nav_usd, cash_usd = [], 0.0, 0.0
    for acc in data["accounts"]:
        funds = acc.get("funds", {}) or {}
        nav_usd += float(funds.get("total_assets", 0)) * base_fx
        cash_usd += float(funds.get("cash", 0)) * base_fx
        for p in acc.get("positions", []) or []:
            if float(p.get("qty", 0)) == 0:
                continue
            code = p.get("code", "")
            fx = rates.get(market_of(code), 1.0)
            positions.append({
                "code": code, "name": p.get("name", ""), "source": "futu",
                "qty": float(p.get("qty", 0)),
                "avg_cost": float(p.get("average_cost", 0)),
                "price": float(p.get("nominal_price", 0)),
                "mv_usd": round(float(p.get("market_val", 0)) * fx, 2),
                "pl_pct": float(p.get("pl_ratio_avg_cost", 0)),
            })
    return positions, nav_usd, cash_usd, True


def load_ibkr():
    """读 ibkr_positions.json（AI 经 MCP 刷新），返回 (positions[], mv_usd, stale, cash_usd)。
    cash_usd=None 表示缓存里没有现金字段（旧格式/未刷新），调用方不应把它并入 NAV。"""
    if not os.path.exists(IBKR_FILE):
        return [], 0.0, False, None
    try:
        with open(IBKR_FILE) as fh:
            d = json.load(fh)
    except Exception as e:
        print(f"[warn] 读 IBKR 失败: {e}", file=sys.stderr)
        return [], 0.0, False, None
    out, mv = [], 0.0
    for p in d.get("positions", []):
        try:                                   # 单条容错：部分刷新坏数据不拖垮整体
            qty, price = float(p["qty"]), float(p["price"])
            ac = float(p.get("average_cost", 0))
            m = qty * price
            mv += m
            out.append({
                "code": p["ticker"], "name": p.get("ticker", ""), "source": "ibkr",
                "qty": qty, "avg_cost": ac, "price": price, "mv_usd": round(m, 2),
                "pl_pct": round((price / ac - 1) * 100, 2) if ac else 0.0,
            })
        except (KeyError, ValueError, TypeError) as e:
            print(f"[warn] 跳过坏 IBKR 条目 {p}: {e}", file=sys.stderr)
    cash = d.get("total_cash")
    cash_usd = float(cash) if cash is not None else None
    return out, mv, bool(d.get("stale")), cash_usd


# ---------- 活汇率（三级降级：live → cache → 静态兜底） ----------
def fetch_live_fx(timeout=FX_LIVE_TIMEOUT_SEC):
    """实时拉 HKD/CNY/SGD/JPY→USD 汇率（yfinance），US 恒 1.0（不查）。
    每次请求显式限时，且整体墙钟不超过 timeout 秒；任何异常（网络/限流/超时/坏数据）
    一律返回 None——调用方据此降级到缓存/静态兜底，不得让脚本失败或明显变慢。"""
    try:
        import requests
        import yfinance as yf
    except Exception as e:
        print(f"[warn] yfinance/requests 不可用，实时汇率降级: {e}", file=sys.stderr)
        return None
    per_req_timeout = min(timeout, 5)   # 单请求硬顶，为多标的循环留总预算余量
    sess = requests.Session()
    _orig_get = sess.get
    sess.get = lambda *a, **kw: _orig_get(*a, **{**kw, "timeout": per_req_timeout})
    start = time.monotonic()
    rates = {"US": 1.0}
    try:
        for mkt, tk in FX_LIVE_TICKERS.items():
            if time.monotonic() - start > timeout:
                raise TimeoutError("实时汇率整体超时预算耗尽")
            price = yf.Ticker(tk, session=sess).fast_info["last_price"]
            if not price or price <= 0:
                raise ValueError(f"{tk} 无有效报价")
            rates[mkt] = float(price)
        return rates
    except Exception as e:
        print(f"[warn] 实时汇率拉取失败: {str(e)[:120]}", file=sys.stderr)
        return None


def load_fx_cache():
    """读 fx_cache.json，返回 {"rates","as_of"} 或 None（不存在/损坏）。不判断 TTL——
    是否仍可用由调用方（resolve_fx）决定，即使过期也照用。"""
    try:
        with open(FX_CACHE_FILE) as fh:
            return json.load(fh)
    except Exception:
        return None


def save_fx_cache(rates, as_of):
    """原子写 fx_cache.json；写失败只警告，不影响本次已拿到的实时汇率使用。"""
    try:
        os.makedirs(STATE_DIR, exist_ok=True)
        tmp = f"{FX_CACHE_FILE}.tmp"
        with open(tmp, "w") as fh:
            json.dump({"rates": rates, "as_of": as_of}, fh, ensure_ascii=False, indent=2)
        os.replace(tmp, FX_CACHE_FILE)
    except Exception as e:
        print(f"[warn] 写 fx_cache 失败（不影响本次汇率使用）: {e}", file=sys.stderr)


def _fx_cache_age_sec(as_of, now=None):
    """缓存 as_of("YYYY-MM-DD HH:MM") 距 now 的秒数；解析失败返回 None（视为未知新鲜度）。"""
    now = now or dt.datetime.now()
    try:
        return (now - dt.datetime.strptime(as_of, "%Y-%m-%d %H:%M")).total_seconds()
    except Exception:
        return None


def resolve_fx():
    """三级降级拿生效汇率：live 成功→用并写缓存；live 失败→读缓存(即使过期也用，仅 stderr 警告)；
    缓存也没有→静态 FX_USD 兜底。返回 (rates, source, as_of)，source ∈ {live, cache, static}。"""
    live = fetch_live_fx()
    if live:
        as_of = dt.datetime.now().strftime("%Y-%m-%d %H:%M")
        save_fx_cache(live, as_of)
        return live, "live", as_of
    cache = load_fx_cache()
    if cache and cache.get("rates"):
        age_sec = _fx_cache_age_sec(cache.get("as_of"))
        stale_note = ""
        if age_sec is not None and age_sec > FX_CACHE_TTL_SEC:
            stale_note = f"（已过期 {round(age_sec / 3600, 1)}h，仍降级使用）"
        print(f"[warn] 实时汇率不可用，降级用缓存{stale_note}", file=sys.stderr)
        return cache["rates"], "cache", cache.get("as_of")
    print("[warn] 实时汇率与缓存均不可用，降级用静态汇率", file=sys.stderr)
    return dict(FX_USD), "static", None


def load_theses():
    """读全部论点 YAML，key = canon(ticker)。"""
    out = {}
    if not os.path.isdir(THESES_DIR):
        return out
    for fn in os.listdir(THESES_DIR):
        if not fn.endswith((".yaml", ".yml")):
            continue
        try:
            with open(os.path.join(THESES_DIR, fn)) as fh:
                y = yaml.safe_load(fh) or {}
        except Exception as e:
            print(f"[warn] 解析论点 {fn} 失败: {e}", file=sys.stderr)
            continue
        tk = canon(y.get("ticker", fn.rsplit(".", 1)[0]))
        val = y.get("valuation", {}) or {}
        tvp = y.get("thesis_vs_price", {}) or {}
        out[tk] = {
            "file": fn,
            "type": y.get("type", ""),
            "conviction": y.get("conviction", ""),
            "score": y.get("current_conviction_score"),
            "stop_loss": val.get("stop_loss", y.get("stop_loss")),  # 兼容两种 schema：valuation.stop_loss（旧）/ 顶层 stop_loss（SKILL.md 现行）
            "take_profit": val.get("target_price", y.get("target_price")),  # 同上；喂给止盈告警(detectors.ts 读 pos.take_profit)
            "verdict": tvp.get("verdict", ""),
            "held_qty": y.get("held_qty"),
        }
    return out


def load_journal_stats():
    if not os.path.isdir(TRADES_DIR):
        return {"trade_files": 0, "tickers": []}
    files = [f for f in os.listdir(TRADES_DIR) if f.endswith((".yaml", ".yml"))]
    return {"trade_files": len(files),
            "tickers": sorted({f.split("_")[0] for f in files})}


def position_pl_usd(p):
    """由 mv_usd + pl_pct 反推单仓浮盈亏(USD)，规避 futu 侧 avg_cost/price 未换算 USD 的问题
    （pl_pct 是比率，货币无关；cost_usd = mv_usd / (1 + pl_pct/100)）。
    avg_cost 未知(记为 0，futu/IBKR 两种源都用它当"无成本数据"哨兵)时返回 None。"""
    if not p.get("avg_cost"):
        return None
    denom = 1 + p.get("pl_pct", 0.0) / 100
    if denom == 0:
        return None
    cost_usd = p["mv_usd"] / denom
    return round(p["mv_usd"] - cost_usd, 2)


def _account_pl_usd(positions):
    """账户级浮盈亏合计：全部仓位 pl_usd 未知则返回 None，否则汇总已知的(跳过未知仓位)。"""
    known = [p["pl_usd"] for p in positions if p.get("pl_usd") is not None]
    if not positions or not known:
        return None
    return round(sum(known), 2)


# ---------- 构建 + 对账 ----------
def build(_meta=None):
    """构建并返回组合单一真相。_meta（可选 dict）用于回传本次构建的内部状态（如 futu 是否拉取成功），
    不进入输出 JSON——供 main() 决定是否追加 nav 历史，不影响既有 build() 无参调用方（briefing.py 等）。"""
    rates, fx_source, fx_as_of = resolve_fx()
    fpos, fnav, fcash, fok = pull_futu(rates)
    ipos, imv, istale, icash = load_ibkr()
    theses = load_theses()
    positions = fpos + ipos

    icash_carried = False
    if icash is None:
        # IBKR 现金本次缺失（AI 经 MCP 手动刷新，可能漏写 total_cash）：
        # 从 nav_history 最后一条携带前值，避免 nav_usd 静默跳空~现金额度，
        # 给回撤/nav_history 刻下假低谷。历史里也没有前值时保持原口径（positions-only，不并入）。
        hist = load_nav_history()
        if hist:
            prev_cash = hist[-1].get("ibkr_cash_usd")
            if prev_cash is not None:
                icash = float(prev_cash)
                icash_carried = True

    icash_val = icash if icash is not None else 0.0
    nav = fnav + imv + icash_val   # 合并总 NAV(USD)；IBKR 现金若缓存/历史携带有则并入，都没有则口径不变
    cash_usd = fcash + icash_val

    held_canons = set()
    for p in positions:
        p["canon"] = canon(p["code"])
        p["is_option"] = option_underlying(p["code"]) is not None
        p["underlying"] = option_underlying(p["code"])
        p["weight_pct"] = round(p["mv_usd"] / nav * 100, 2) if nav else 0.0
        p["pl_usd"] = position_pl_usd(p)
        th = theses.get(p["canon"])
        p["thesis"] = th["file"] if th else None
        p["conviction_score"] = th["score"] if th else None
        p["thesis_verdict"] = th["verdict"] if th else None
        p["stop_loss"] = th["stop_loss"] if th else None
        p["take_profit"] = th.get("take_profit") if th else None
        if not p["is_option"]:
            held_canons.add(p["canon"])

    flags = reconcile(positions, theses, held_canons, nav, cash_usd)
    if icash_carried:
        flags.append({"type": "IBKR现金携带", "ticker": "IBKR", "severity": "medium",
                      "detail": f"本次未拉到 total_cash，携带前值 ${icash:,.2f} 并入 NAV；"
                                 "连续出现请做一次完整 IBKR 刷新(需含 total_cash)"})
    positions.sort(key=lambda x: x["mv_usd"], reverse=True)

    futu_pl = _account_pl_usd(fpos)
    ibkr_pl = _account_pl_usd(ipos)
    pl_parts = [x for x in (futu_pl, ibkr_pl) if x is not None]
    accounts = {
        "futu": {"total_usd": round(fnav, 2), "cash_usd": round(fcash, 2), "pl_usd": futu_pl},
        "ibkr": {"mv_usd": round(imv, 2),
                 "cash_usd": round(icash, 2) if icash is not None else None,
                 "stale": istale, "pl_usd": ibkr_pl,
                 "cash_carried": icash_carried},
    }

    if _meta is not None:
        _meta["futu_ok"] = fok

    return {
        "as_of": dt.datetime.now().strftime("%Y-%m-%d %H:%M"),
        "nav_usd": round(nav, 2),
        "cash_usd": round(cash_usd, 2),
        "cash_pct": round(cash_usd / nav * 100, 2) if nav else 0.0,
        "pl_usd": round(sum(pl_parts), 2) if pl_parts else None,
        "ibkr_stale": istale,
        "accounts": accounts,
        "positions": positions,
        "journal": load_journal_stats(),
        "reconcile_flags": flags,
        "fx": {"rates": rates, "source": fx_source, "as_of": fx_as_of},
    }


# ---------- 净值历史 ----------
def load_nav_history():
    """读 nav_history.jsonl，按写入顺序返回 list[dict]（最旧在前）。文件不存在/损坏行跳过。"""
    if not os.path.exists(NAV_HISTORY_FILE):
        return []
    out = []
    try:
        with open(NAV_HISTORY_FILE) as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    out.append(json.loads(line))
                except Exception:
                    continue
    except Exception as e:
        print(f"[warn] 读 nav_history 失败: {e}", file=sys.stderr)
        return []
    return out


def append_nav_history(st):
    """追加一行净值快照到 nav_history.jsonl（原子写：写临时文件再 rename）。
    调用方须保证只在 futu 拉取成功时调用。同一 as_of(ts) 重复调用去重不追加（幂等）。
    不设行数上限——每天约 2 条(07:30/20:30 cron)，规模极小。
    ibkr_cash_usd 存的是本次并入 nav 的 IBKR 现金（不管是本次新鲜值还是 carry-forward 来的），
    供下一次缺失时继续 carry-forward；旧行没有这个键时按 None 处理（见 load_ibkr/build 的兼容读取）。"""
    accounts = st.get("accounts", {})
    futu_usd = (accounts.get("futu") or {}).get("total_usd")
    ibkr_usd = round(st["nav_usd"] - futu_usd, 2) if futu_usd is not None else None
    row = {
        "ts": st["as_of"],
        "nav_usd": st["nav_usd"],
        "cash_usd": st["cash_usd"],
        "futu_usd": futu_usd,
        "ibkr_usd": ibkr_usd,
        "ibkr_cash_usd": (accounts.get("ibkr") or {}).get("cash_usd"),
        "ibkr_stale": st["ibkr_stale"],
    }
    lines = []
    if os.path.exists(NAV_HISTORY_FILE):
        try:
            with open(NAV_HISTORY_FILE) as fh:
                lines = [ln for ln in fh.read().splitlines() if ln.strip()]
        except Exception as e:
            print(f"[warn] 读 nav_history 失败，将重建: {e}", file=sys.stderr)
            lines = []
    if lines:
        try:
            last_ts = json.loads(lines[-1]).get("ts")
        except Exception:
            last_ts = None
        if last_ts == row["ts"]:
            return  # 同一 as_of 重复运行 → 去重不追加
    lines.append(json.dumps(row, ensure_ascii=False))
    os.makedirs(os.path.dirname(NAV_HISTORY_FILE), exist_ok=True)
    tmp = f"{NAV_HISTORY_FILE}.tmp"
    with open(tmp, "w") as fh:
        fh.write("\n".join(lines) + "\n")
    os.replace(tmp, NAV_HISTORY_FILE)


def nav_change_pct(history, current_nav, days, now=None):
    """找 ts ≤ now-days天 的最近一条，算相对 current_nav 的百分比变化；无合格数据返回 None。"""
    now = now or dt.datetime.now()
    cutoff = now - dt.timedelta(days=days)
    best_ts, best_nav = None, None
    for row in history:
        try:
            ts = dt.datetime.strptime(row["ts"], "%Y-%m-%d %H:%M")
            nav = float(row["nav_usd"])
        except Exception:
            continue
        if ts <= cutoff and (best_ts is None or ts > best_ts):
            best_ts, best_nav = ts, nav
    if best_nav is None or best_nav == 0:
        return None
    return round((current_nav - best_nav) / best_nav * 100, 1)


def reconcile(positions, theses, held_canons, nav, cash_usd):
    flags = []
    # 1. 裸仓：非期权、占比>1%、无论点
    for p in positions:
        if not p["is_option"] and p["weight_pct"] > 1.0 and not p["thesis"]:
            flags.append({"type": "裸仓_无论点", "ticker": p["canon"],
                          "severity": "medium",
                          "detail": f"{p['name']} 占 {p['weight_pct']}% 却无论点档案"})
    # 2. 僵尸论点：type=held 但已无对应持仓
    for tk, th in theses.items():
        if th.get("type") == "held" and tk not in held_canons:
            flags.append({"type": "僵尸论点_仓已平", "ticker": tk, "severity": "medium",
                          "detail": f"{th['file']} 标记持有，但当前无持仓 → 更新或归档"})
    # 3. 单标的超配
    for p in positions:
        if not p["is_option"] and p["weight_pct"] > THRESH_SINGLE:
            flags.append({"type": "超配_单标的>15%", "ticker": p["canon"],
                          "severity": "high",
                          "detail": f"{p['name']} {p['weight_pct']}% > {THRESH_SINGLE}%"})
    # 4. 行业集中
    for sec, members in SECTORS.items():
        w = sum(p["weight_pct"] for p in positions if p["canon"] in members)
        if w > THRESH_SECTOR:
            flags.append({"type": f"行业集中_{sec}>30%", "ticker": sec, "severity": "high",
                          "detail": f"{sec} 合计 {round(w,1)}% > {THRESH_SECTOR}%"})
    # 5. 破止损
    for p in positions:
        sl = p.get("stop_loss")
        if sl and not p["is_option"] and p["price"] and p["price"] < float(sl):
            flags.append({"type": "破止损", "ticker": p["canon"], "severity": "high",
                          "detail": f"{p['name']} 现价 {p['price']} < 止损 {sl}"})
    # 6. 期权持仓提示
    for p in positions:
        if p["is_option"]:
            flags.append({"type": "期权持仓", "ticker": p["canon"], "severity": "low",
                          "detail": f"{p['name']} 占 {p['weight_pct']}%（注意到期/Greeks）"})
    return flags


def render(st):
    L = [f"# 📦 组合统一状态 — {st['as_of']}", ""]
    L.append(f"- NAV：**${st['nav_usd']:,.0f}** | 现金 ${st['cash_usd']:,.0f} "
             f"({st['cash_pct']}%)" + ("  ⚠IBKR数据陈旧" if st["ibkr_stale"] else ""))
    L.append("")
    L.append("| 标的 | 来源 | 占比 | 市值$ | 浮盈亏% | 论点 | conv | 止损 |")
    L.append("|---|---|---|---|---|---|---|---|")
    for p in st["positions"]:
        th = "✅" if p["thesis"] else ("—" if p["is_option"] else "🔴无")
        sl = p["stop_loss"] or "—"
        cv = p["conviction_score"] if p["conviction_score"] is not None else "—"
        L.append(f"| {p['name'][:10]} | {p['source']} | {p['weight_pct']}% "
                 f"| {p['mv_usd']:,.0f} | {p['pl_pct']:+.1f} | {th} | {cv} | {sl} |")
    L.append("")
    if st["reconcile_flags"]:
        L.append("## 🚨 对账报警")
        order = {"high": 0, "medium": 1, "low": 2}
        for f in sorted(st["reconcile_flags"], key=lambda x: order.get(x["severity"], 9)):
            ic = {"high": "🔴", "medium": "🟠", "low": "🔵"}.get(f["severity"], "·")
            L.append(f"- {ic} **{f['type']}** [{f['ticker']}] — {f['detail']}")
    else:
        L.append("## ✅ 对账无异常")
    L.append("")
    L.append(f"> 单一真相写入 {OUT_FILE}；所有投资 skill 应读此文件。只读，不下单。")
    return "\n".join(L)


def main():
    ap = argparse.ArgumentParser(description="L1 统一状态层 — 构建组合单一真相 + 对账")
    ap.add_argument("--json", action="store_true", help="输出完整 JSON")
    ap.add_argument("--quiet", action="store_true", help="仅写文件不打印")
    args = ap.parse_args()

    meta = {}
    st = build(_meta=meta)
    os.makedirs(STATE_DIR, exist_ok=True)
    with open(OUT_FILE, "w") as f:
        json.dump(st, f, ensure_ascii=False, indent=2)
    if meta.get("futu_ok"):
        append_nav_history(st)

    if args.quiet:
        print(f"已写入 {OUT_FILE}（{len(st['positions'])} 持仓，"
              f"{len(st['reconcile_flags'])} 对账报警）")
    elif args.json:
        print(json.dumps(st, ensure_ascii=False, indent=2))
    else:
        print(render(st))


if __name__ == "__main__":
    main()
