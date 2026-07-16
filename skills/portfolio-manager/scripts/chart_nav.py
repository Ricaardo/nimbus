#!/usr/bin/env python3
"""
chart_nav.py -- 净值曲线画图脚本

从 nav_history.jsonl 读取累计净值历史，输出投顾风格净值曲线图到 ~/nimbus/data/outbox/nav.png。
图表自动经 Discord 发到当前对话。

用法:
  python3 skills/portfolio-manager/scripts/chart_nav.py          # 默认 180 天
  python3 skills/portfolio-manager/scripts/chart_nav.py --days 30  # 最近 30 天
  python3 skills/portfolio-manager/scripts/chart_nav.py --full     # 全部历史
"""
import argparse
import datetime as dt
import json
import os
import sys

# -- matplotlib 无头 --
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import matplotlib.dates as mdates

# -- 路径（仿 nav_view.py / portfolio_state.py 的相对定位模式） --
_SKILLS = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
NAV_HISTORY_FILE = os.path.join(_SKILLS, "references", "state", "nav_history.jsonl")
HOME = os.path.expanduser("~")
OUTBOX = os.path.join(HOME, "nimbus", "data", "outbox")
OUTPUT_FILE = os.path.join(OUTBOX, "nav.png")

# -- 内联 rcParams（无 chart_style.mplstyle，嵌入投顾暗色主题） --
STYLE = {
    "figure.facecolor": "#1e1e1e",
    "axes.facecolor": "#1e1e1e",
    "axes.edgecolor": "#444444",
    "axes.labelcolor": "#cccccc",
    "axes.titlecolor": "#ffffff",
    "text.color": "#cccccc",
    "xtick.color": "#999999",
    "ytick.color": "#999999",
    "grid.color": "#3a3a3a",
    "grid.alpha": 0.5,
    "grid.linestyle": "-",
    "figure.dpi": 150,
    "savefig.facecolor": "#1e1e1e",
    "savefig.edgecolor": "#1e1e1e",
    "savefig.bbox": "tight",
    "savefig.pad_inches": 0.25,
    # CJK 字体：macOS 系统自带，优先 Arial Unicode MS（覆盖最广）
    "font.sans-serif": ["Arial Unicode MS", "Hiragino Sans GB", "STHeiti", "DejaVu Sans"],
    "font.family": "sans-serif",
    "axes.unicode_minus": False,
}


# ---------------------------------------------------------------------------
# 数据读取
# ---------------------------------------------------------------------------
def load_nav_history():
    """读 nav_history.jsonl，返回按 ts 升序的 list[dict]。
    格式：{"ts": datetime, "nav": float, …原始键…}。文件不存在/损坏行跳过。"""
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
                    row = json.loads(line)
                    ts = dt.datetime.strptime(row["ts"], "%Y-%m-%d %H:%M")
                    nav = float(row["nav_usd"])
                    entry = {"ts": ts, "nav": nav}
                    # 保留原始字段，供 cash_carried 等检测
                    for k, v in row.items():
                        if k not in ("ts", "nav_usd"):
                            entry[k] = v
                    out.append(entry)
                except (KeyError, ValueError):
                    continue
    except Exception as e:
        print(f"[warn] 读 nav_history 失败: {e}", file=sys.stderr)
        return []
    out.sort(key=lambda x: x["ts"])
    return out


def filter_by_days(history, days):
    """返回最近 N 天的数据点（以最后一条为 now 基准）。"""
    if not history:
        return []
    cutoff = history[-1]["ts"] - dt.timedelta(days=days)
    return [r for r in history if r["ts"] >= cutoff]


# ---------------------------------------------------------------------------
# 辅助检测
# ---------------------------------------------------------------------------
def _any_cash_carried(history):
    """检测历史中是否有 IBKR 现金被 carry-forward 的点。
    优先读显式 cash_carried 标记（未来可能追加），否则从 ibkr_stale+ibkr_cash_usd 推断。"""
    for r in history:
        if r.get("cash_carried"):
            return True
        if r.get("ibkr_stale") and r.get("ibkr_cash_usd") is not None:
            return True
    return False


