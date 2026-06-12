#!/usr/bin/env python3
"""Generate deterministic Binance Square queue drafts from stored context."""

from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path

from botlib import (
    latest_events,
    latest_snapshot,
    load_config,
    next_slot_time,
    queue_files,
    slot_allows_autopublish,
    upsert_queue_file,
    write_queue_draft,
)


def fmt_price(value: float | None) -> str:
    if value is None:
        return "暂无数据"
    if value >= 100:
        return f"{value:,.0f}"
    if value >= 1:
        return f"{value:,.2f}"
    return f"{value:.6f}"


def snapshot_values(config: dict, symbol: str) -> dict:
    row = latest_snapshot(config, symbol)
    if not row:
        return {"symbol": symbol, "price": None, "change_pct": 0, "high_24h": None, "low_24h": None, "healthy": False}
    healthy = row["price"] is not None and float(row["price"] or 0) > 0
    return {
        "symbol": row["symbol"],
        "price": row["price"],
        "change_pct": row["change_pct"],
        "high_24h": row["high_24h"],
        "low_24h": row["low_24h"],
        "healthy": healthy,
    }


def base_draft(slot: str, post_type: str = "text") -> dict:
    return {
        "status": "draft",
        "risk_level": "S1",
        "slot": slot,
        "slot_time": "",
        "post_type": post_type,
        "title": "",
        "body": "",
        "cashtags": ["$BTC"],
        "hashtags": ["#BTC", "#BTCUSDT", "#BinanceSquare"],
        "image_prompt": "",
        "media_paths": [],
        "source_notes": [],
        "publish_reason": "",
        "invalidation": "",
        "compliance_notes": ["不含交易指令。", "包含观察、风险和失效条件。"],
        "generated_at": "",
    }


def existing_slot_draft(config: dict, draft: dict) -> tuple[Path, dict] | None:
    for path in queue_files(config):
        try:
            queued = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        if queued.get("status") in {"published", "skip"}:
            continue
        if queued.get("slot") == draft.get("slot") and queued.get("slot_time") == draft.get("slot_time"):
            return path, queued
    return None


def refreshable_scheduled_draft(draft: dict, config: dict) -> bool:
    if draft.get("approval"):
        return False
    if draft.get("status") == "draft" and slot_allows_autopublish(draft, config):
        return True
    return draft.get("status") == "needs_review" and bool(draft.get("generated_at"))


def refresh_existing_draft(path: Path, draft: dict, config: dict) -> None:
    path.write_text(json.dumps(draft, ensure_ascii=False, indent=2), encoding="utf-8")
    upsert_queue_file(path, draft, config)


def morning_map(config: dict, with_image: bool) -> dict:
    btc = snapshot_values(config, "BTCUSDT")
    low = fmt_price(btc["low_24h"])
    high = fmt_price(btc["high_24h"])
    price = fmt_price(btc["price"])
    change = float(btc["change_pct"] or 0)
    direction = "偏强" if change > 1 else "偏弱" if change < -1 else "震荡"
    draft = base_draft("morning_map", "image" if with_image else "text")
    draft["slot_time"] = next_slot_time(config, "morning_map")
    draft["body"] = (
        f"BTC 早盘观察：$BTC 现在更像是{direction}结构，不适合只猜涨跌。\n"
        f"1. 当前参考价约 {price}，24h 区间 {low}-{high}。\n"
        f"2. 上方先看能否重新站回区间高位；下方关注低位是否放量失守。\n"
        "3. 如果仍在区间内，风险是把震荡误判成趋势。\n"
        "失效条件：价格放量突破区间并连续站稳，或跌破区间低位后无法快速收回。\n"
        "你今天更担心假突破，还是踏空？#BTC #BTCUSDT #BinanceSquare"
    )
    draft["image_prompt"] = (
        "16:9 editorial crypto market image, calm Bitcoin market map, abstract candlestick range, "
        "subtle support and resistance bands, no exchange logo, no exact price text, professional financial newsletter style"
    )
    draft["source_notes"] = [f"Binance 24h ticker BTCUSDT price={price}, change={change:.2f}%."]
    draft["publish_reason"] = "Daily morning market map."
    draft["invalidation"] = "价格放量突破区间并连续站稳，或跌破区间低位后无法快速收回。"
    if with_image:
        draft["status"] = "needs_asset"
    if not btc["healthy"]:
        draft["status"] = "needs_review"
        draft["data_health"] = {"status": "fallback", "reason": "BTCUSDT price is missing or zero"}
    else:
        draft["data_health"] = {"status": "ok"}
    return draft


