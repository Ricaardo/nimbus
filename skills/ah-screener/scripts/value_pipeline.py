#!/usr/bin/env python3
"""
value_pipeline.py — futu 价值粗筛 → ah-screener 深度分（缝合两层）

分层：futu get_stock_filter(实时、零存储)出价值幸存者(几十只) → 在 ah-screener
已算好的 DB(每日全市场打分)里查这些票的深度 expert_score/decision → 取交集排序。
**不重跑 ah 管线**(轻)。两层都点头的票 = futu 估值便宜 + ah 多因子/大师模型也认。

用法：
  python3 value_pipeline.py --market HK --limit 40      # HK 价值粗筛→深算
  python3 value_pipeline.py --market US                 # US(查 us_screener.duckdb)
  python3 value_pipeline.py --market HK --min-roe 12 --max-pe 15   # 自定义粗筛条件
只读，不下单。需 futu OpenD(粗筛) + ah-screener 已跑(深算)。
"""
import argparse
import json
import os
import re
import subprocess
import sys

HOME = os.path.expanduser("~")
_SKILLS = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # 自包含:相对脚本定位 skills 根,不依赖 ~/.claude
FUTU_FILTER = f"{_SKILLS}/futuapi/scripts/quote/get_stock_filter.py"
AH_ROOT = f"{HOME}/nimbus-stack/equity-screener"
AH_DB = f"{AH_ROOT}/data/ah_screener.duckdb"      # HK + A
US_DB = f"{AH_ROOT}/data/us_screener.duckdb"      # US
VENV_PY = f"{AH_ROOT}/.venv/bin/python"


def futu_screen(market, limit, extra):
    """跑 futu 价值粗筛，返回 [(code, name, pe, pb), ...]。"""
    cmd = [sys.executable, FUTU_FILTER, "--market", market, "--limit", str(limit),
           "--json"]
    if not extra.get("custom"):
        cmd += ["--preset", "value"]
    for k in ("min_pe", "max_pe", "min_pb", "max_pb", "min_roe",
              "max_debt_ratio", "min_market_cap", "min_turnover"):
        if extra.get(k) is not None:
            cmd += [f"--{k.replace('_', '-')}", str(extra[k])]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=90).stdout
    except Exception as e:
        print(f"[err] futu 粗筛失败: {e}", file=sys.stderr)
        return []
    m = re.search(r'\{\s*"', out)
    if not m:
        return []
    try:
        d = json.JSONDecoder().raw_decode(out[m.start():])[0]
    except Exception:
        return []
    return [(r.get("code", ""), r.get("name", ""), r.get("pe", 0), r.get("pb", 0))
            for r in d.get("data", [])]


def to_ah_key(code):
    """futu code → (db, ah_market, symbol)。US→us_screener；HK/SH/SZ→ah_screener。"""
    if "." not in code:
        return None
    mkt, sym = code.split(".", 1)
    if mkt == "US":
        return (US_DB, "US", sym)
    if mkt == "HK":
        return (AH_DB, "HK", sym)            # 00700 直配
    if mkt in ("SH", "SZ"):
        return (AH_DB, "A", sym)             # A 股 6 位
    return None


def ah_scores(keys):
    """批量查 ah DB 的最新 expert_score/decision。keys: [(db,market,symbol)]。
    返回 {(db,market,symbol): (score, decision)}。"""
    out = {}
    by_db = {}
    for db, mkt, sym in keys:
        by_db.setdefault(db, []).append((mkt, sym))
    code = """
import duckdb, json, sys
db, pairs = sys.argv[1], json.loads(sys.argv[2])
con = duckdb.connect(db, read_only=True)
res = {}
for mkt, sym in pairs:
    try:
        row = con.execute(
            "SELECT expert_score, decision FROM expert_screening_results "
            "WHERE market=? AND symbol=? ORDER BY updated_at DESC LIMIT 1",
            [mkt, sym]).fetchone()
        if row:
            res[mkt+'|'+sym] = [round(row[0],1) if row[0] is not None else None, row[1]]
    except Exception:
        pass
con.close()
print(json.dumps(res))
"""
    for db, pairs in by_db.items():
        if not os.path.exists(db):
            continue
        try:
            r = subprocess.run([VENV_PY, "-c", code, db, json.dumps(pairs)],
                               capture_output=True, text=True, timeout=60).stdout
            res = json.loads(r.strip().splitlines()[-1]) if r.strip() else {}
            for k, v in res.items():
                mkt, sym = k.split("|", 1)
                out[(db, mkt, sym)] = tuple(v)
        except Exception as e:
            print(f"[warn] 查 {os.path.basename(db)} 失败: {e}", file=sys.stderr)
    return out


