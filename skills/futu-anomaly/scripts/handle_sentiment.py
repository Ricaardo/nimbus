#!/usr/bin/env python3
"""社区情绪异动 — 聚合 Futu 社区讨论与新闻,分类多空输出情绪快照。
用法: handle_sentiment.py US.NVDA [--time-range 7]
委托 futu-news-search 拉原始 feed → 按关键词 + 热度分类 → 输出多空比 + 代表性帖子。
"""
import argparse, json, os, subprocess, sys

HERE = os.path.dirname(__file__)
NEWS_SEARCH = os.path.join(HERE, "..", "..", "futu-news-search", "scripts", "news_search.py")

# ── 情绪关键词 ────────────────────────────────────────────────────────────
BULLISH = {"涨", "突破", "起飞", "买入", "看好", "加仓", "抄底", "利好", "牛", "翻倍",
           "moon", "bullish", "long", "buy", "breakout", "🚀", "📈", "🔥", "增持"}
BEARISH = {"跌", "破位", "崩", "卖出", "看空", "减仓", "割肉", "利空", "熊", "套牢",
           "dump", "bearish", "short", "sell", "crash", "👎", "📉", "💀", "减持"}


def _classify(text: str) -> str:
    bs = sum(1 for w in BULLISH if w.lower() in text.lower())
    br = sum(1 for w in BEARISH if w.lower() in text.lower())
    if bs > br: return "bullish"
    if br > bs: return "bearish"
    return "neutral"


def _fetch_community_posts(symbol: str, tr: int) -> list:
    """从 futu-news-search 拉原始新闻/帖子列表(如有脚本)或返回兜底提示。"""
    try:
        r = subprocess.run(
            [sys.executable, NEWS_SEARCH, symbol], capture_output=True, text=True, timeout=30)
        out = (r.stdout or "").strip()
        if not out:
            return []
        lines = [l.strip() for l in out.splitlines() if l.strip() and not l.startswith("#")]
        return lines
    except FileNotFoundError:
        return []  # news_search.py 不存在 — 调用方给出兜底
    except Exception:
        return []


def _render(sentiments: list, posts: list):
    cnt = Counter(sentiments)
    total = len(sentiments) or 1
    bull_pct = cnt.get("bullish", 0) / total * 100
    bear_pct = cnt.get("bearish", 0) / total * 100
    neutral_pct = cnt.get("neutral", 0) / total * 100

    heat = "🔥 偏多" if bull_pct > 50 else ("🧊 偏空" if bear_pct > 50 else "⚖ 中性")
    print(f"💬 社区情绪 · 近 {total} 条（关键词分类 · 非投资建议）")
    print(f"  🟢看多 {bull_pct:.0f}%  🔴看空 {bear_pct:.0f}%  ⚪中性 {neutral_pct:.0f}%  → {heat}")
    if posts:
        sample = [p[:120] for p in posts[:6]]
        for i, s in enumerate(sample):
            emo = sentiments[i] if i < len(sentiments) else "neutral"
            tag = "🟢" if emo == "bullish" else ("🔴" if emo == "bearish" else "⚪")
            print(f"    {tag} {s}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("symbol", help="如 US.NVDA")
    ap.add_argument("--time-range", type=int, default=7)
    a = ap.parse_args()

    symbol = a.symbol
    posts = _fetch_community_posts(symbol, a.time_range)

    if not posts:
        print(f"💬 社区情绪（{symbol}·近{a.time_range}日）")
        print(f"  futu-news-search 脚本未安装或当前无结果——请直接用 futu-news-search 拉新闻后手动评估情绪方向")
        return

    sentiments = [_classify(p) for p in posts]
    _render(sentiments, posts)


if __name__ == "__main__":
    main()