def event_score(event) -> int:
    severity_score = {"S0": 0, "S1": 10, "S2": 20, "S3": 30}.get(event["severity"], 0)
    source = str(event["source"])
    title = str(event["title"]).lower()
    score = severity_score
    if "china_cross_border_brokerage" in source:
        score += 40
    elif source.startswith("external_hotspot:gdelt:"):
        score += 30
    elif source.startswith("external_hotspot:"):
        score += 20
    elif source == "binance_announcement":
        score += 10
    elif source == "binance_top_mover":
        score += 5
    if any(keyword in title for keyword in ("regulation", "ban", "sanction", "sec", "禁止", "监管", "跨境", "美股")):
        score += 10
    return score


def select_hot_event(config: dict):
    events = latest_events(config, limit=30)
    if not events:
        return None
    return sorted(events, key=event_score, reverse=True)[0]


def hot_event(config: dict, with_image: bool) -> dict:
    event = select_hot_event(config)
    title = event["title"] if event else "暂无明确热点，先观察 BTC 主线"
    severity = event["severity"] if event else "S0"
    source = event["source"] if event else ""
    url = event["url"] if event else ""
    review_required = severity in {"S2", "S3"} or str(source).startswith("external_hotspot:")
    draft = base_draft("hot_event", "image" if with_image else "text")
    draft["status"] = "needs_review" if review_required else ("needs_asset" if with_image else "draft")
    draft["risk_level"] = severity if severity in {"S0", "S1", "S2", "S3"} else "S1"
    if review_required:
        draft["post_type"] = "text"
    draft["slot_time"] = next_slot_time(config, "hot_event")
    if str(source).startswith("external_hotspot:"):
        draft["body"] = (
            "宏观/监管热点观察草稿，需要先做来源核实。\n"
            f"确认线索：{title}。\n"
            f"来源：{source}{f'，链接：{url}' if url else ''}。\n"
            "影响路径：这类消息通常不是直接影响 $BTC，而是通过跨境资金通道、风险偏好、中概/券商股情绪，再传导到高 beta 风险资产。\n"
            "三情景：1）更多主流或官方来源确认，市场可能交易监管收紧；2）只有单一媒体报道，更像待核实噪音；3）如果风险资产无明显反应，对加密市场影响可能有限。\n"
            "失效条件：官方或多家主流来源无法确认，或 BTC/美股/中概相关资产没有连续反应。\n"
            "这条我会先当风险观察，不当交易结论。#MarketUpdate $BTC"
        )
    else:
        draft["body"] = (
            f"今天的热点观察不是标题本身，而是它会不会改变资金路径。\n"
            f"确认事实：{title}。\n"
            f"来源线索：{source or '本地行情事件'}{f'，链接：{url}' if url else ''}。\n"
            "影响路径：先看 BTC 风险偏好，再看热门币是否有独立成交延续。\n"
            "三情景：1）放量延续，说明热度可能扩散；2）只有单币异动，更像局部噪音；3）BTC 同步转弱，热点容易快速回吐。\n"
            "失效条件：24h 后热度和成交不能延续。\n"
            "你觉得这更像新叙事，还是短线轮动？#MarketUpdate $BTC"
        )
    draft["image_prompt"] = (
        "16:9 crypto news analysis image, abstract flow of capital between Bitcoin and trending altcoins, "
        "clean editorial design, no logos, no hype wording, professional market analysis mood"
    )
    draft["source_notes"] = [f"Latest event source={source} severity={severity} url={url}." if event else "No stored event; fallback post."]
    draft["publish_reason"] = "Hot event scenario analysis."
    draft["invalidation"] = "24h 后热度和成交不能延续。"
    btc = snapshot_values(config, "BTCUSDT")
    if not btc["healthy"]:
        draft["status"] = "needs_review"
        draft["data_health"] = {"status": "fallback", "reason": "BTCUSDT price is missing or zero"}
    else:
        draft["data_health"] = {"status": "ok"}
    return draft


