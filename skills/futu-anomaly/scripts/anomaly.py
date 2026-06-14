#!/usr/bin/env python3
"""多维异动一站式 — 合并 资金/技术/衍生品 三维异动(futu OpenD)。
用法: anomaly.py US.NVDA [--dim all|capital|technical|derivatives] [--time-range 7]
默认 all：依次跑三维并合并。需 OpenD 在线。
"""
import argparse, os, subprocess, sys

HERE = os.path.dirname(__file__)
DIMS = {
    "capital":     ("💰 资金异动",   "handle_capital_anomaly.py"),
    "technical":   ("📊 技术异动",   "handle_technical_anomaly.py"),
    "derivatives": ("🎲 衍生品异动", "handle_derivatives_anomaly.py"),
}


def run_dim(name, script, symbol, tr):
    try:
        r = subprocess.run(
            [sys.executable, os.path.join(HERE, script), symbol, "--time-range", str(tr)],
            capture_output=True, text=True, timeout=60)
        out = (r.stdout or "").strip()
        # 滤掉 futu 连接日志行，保留有效输出
        lines = [l for l in out.splitlines() if "open_context_base" not in l and "_init_connect" not in l]
        return "\n".join(lines).strip() or (r.stderr.strip()[:200] if r.stderr else "(无输出)")
    except subprocess.TimeoutExpired:
        return "(超时)"
    except Exception as e:
        return f"(出错: {e})"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("symbol", help="如 US.NVDA / HK.00700")
    ap.add_argument("--dim", default="all", help="all 或逗号分隔: capital,technical,derivatives")
    ap.add_argument("--time-range", type=int, default=7)
    a = ap.parse_args()

    sym = a.symbol
    dims = list(DIMS) if a.dim == "all" else [d.strip() for d in a.dim.split(",") if d.strip() in DIMS]
    print(f"🔎 {sym} 多维异动扫描（futu·近 {a.time_range} 日·非投资建议）\n")
    for d in dims:
        label, script = DIMS[d]
        print(f"## {label}")
        print(run_dim(d, script, sym, a.time_range))
        print()


if __name__ == "__main__":
    main()
