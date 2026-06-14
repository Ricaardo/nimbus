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

import yaml

HOME = os.path.expanduser("~")
_SKILLS = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # 自包含:相对脚本定位 skills 根,不依赖 ~/.claude
FUTU_PF = f"{_SKILLS}/futuapi/scripts/trade/get_all_portfolios.py"
THESES_DIR = f"{_SKILLS}/thesis-tracker/reports/theses"
TRADES_DIR = f"{_SKILLS}/trade-journal/reports/trades"
STATE_DIR = f"{_SKILLS}/references/state"
IBKR_FILE = f"{STATE_DIR}/ibkr_positions.json"
OUT_FILE = f"{STATE_DIR}/portfolio_state.json"

FX_USD = {"US": 1.0, "HK": 1 / 7.80, "CN": 1 / 7.20, "SG": 1 / 1.35, "JP": 1 / 150.0}
FUTU_BASE_FX = FX_USD["HK"]        # futu 主账户基币 = HKD
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


def pull_futu():
    """拉 futu 全账户，返回 (positions[], total_nav_usd, cash_usd)。"""
    try:
        raw = subprocess.run([sys.executable, FUTU_PF, "--trd-env", "REAL", "--json"],
                             capture_output=True, text=True, timeout=90).stdout
    except Exception as e:
        print(f"[warn] 拉 futu 失败: {e}", file=sys.stderr)
        return [], 0.0, 0.0
    data = _extract_json(raw)
    if not data or "accounts" not in data:
        print("[warn] futu 无 accounts 数据（OpenD 是否运行？）", file=sys.stderr)
        return [], 0.0, 0.0
    positions, nav_usd, cash_usd = [], 0.0, 0.0
    for acc in data["accounts"]:
        funds = acc.get("funds", {}) or {}
        nav_usd += float(funds.get("total_assets", 0)) * FUTU_BASE_FX
        cash_usd += float(funds.get("cash", 0)) * FUTU_BASE_FX
        for p in acc.get("positions", []) or []:
            if float(p.get("qty", 0)) == 0:
                continue
            code = p.get("code", "")
            fx = FX_USD.get(market_of(code), 1.0)
            positions.append({
                "code": code, "name": p.get("name", ""), "source": "futu",
                "qty": float(p.get("qty", 0)),
                "avg_cost": float(p.get("average_cost", 0)),
                "price": float(p.get("nominal_price", 0)),
                "mv_usd": round(float(p.get("market_val", 0)) * fx, 2),
                "pl_pct": float(p.get("pl_ratio_avg_cost", 0)),
            })
    return positions, nav_usd, cash_usd


def load_ibkr():
    """读 ibkr_positions.json（AI 经 MCP 刷新），返回 (positions[], mv_usd, stale)。"""
    if not os.path.exists(IBKR_FILE):
        return [], 0.0, False
    try:
        with open(IBKR_FILE) as fh:
            d = json.load(fh)
    except Exception as e:
        print(f"[warn] 读 IBKR 失败: {e}", file=sys.stderr)
        return [], 0.0, False
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
    return out, mv, bool(d.get("stale"))


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
            "stop_loss": val.get("stop_loss"),
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


# ---------- 构建 + 对账 ----------
def build():
    fpos, fnav, fcash = pull_futu()
    ipos, imv, istale = load_ibkr()
    theses = load_theses()
    positions = fpos + ipos
    nav = fnav + imv          # 合并总 NAV(USD)
    cash_usd = fcash

    held_canons = set()
    for p in positions:
        p["canon"] = canon(p["code"])
        p["is_option"] = option_underlying(p["code"]) is not None
        p["underlying"] = option_underlying(p["code"])
        p["weight_pct"] = round(p["mv_usd"] / nav * 100, 2) if nav else 0.0
        th = theses.get(p["canon"])
        p["thesis"] = th["file"] if th else None
        p["conviction_score"] = th["score"] if th else None
        p["thesis_verdict"] = th["verdict"] if th else None
        p["stop_loss"] = th["stop_loss"] if th else None
        if not p["is_option"]:
            held_canons.add(p["canon"])

    flags = reconcile(positions, theses, held_canons, nav, cash_usd)
    positions.sort(key=lambda x: x["mv_usd"], reverse=True)

    return {
        "as_of": dt.datetime.now().strftime("%Y-%m-%d %H:%M"),
        "nav_usd": round(nav, 2),
        "cash_usd": round(cash_usd, 2),
        "cash_pct": round(cash_usd / nav * 100, 2) if nav else 0.0,
        "ibkr_stale": istale,
        "positions": positions,
        "journal": load_journal_stats(),
        "reconcile_flags": flags,
    }


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

    st = build()
    os.makedirs(STATE_DIR, exist_ok=True)
    with open(OUT_FILE, "w") as f:
        json.dump(st, f, ensure_ascii=False, indent=2)

    if args.quiet:
        print(f"已写入 {OUT_FILE}（{len(st['positions'])} 持仓，"
              f"{len(st['reconcile_flags'])} 对账报警）")
    elif args.json:
        print(json.dumps(st, ensure_ascii=False, indent=2))
    else:
        print(render(st))


if __name__ == "__main__":
    main()