def education_note(config: dict, with_image: bool) -> dict:
    topics = [
        {
            "title": "支撑位不是买入指令",
            "body": (
                "新手教育观察：支撑位不是买入指令，它只是市场曾经出现承接的位置。\n"
                "1. 真正要看的不是价格触到支撑，而是触到后有没有成交和快速收回。\n"
                "2. 如果 BTC 同时放量跌破，支撑位可能从参考变成压力。\n"
                "3. 风险是把一个静态数字当成确定答案。\n"
                "失效条件：价格跌破支撑后连续收不回，说明原来的观察位失效。\n"
                "你平时更容易提前抄底，还是等确认太久？#BTC #CryptoEducation"
            ),
        },
        {
            "title": "假突破为什么常见",
            "body": (
                "交易结构观察：假突破常见，不是因为图形骗人，而是流动性会集中在明显位置。\n"
                "1. 越多人盯同一个高点，突破瞬间越容易触发追单和止损。\n"
                "2. 如果突破后没有继续放量，风险是价格重新回到区间。\n"
                "3. 判断突破质量，要看后续站稳时间，不只看第一根 K 线。\n"
                "失效条件：价格回到区间内且无法再次站上突破位。\n"
                "你更怕假突破，还是怕错过真突破？#BTC #TradingPsychology"
            ),
        },
        {
            "title": "强弱关系比单币涨跌更有用",
            "body": (
                "市场观察小框架：单币涨跌只能说明结果，强弱关系更能说明资金偏好。\n"
                "1. 如果 BTC 稳而 ETH/BNB 补涨，说明风险偏好可能扩散。\n"
                "2. 如果 BTC 转弱而小币还在冲，风险是尾部轮动接近尾声。\n"
                "3. 强弱不是交易指令，只是观察资金从主线到分支的路径。\n"
                "失效条件：主线资产放量转弱，分支资产也同步失去承接。\n"
                "你现在更看主线资产，还是看轮动机会？#BTC #ETH #BNB"
            ),
        },
        {
            "title": "热点不是立刻追的理由",
            "body": (
                "热点观察：一个币突然热，不等于现在就值得追。\n"
                "1. 先看热度来源：成交、公告、解锁、空投，还是单纯拉盘。\n"
                "2. 再看它和 BTC 的关系：独立走强，还是只是高 beta 跟涨。\n"
                "3. 风险是热度只持续一小时，等你看到时已经进入回吐阶段。\n"
                "失效条件：24h 后成交和讨论度都不能延续。\n"
                "你判断热点时最先看涨幅，还是成交量？#Crypto #MarketUpdate"
            ),
        },
    ]
    topic = topics[datetime.now().toordinal() % len(topics)]
    draft = base_draft("education_note", "text")
    draft["slot_time"] = next_slot_time(config, "education_note")
    draft["title"] = topic["title"]
    draft["body"] = topic["body"]
    draft["cashtags"] = ["$BTC"]
    draft["hashtags"] = ["#BTC", "#CryptoEducation", "#BinanceSquare"]
    draft["source_notes"] = ["Evergreen education note generated from local risk-management templates."]
    draft["publish_reason"] = "Low-risk evergreen education content."
    draft["invalidation"] = "教育框架不适用于极端行情和重大突发新闻，需要结合实时风险环境。"
    draft["data_health"] = {"status": "ok"}
    return draft