def build(market, limit, extra):
    survivors = futu_screen(market, limit, extra)
    if not survivors:
        return None
    keys, meta = [], {}
    for code, name, pe, pb in survivors:
        k = to_ah_key(code)
        if not k:
            continue
        keys.append(k)
        meta[k] = {"code": code, "name": name, "pe": pe, "pb": pb}
    scores = ah_scores(keys)
    rows = []
    for k in keys:
        sc, dec = scores.get(k, (None, "未覆盖"))
        rows.append({**meta[k], "ah_score": sc, "decision": dec})
    # 排序：有深度分的在前、按分降序；未覆盖殿后
    rows.sort(key=lambda r: (r["ah_score"] is None, -(r["ah_score"] or 0)))
    return {"market": market, "futu_survivors": len(survivors), "rows": rows}


DEC_ICON = {"core_candidate": "🟢核心", "watchlist": "🟡观察",
            "reserve": "⚪储备", "reject": "🔴剔除", "未覆盖": "·未覆盖"}


def render(r):
    if r is None:
        return "value_pipeline：futu 粗筛无结果（OpenD 在跑吗？开市时段？）"
    L = [f"# 🔗 价值一条龙 — {r['market']}（futu 粗筛 {r['futu_survivors']} 只 → ah 深算）", ""]
    L.append("| 标的 | futu PE | PB | ah深度分 | ah裁决 |")
    L.append("|---|---|---|---|---|")
    for x in r["rows"]:
        dec = DEC_ICON.get(x["decision"], x["decision"])
        sc = x["ah_score"] if x["ah_score"] is not None else "—"
        L.append(f"| {x['name'][:10]}({x['code']}) | {x['pe']:.1f} | {x['pb']:.2f} | {sc} | {dec} |")
    both = [x for x in r["rows"] if x["decision"] in ("core_candidate", "watchlist")]
    L.append("")
    L.append(f"**两层都点头**（futu便宜 + ah {len(both)} 只核心/观察）："
             + (" · ".join(f"{x['name'][:8]}({x['ah_score']})" for x in both) if both else "无"))
    L.append("> futu 实时价值粗筛 + ah 深度多因子，取交集。只读，不下单。")
    return "\n".join(L)


def main():
    ap = argparse.ArgumentParser(description="futu价值粗筛 → ah深度分 一条龙")
    ap.add_argument("--market", default="HK", choices=["HK", "US", "SH", "SZ"])
    ap.add_argument("--limit", type=int, default=40, help="futu 粗筛返回数(默认40)")
    ap.add_argument("--min-pe", type=float); ap.add_argument("--max-pe", type=float)
    ap.add_argument("--min-pb", type=float); ap.add_argument("--max-pb", type=float)
    ap.add_argument("--min-roe", type=float); ap.add_argument("--max-debt-ratio", type=float)
    ap.add_argument("--min-market-cap", type=float); ap.add_argument("--min-turnover", type=float)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    extra = {k: getattr(args, k) for k in
             ("min_pe", "max_pe", "min_pb", "max_pb", "min_roe",
              "max_debt_ratio", "min_market_cap", "min_turnover")}
    extra["custom"] = any(v is not None for v in extra.values())
    r = build(args.market, args.limit, extra)
    print(json.dumps(r, ensure_ascii=False, indent=2) if args.json else render(r))


if __name__ == "__main__":
    main()
