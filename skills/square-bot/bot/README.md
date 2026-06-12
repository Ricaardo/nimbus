# Binance Square Bot

本目录是 Binance Square 机器人化运营框架。

它的边界很明确：
- Codex/AI 负责：选题、事件推演、文案、图片生成、复盘。
- Binance 官方 Square skill 负责：真实发布。
- 本 bot 负责：队列、风控、调用发布脚本、日志。

## Current Paths

- Bot root: `/Users/x/ops/binance-square-bot`
- Official Square skill: `/Users/x/.claude/skills/binance-square`
- Queue: `/Users/x/ops/binance-square-bot/queue`
- Published records: `/Users/x/ops/binance-square-bot/published`
- Assets: `/Users/x/ops/binance-square-bot/assets`
- SQLite DB: `/Users/x/ops/binance-square-bot/posts.db`

## Workflow

1. AI 生成内容包 JSON。
2. Bot 执行合规检查。
3. 如果有 `image_prompt`，Codex 原生图片生成生成图片文件，保存到 `assets/`，并把图片路径写入 `media_paths`。
4. Bot 根据 `post_type` 调用：
   - text/article: `node scripts/post-text.mjs`
   - image/article cover: `node scripts/post-image.mjs`
   - video: `node scripts/post-video.mjs`
5. 发布结果写入 `published/`。

## Commands

Initialize/check:

```bash
python3 scripts/init_db.py
python3 scripts/square_bot.py doctor
```

Install review tooling:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
```

Collect market context:

```bash
python3 scripts/collect_market_context.py
```

Generate queue drafts:

```bash
python3 scripts/generate_daily_posts.py --slot all
python3 scripts/generate_daily_posts.py --slot morning_map --with-image
```

Prepare Codex image tasks:

```bash
python3 scripts/prepare_image_tasks.py
```

Run one Codex image task:

```bash
scripts/run_image_task_with_codex.sh assets/tasks/<task>.md
```

Attach a generated image:

```bash
python3 scripts/attach_asset.py --draft /path/to/draft.json --asset /path/to/generated.png
```

Create a sample draft:

```bash
python3 scripts/square_bot.py sample --slot morning_map
```

Validate queued drafts:

```bash
python3 scripts/square_bot.py validate
```

Check live operations status:

```bash
python3 scripts/status.py
python3 scripts/status.py --json
```

Run verification:

```bash
python3 -m py_compile scripts/*.py
python3 scripts/test_bot_regressions.py
.venv/bin/python -m bandit -r scripts
plutil -lint launchd/*.plist
```

Publish approved/eligible drafts:

```bash
python3 scripts/approve_draft.py /path/to/draft.json --approved-by your-name
python3 scripts/square_bot.py publish --publish
```

Dry-run publish plan:

```bash
python3 scripts/square_bot.py publish
python3 scripts/publish_due_posts.py
```

One full dry-run cycle:

```bash
python3 scripts/operate_once.py --offline
```

One full live cycle:

```bash
python3 scripts/operate_once.py --publish
```

Record metrics manually:

```bash
python3 scripts/collect_metrics.py set <post-id-or-link> --views 1000 --likes 20 --comments 5 --shares 2
python3 scripts/collect_metrics.py fetch
python3 scripts/collect_metrics.py report
```

## AI Operation Loop

Use Codex to create a JSON package from `prompts/codex_ops_prompt.md`, then save it under `queue/`.

For autonomous mode, run a scheduled Codex command that writes queue JSON, then run:

```bash
/Users/x/ops/binance-square-bot/scripts/run_codex_cycle.sh
python3 /Users/x/ops/binance-square-bot/scripts/square_bot.py publish
```

The second command is dry-run. Use this only after queue validation and policy checks:

```bash
python3 /Users/x/ops/binance-square-bot/scripts/square_bot.py publish --publish
```

Keep `hot_event`, `deep_recap`, S2, and S3 drafts under human review until the account has enough history. The default config only allows `morning_map` S1 posts to autopublish.

## Image Generation

Default mode is `codex_native`:
- Codex creates the `image_prompt`.
- Codex native image generation creates the asset.
- The generated image is saved under `assets/`.
- The image file path is written to `media_paths`.
- Bot publishes it via `post-image.mjs`.

`oma image` is not needed for the primary workflow.

Practical image flow today:

1. Codex writes an English `image_prompt` into the queue JSON.
2. Codex calls native image generation for that prompt.
3. Save the image under `assets/`.
4. Add the absolute image path to `media_paths`.
5. Set `post_type` to `image`.
6. Run `python3 scripts/square_bot.py publish --publish`.

Important: Binance publishing still requires a local image file path. So the queue is only publishable after the Codex-generated image has been saved and `media_paths` points to that saved file.

## launchd Templates

Templates are under `launchd/`.

Dry-run schedule:

```bash
cp /Users/x/ops/binance-square-bot/launchd/com.local.binance-square-bot.generate.plist ~/Library/LaunchAgents/
cp /Users/x/ops/binance-square-bot/launchd/com.local.binance-square-bot.publish-dryrun.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.local.binance-square-bot.generate.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.local.binance-square-bot.publish-dryrun.plist
```

The included generation plist refreshes drafts at 08:55, 12:35, 15:05, 16:35, 19:25, and 22:25 so auto-published posts use fresh market context. The dry-run and live publish plists check six windows: 09:10, 12:40, 15:10, 16:40, 19:30, and 22:30. Live mode uses the same windows and publishes only drafts that pass the slot/risk gates. Each slot also has a maximum publish delay and maximum context age; stale auto-publishable drafts are marked `skip` instead of being posted late or with old market data. Review-gated drafts stay review-gated.

Current daily slots:
- `morning_map`: BTC morning structure map, auto-publish S1.
- `midday_map`: BTC midday checkpoint, auto-publish S1.
- `hot_event`: top mover, announcement, RSS, or GDELT news hotspot scenario draft; review-gated.
- `education_note`: evergreen risk/market-structure education, auto-publish S1.
- `us_open_map`: BTC/ETH pre-US-session risk check, auto-publish S1.
- `deep_recap`: BTC/ETH/BNB recap, review-gated.

Hotspot discovery:
- Binance 24h top movers.
- Binance announcements.
- RSS/Atom feeds configured in `hotspot_discovery.feeds`.
- GDELT news queries configured in `hotspot_discovery.queries`, including cross-border brokerage / overseas stock trading policy topics.
- External macro/regulatory hotspots are forced into review drafts; they are not auto-published.

A live publish template is also provided:

```bash
cp /Users/x/ops/binance-square-bot/launchd/com.local.binance-square-bot.publish-live.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.local.binance-square-bot.publish-live.plist
```

Only install the live template after `python3 scripts/operate_once.py --offline` and `python3 scripts/publish_due_posts.py` have been clean for several days.