def midday_map(config: dict, with_image: bool) -> dict:
    btc = snapshot_values(config, "BTCUSDT")
    low = fmt_price(btc["low_24h"])
    high = fmt_price(btc["high_24h"])
    price = fmt_price(btc["price"])
    change = float(btc["change_pct"] or 0)
    tone = "偏强修复" if change > 1 else "偏弱回踩" if change < -1 else "区间震荡"
    draft = base_draft("midday_map", "image" if with_image else "text")
    draft["slot_time"] = next_slot_time(config, "midday_map")
    draft["body"] = (
        f"BTC 午盘快检：$BTC 当前约 {price}，24h 变化 {change:.2f}%，节奏更接近{tone}。\n"
        f"1. 早盘之后先看是否还在 {low}-{high} 的 24h 区间内。\n"
        "2. 如果反弹没有成交量配合，风险是冲高后继续回到区间。\n"
        "3. 如果回踩低位但快速收回，说明空头延续性不足。\n"
        "失效条件：价格放量脱离 24h 区间，并在下一小时仍不能回到区间内。\n"
        "午盘观察只看结构，不把一根 K 线当结论。你现在更像观望，还是等确认？#BTC #BTCUSDT"
    )
    draft["image_prompt"] = (
        "16:9 editorial crypto intraday checkpoint image, Bitcoin candlestick range, "
        "clean support and resistance visualization, no logo, no exact price text"
    )
    draft["source_notes"] = [f"Binance 24h ticker BTCUSDT price={price}, change={change:.2f}%."]
    draft["publish_reason"] = "Midday low-risk BTC structure check."
    draft["invalidation"] = "价格放量脱离 24h 区间，并在下一小时仍不能回到区间内。"
    if with_image:
        draft["status"] = "needs_asset"
    if not btc["healthy"]:
        draft["status"] = "needs_review"
        draft["data_health"] = {"status": "fallback", "reason": "BTCUSDT price is missing or zero"}
    else:
        draft["data_health"] = {"status": "ok"}
    return draft


def us_open_map(config: dict, with_image: bool) -> dict:
    btc = snapshot_values(config, "BTCUSDT")
    eth = snapshot_values(config, "ETHUSDT")
    price = fmt_price(btc["price"])
    btc_change = float(btc["change_pct"] or 0)
    eth_change = float(eth["change_pct"] or 0)
    spread = eth_change - btc_change
    relation = "ETH 相对更强" if spread > 0.5 else "BTC 相对更稳" if spread < -0.5 else "BTC/ETH 强弱接近"
    draft = base_draft("us_open_map", "image" if with_image else "text")
    draft["slot_time"] = next_slot_time(config, "us_open_map")
    draft["body"] = (
        f"美盘前观察和风险检查：$BTC 约 {price}，24h 变化 {btc_change:.2f}%；$ETH 变化 {eth_change:.2f}%，目前是{relation}。\n"
        "1. 美盘前最怕的不是方向错，而是流动性放大假突破。\n"
        "2. 如果 BTC 稳住、ETH 跟随，风险偏好可能扩散。\n"
        "3. 如果 BTC 转弱但小币继续冲，反而要防尾部轮动。\n"
        "失效条件：BTC 跌破 24h 低位后无法快速收回，或 ETH/BTC 强弱突然反转。\n"
        "今晚你更关注主线资产，还是高波动轮动？#MarketUpdate $BTC $ETH"
    )
    draft["cashtags"] = ["$BTC", "$ETH"]
    draft["hashtags"] = ["#MarketUpdate", "#BTC", "#ETH", "#BinanceSquare"]
    draft["image_prompt"] = (
        "16:9 crypto US session risk check visual, Bitcoin and Ethereum comparative market structure, "
        "subtle volatility bands, professional financial newsletter style, no logo"
    )
    draft["source_notes"] = [
        f"Binance 24h ticker BTCUSDT price={price}, change={btc_change:.2f}%.",
        f"Binance 24h ticker ETHUSDT change={eth_change:.2f}%.",
    ]
    draft["publish_reason"] = "Pre-US-session low-risk BTC/ETH structure check."
    draft["invalidation"] = "BTC 跌破 24h 低位后无法快速收回，或 ETH/BTC 强弱突然反转。"
    if with_image:
        draft["status"] = "needs_asset"
    if not (btc["healthy"] and eth["healthy"]):
        draft["status"] = "needs_review"
        draft["data_health"] = {"status": "fallback", "reason": "BTCUSDT or ETHUSDT price is missing or zero"}
    else:
        draft["data_health"] = {"status": "ok"}
    return draft


