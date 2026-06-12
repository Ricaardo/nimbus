---
name: square-bot
description: Binance Square 运营编排 skill（Claude 当内容大脑，替代已卸载的 codex）。跑广场运营周期——采集行情上下文 → Claude 生成高质量内容包(带证据/数据/情景/风险/失效条件) → bot 风控合规校验+入队 → dry-run 预览 → 经官方 binance-square skill 真实发布。当用户说「运营广场/跑广场bot/生成今日广场内容/广场队列/广场发布周期/广场运营」时触发。项目本体已迁入本 skill 自带 `bot/` 子目录（自包含：队列/风控/DB/调度/launchd，纯 stdlib 无 venv），与官方 binance-square 发布器配套。NOT for：单条手动发帖 → 直接用 binance-square skill；纯写作 → writing-styles。AI 不直接发布，发布走官方 skill。
---

# square-bot — 广场运营编排（Claude 当大脑）

**项目本体在本 skill 自带 `bot/` 子目录**（`~/.claude/skills/square-bot/bot/`，已从 `~/ops`
迁入、自包含、纯 stdlib 无 venv）——广场机器人化运营框架。原本 **Codex 当 AI 大脑**（选题/
文案/推演/图片），现已卸载——**Claude Code 接替当大脑**。分工不变：

```
Claude(大脑): 选题 + 行情推演 + 写文案 + 合规自检
   → bot(基础设施): 队列 / 风控validate / DB / 调度
   → binance-square skill(发布): 真实发帖   ← AI 不直接发
```

## 运营周期（一次完整流程）

```bash
cd ~/.claude/skills/square-bot/bot     # 项目本体(自包含, 纯 stdlib, 用系统/miniforge python 即可)
# 1. 采集行情上下文(Binance ticker 等, 喂给 Claude 写作)
python3 scripts/collect_market_context.py
# 2. ←← Claude 在这一步生成内容包 JSON(见下"内容生成协议"), 写到临时文件 →→
# 3. 校验+入队(风控/合规)
python3 scripts/add_draft.py /tmp/draft.json
# 4. dry-run 预览(不发)
bash scripts/run_publish_cycle.sh dry-run
# 5. 确认后真实发布(经官方 binance-square skill)
bash scripts/run_publish_cycle.sh publish
```
也可一键维护：`python3 scripts/operate_once.py`（不带 --publish 默认 dry-run）。

## 内容生成协议（Claude = 大脑，替代 codex）

Claude 用投资 skill 给内容**找实底**，再用 writing-styles 给**笔法**：
- **选题/数据**：`market-pulse`(MHS/温度) · `market-data`(实时报价) · `news-dashboard`(事件) · `research`(Scenarios 推演)
- **笔法**：`writing-styles`（比奇堡/鲁迅/新青年 三 persona，按调性选）

**内容包 JSON 必填字段**（写到临时文件给 add_draft.py）：
```json
{
  "post_type": "text",            // text / article
  "slot": "midday_map",           // 见 config.json daily_slots
  "risk_level": "S1",             // 合规风险级
  "title": "",                    // article 才需
  "body": "...",                  // 正文(中文)
  "cashtags": ["$BTC"],
  "hashtags": ["#BTC", "#BinanceSquare"],
  "source_notes": ["数据来源: Binance 24h ticker ..."],  // 证据链
  "publish_reason": "...",        // 为何发
  "invalidation": "...",          // 失效条件(必须)
  "compliance_notes": ["不含交易指令。", "含观察/风险/失效条件。"]
}
```
> 运营字段 `status`/`slot_time`/`media_paths`/`image_prompt` **由 add_draft.py 自动补**
> （status 默认 `needs_review`，slot_time 按 slot 算）——Claude 只管写内容。
> ⚠ 合规校验要求正文或 invalidation **字面**含「风险」「失效条件」字样，否则 validate 不过。

## 🔒 合规铁律（bot 风控会拦，Claude 必须自觉遵守）

- ❌ **绝不含交易指令/喊单**（"买/卖/目标价/满仓"）→ 只给观察、数据、情景、风险
- ✅ 必含**证据(source_notes) + 数据 + 失效条件(invalidation)**（呼应记忆 [[feedback_market_posts_need_evidence]]）
- 风险级/slot 自动发布门槛见 `config.json` 的 `risk_policy`/`compliance`/`daily_slots`
- 高风险或 article 默认需人工审批（`approve_draft.py`）

## 图片

Codex 原生图片生成已随卸载消失，Claude 无原生出图。默认走**纯文/article**（`image_prompt`/
`media_paths` 留空）。要配图：手动准备图存 `assets/` 后 `python3 scripts/attach_asset.py`。

## 状态/复盘

```bash
python3 scripts/status.py          # 队列/已发/待发状态
```
复盘结论按惯例写入 Apple Notes（见 [[feedback_apple_notes_conclusions]]）。

## 自动化（launchd，本地）

`bot/launchd/` 下有 generate / publish-dryrun / publish-live 三任务（plist 路径已随迁移
重写为 skill 内路径）。纯 codex 的 `run_codex_cycle.sh` / `run_image_task_with_codex.sh` /
`prompts/codex_ops_prompt.md` 已随迁移剔除——生成改由 Claude 跑本 skill。
> ⚠ 这 3 个 plist 若之前 `launchctl load` 过旧路径，需 `unload 旧的 + load 新的` 才生效
> （默认未加载；纯手动运营不需要）。

> AI 不直接发布；真实发帖一律经官方 `binance-square` skill。只读编排 + 人工确认发布。