# ---------------------------------------------------------------------------
# 画图
# ---------------------------------------------------------------------------
def chart(history, full_range=False):
    """绘制净值曲线并保存 PNG。history 为按时间升序的 list[dict]（已排序）。"""
    if len(history) < 3:
        print("数据不足（至少需要 3 个数据点）")
        sys.exit(0)

    plt.rcParams.update(STYLE)

    dates = [r["ts"] for r in history]
    navs = [r["nav"] for r in history]

    first_nav = navs[0]
    last_nav = navs[-1]
    pct_return = (last_nav - first_nav) / first_nav * 100 if first_nav != 0 else 0
    days_count = (dates[-1] - dates[0]).days

    fig, ax = plt.subplots(figsize=(10, 5))

    # -- 主曲线 --
    line_color = "#4fc3f7"
    ax.plot(dates, navs, color=line_color, linewidth=2.5, solid_capstyle="round", zorder=3)

    # -- 渐变填充面积（曲线到纵轴下界） --
    y_pad = max(1.0, (max(navs) - min(navs)) * 0.05)
    y_bottom = min(navs) - y_pad
    ax.fill_between(dates, navs, y_bottom, color=line_color, alpha=0.12, zorder=1)

    # -- 起/终点标记 --
    ax.scatter([dates[0]], [navs[0]], color="#ffb74d", s=45, zorder=4, edgecolors="none")
    ax.scatter([dates[-1]], [navs[-1]], color="#81c784", s=45, zorder=4, edgecolors="none")

    # -- 坐标轴 --
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%m-%d"))
    ax.xaxis.set_major_locator(mdates.AutoDateLocator())
    fig.autofmt_xdate(rotation=0, ha="center")

    ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f"${x:,.0f}"))

    ax.grid(True, which="major", axis="both")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.spines["left"].set_color("#444444")
    ax.spines["bottom"].set_color("#444444")

    # -- 右上角标注卡 --
    annotation_lines = [
        f"最新 NAV   ${last_nav:,.0f}",
        f"区间起点   ${first_nav:,.0f}",
        f"区间回报   {pct_return:+.2f}%",
        f"区间天数   {days_count} 天",
    ]
    text_str = "\n".join(annotation_lines)
    bbox = dict(boxstyle="round,pad=0.5", facecolor="#2a2a2a", edgecolor="#555555", alpha=0.92)
    ax.text(
        0.97, 0.97, text_str,
        transform=ax.transAxes,
        fontsize=8,
        verticalalignment="top",
        horizontalalignment="right",
        color="#e0e0e0",
        bbox=bbox,
    )

    # -- IBKR carry 注记 --
    if _any_cash_carried(history):
        ax.text(
            0.5, -0.10,
            "IBKR 现金部分为 carry-forward 值（连接器未拉取到实时数据）",
            transform=ax.transAxes,
            fontsize=6.5,
            color="#777777",
            ha="center",
            va="top",
        )

    # -- 标题 --
    if full_range:
        title = "NAV 净值曲线（全部历史）"
    else:
        title = f"NAV 净值曲线（最近 {days_count} 天）"
    ax.set_title(title, fontsize=13, fontweight="bold", color="#ffffff", pad=14)

    plt.tight_layout()

    os.makedirs(OUTBOX, exist_ok=True)
    fig.savefig(OUTPUT_FILE, dpi=150)
    plt.close(fig)

    print(f"净值曲线已保存: {OUTPUT_FILE}")
    print(f"数据点: {len(history)} | 最新 NAV: ${last_nav:,.0f} | 区间回报: {pct_return:+.2f}% | 区间天数: {days_count}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description="净值曲线画图（输出到 ~/nimbus/data/outbox/nav.png）")
    ap.add_argument("--days", type=int, default=180, help="最近 N 天（默认 180，被 --full 覆盖）")
    ap.add_argument("--full", action="store_true", help="全部历史（覆盖 --days）")
    args = ap.parse_args()

    history = load_nav_history()

    if not args.full:
        history = filter_by_days(history, args.days)

    chart(history, full_range=args.full)


if __name__ == "__main__":
    main()