def deep_recap(config: dict, with_image: bool) -> dict:
    btc = snapshot_values(config, "BTCUSDT")
    eth = snapshot_values(config, "ETHUSDT")
    bnb = snapshot_values(config, "BNBUSDT")
    draft = base_draft("deep_recap", "article" if not with_image else "image")
    draft["status"] = "needs_review" if not with_image else "needs_asset"
    draft["slot_time"] = next_slot_time(config, "deep_recap")
    draft["title"] = "今日加密市场复盘：先看结构，再谈方向"
    draft["body"] = (
        "今日复盘先不下结论，只做结构观察。\n\n"
        f"1. $BTC 当前约 {fmt_price(btc['price'])}，24h 变化 {float(btc['change_pct'] or 0):.2f}%。\n"
        f"2. $ETH 变化 {float(eth['change_pct'] or 0):.2f}%，$BNB 变化 {float(bnb['change_pct'] or 0):.2f}%。\n"
        "3. 如果 BTC 稳住而 ETH/BNB 补涨，说明风险偏好可能扩散；如果 BTC 走弱而热点币还在冲，反而要警惕尾部轮动。\n\n"
        "风险：复盘不是预测，真正重要的是明天哪些条件会推翻今天的判断。\n"
        "失效条件：BTC 跌破 24h 区间低位且无法快速收回。\n"
        "你更关注主线资产，还是热门轮动？#MarketRecap $BTC $ETH $BNB"
    )
    draft["cashtags"] = ["$BTC", "$ETH", "$BNB"]
    draft["hashtags"] = ["#MarketRecap", "#BTC", "#ETH", "#BNB"]
    draft["image_prompt"] = (
        "16:9 weekly crypto market recap visual, Bitcoin Ethereum BNB abstract comparative dashboard, "
        "clean charts, neutral dark background, no exact numbers, no exchange logo"
    )
    draft["source_notes"] = ["Binance 24h ticker snapshots for BTCUSDT, ETHUSDT, BNBUSDT."]
    draft["publish_reason"] = "Daily deep recap draft for review."
    draft["invalidation"] = "BTC 跌破 24h 区间低位且无法快速收回。"
    if not (btc["healthy"] and eth["healthy"] and bnb["healthy"]):
        draft["status"] = "needs_review"
        draft["data_health"] = {"status": "fallback", "reason": "one or more watch prices are missing or zero"}
    else:
        draft["data_health"] = {"status": "ok"}
    return draft


FACTORIES = {
    "morning_map": morning_map,
    "midday_map": midday_map,
    "hot_event": hot_event,
    "education_note": education_note,
    "us_open_map": us_open_map,
    "deep_recap": deep_recap,
}


def selected_slots(value: str, config: dict) -> list[str]:
    if value == "all":
        return [slot["slot"] for slot in config["daily_slots"]]
    return [value]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--slot", choices=[*FACTORIES.keys(), "all"], default="all")
    parser.add_argument("--with-image", action="store_true", help="Generate image-ready drafts with image_prompt and status=needs_asset.")
    parser.add_argument(
        "--refresh-autodrafts",
        action="store_true",
        help="Overwrite existing auto-publishable draft for the same slot_time with fresh market context.",
    )
    args = parser.parse_args()

    config = load_config()
    slots = selected_slots(args.slot, config)
    unsupported = [slot for slot in slots if slot not in FACTORIES]
    if unsupported:
        parser.error(f"unsupported slot(s) in config: {', '.join(unsupported)}")
    for slot in slots:
        draft = FACTORIES[slot](config, args.with_image)
        draft["generated_at"] = datetime.now().isoformat(timespec="seconds")
        existing = existing_slot_draft(config, draft)
        if existing:
            existing_path, existing_draft = existing
            if args.refresh_autodrafts and refreshable_scheduled_draft(existing_draft, config):
                refresh_existing_draft(existing_path, draft, config)
                print(f"REFRESH {existing_path}")
                continue
            print(f"SKIP existing {existing_path}")
            continue
        path = write_queue_draft(draft, config, prefix=slot)
        print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
