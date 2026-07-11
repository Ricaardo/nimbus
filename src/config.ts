import { readFileSync, chmodSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

// ── Nimbus workspace / data paths ─────────────────────────────────────────────
export const PROJECT_ROOT = '/Users/x/nimbus-os/nimbus'
export const WORKSPACE = join(PROJECT_ROOT, 'workspace')
export const DATA_DIR = join(PROJECT_ROOT, 'data')
/** SQLite state database path.  Override via NIMBUS_DB_PATH for independent
 *  instances (e.g. the DeepSeek/微信 instance must not share Cici's state.db). */
export const DB_PATH = process.env.NIMBUS_DB_PATH ?? join(DATA_DIR, 'state.db')
export const LOG_DIR = join(PROJECT_ROOT, 'logs')
/** Agent drops charts/files here; dispatcher auto-sends them to the chat.
 *  Override via NIMBUS_OUTBOX_DIR to give independent instances isolated outboxes. */
export const OUTBOX_DIR = process.env.NIMBUS_OUTBOX_DIR ?? join(DATA_DIR, 'outbox')
/** Vendored 投资 skill 根（自包含，不依赖 ~/.claude/skills）。 */
export const SKILLS_ROOT = join(PROJECT_ROOT, 'skills')
/** 运行态 state 根（portfolio_state / ibkr_positions / 缓存）。 */
export const STATE_ROOT = join(SKILLS_ROOT, 'references', 'state')

// ── Discord / channel config ──────────────────────────────────────────────────
export const REPORT_DM = '1484554871800725624'

// ── 微信入站端点 (wechat-io) ─────────────────────────────────────────────────
export const WEIXIN_INBOUND_PORT = Number(process.env.WEIXIN_INBOUND_PORT ?? 8788)

// Phase 3 DeepSeek/微信:wechat-io 经 OpenAI 兼容口 (POST /v1/chat/completions) 入站。
// 默认关闭(Cici 不起此端点);DeepSeek 第二实例设 WEIXIN_INBOUND=1 开启。
export const WEIXIN_INBOUND_ENABLED = (process.env.WEIXIN_INBOUND ?? '0') === '1'
export const WEIXIN_INBOUND_HOST = process.env.WEIXIN_INBOUND_HOST ?? '127.0.0.1'
// 可选 Bearer 令牌:置空(默认)时仅靠 localhost 绑定保护;设置后强校验 Authorization。
export const WEIXIN_INBOUND_TOKEN = process.env.WEIXIN_INBOUND_TOKEN ?? ''

// ── Local API channel (Hermes / wechat-io bridge) ─────────────────────────────
// 本地 HTTP bridge:POST /chat → dispatcher → 等待首个回复。绑定 localhost。
// 端口占用时只记录 warning,不阻断 Discord 主 daemon。
export const API_CHANNEL_ENABLED = (process.env.NIMBUS_API_ENABLED ?? '1') !== '0'
export const API_CHANNEL_HOST = process.env.NIMBUS_API_HOST ?? '127.0.0.1'
export const API_CHANNEL_PORT = Number(process.env.NIMBUS_API_PORT ?? 8766)
export const API_CHANNEL_TOKEN = process.env.NIMBUS_API_TOKEN ?? ''

// Discord 主渠道开关。默认开(Cici 不受影响)。DeepSeek/微信第二实例设
// NIMBUS_DISCORD_ENABLED=0,即可在无 Discord token 下启动,不抢占第二个 bot 连接。
export const DISCORD_ENABLED = (process.env.NIMBUS_DISCORD_ENABLED ?? '1') !== '0'

// ── 主人身份(隐私隔离:只有本人能看持仓/资金/记忆) ──────────────────────────
// 非本人(即便进了白名单/群@)→ 不注入持仓画像/记忆、不存记忆、禁查账户工具、
// 强护栏禁透露持仓/资金/密钥。Discord 的主人 id。
export const OWNER_IDS: string[] = (process.env.NIMBUS_OWNER_IDS ?? '1086665220723855560')
  .split(',').map(s => s.trim()).filter(Boolean)

// ── Paper trading(长桥模拟盘:AI 可下单;真实账户永远 deny) ────────────────────
// 长桥 OpenAPI 无"模拟/真实"程序标识 → 用【指纹锁】:真实账户必有真实入金
// (deposits)+ 绑定提现银行卡(bank_cards)才能交易;两者都空 = 模拟账户特征。
// 下单前验证两者为空才放行;任一非空(=真实账户)→ 拒绝 + 告警。
// ★默认 OFF。主人审阅安全闸后 env NIMBUS_PAPER_TRADING=1 显式开启。
export const PAPER_TRADING = process.env.NIMBUS_PAPER_TRADING === '1'
/** 单笔模拟单上限(USD,指纹失效时的兜底)。 */
export const PAPER_MAX_ORDER_USD = Number(process.env.NIMBUS_PAPER_MAX_USD ?? '20000')

// ── MCP whitelist (Phase 0-1 成本优化) ───────────────────────────────────────
/**
 * 默认挂载的 MCP server 白名单(普通对话/报告用)。
 * longbridge/cmc/futu-stock 默认不挂:
 *   - longbridge: skills 走 python,仅 paper 模块需要(定向 ['longbridge'])
 *   - cmc/futu-stock: 无常规对话需要
 * 省每次调用 ~50-70K token 工具定义。
 */
export const MCP_DEFAULT_ALLOW = ['tavily', 'alpaca'] as const

// ── Usage / budget (Phase 1 省额度 / Phase 3 硬预算闸) ───────────────────────
/**
 * Daily cost budget tiers (USD):
 *   level 0 — normal:      cost < DAILY_COST_BUDGET_USD * BUDGET_L1_RATIO
 *   level 1 — downgrade:   cost >= DAILY_COST_BUDGET_USD * BUDGET_L1_RATIO
 *               opus→sonnet, sonnet→haiku (still runs, lighter model)
 *   level 2 — pause deep:  cost >= DAILY_COST_BUDGET_USD
 *               opus/sonnet blocked; haiku/quote unaffected
 * Red-line alerts (dispatchEvent/runCron) are NEVER subject to this gate.
 * L0 quote fast-path is also NEVER affected (handled before gate runs).
 */
/** Advisory daily cost budget (USD). Level 2 (深度暂停) threshold. */
export const DAILY_COST_BUDGET_USD = 5

/** Level 1 (降档) ratio: cost >= budget * this → downgrade tier. Default 0.8. */
export const BUDGET_L1_RATIO = Number(process.env.NIMBUS_BUDGET_L1_RATIO ?? '0.8')

/** Whether the budget degrade gate is enabled. Set NIMBUS_BUDGET_DEGRADE=false to disable. */
export const BUDGET_DEGRADE_ENABLED = process.env.NIMBUS_BUDGET_DEGRADE !== 'false'

// ── Portfolio state ───────────────────────────────────────────────────────────
export const PORTFOLIO_STATE_PATH = join(STATE_ROOT, 'portfolio_state.json')

// ── Safety / trade guard ──────────────────────────────────────────────────────
/** Leverage-ETF ban end date (ISO date, exclusive — i.e., ban lifts after this day). */
export const LEVERAGE_BAN_UNTIL = '2026-07-06'

// ── Model tiers (动态发现,别写死版本号) ──────────────────────────────────────
// SDK 的 supportedModels() 返回滚动别名(haiku/sonnet/opus),新版发布自动跟随。
// 启动时 model-registry 用它解析每档;解析不到才退到这些 fallback。
// fallback 用**标准上下文全名**(订阅内免费),不用会解析成付费 [1m] 变体的别名。
// models.ts 优先用 supportedModels 里的裸别名(自动最新);只有该档没有免费标准
// 别名(如本账户 sonnet 只有 sonnet[1m] 付费版)时,才退到这些标准全名。
export const HAIKU_MODEL = 'claude-haiku-4-5'
export const SONNET_MODEL = 'claude-sonnet-4-6'
export const OPUS_MODEL = 'claude-opus-4-8'

// ── Scheduler / report config ─────────────────────────────────────────────────
/** Model for routine scheduled reports — Sonnet for cost (P0 省额度).
 *  早间/盘前/收盘日报用 Sonnet;真要深度周报再单独传 OPUS_MODEL。 */
export const REPORT_MODEL = SONNET_MODEL

// ── OpenD / futu quote config (M7 L0 fast path) ──────────────────────────────
/** futu OpenD daemon host. */
export const OPEND_HOST = '127.0.0.1'

/** futu OpenD daemon port. */
export const OPEND_PORT = 11111

/** Absolute path to futu get_snapshot.py script. */
export const FUTU_SNAPSHOT_SCRIPT = join(SKILLS_ROOT, 'futuapi/scripts/quote/get_snapshot.py')

/** Absolute path to yfinance fallback quote script. */
export const MARKET_DATA_QUOTE_SCRIPT = join(SKILLS_ROOT, 'market-data/scripts/quote.py')

/** Timeout for L0 quote subprocess calls (ms). */
export const QUOTE_TIMEOUT_MS = 10_000

/** Python interpreter that has the `futu` package installed (conda/miniforge).
 *  The daemon's restricted PATH otherwise resolves python3 to homebrew python
 *  which lacks futu → L0 quotes fail. Override via NIMBUS_PYTHON env. */
export const PYTHON_BIN = process.env.NIMBUS_PYTHON ?? `${homedir()}/miniforge3/bin/python3`

/** 知识层 (RAG) sidecar — scripts/kb-server.py(fastembed + sqlite-vec)。
 *  弱依赖:挂了 recall 优雅返回空,bot 照常运转。 */
export const KB_BASE_URL = process.env.NIMBUS_KB_URL ?? 'http://127.0.0.1:6901'
export const KB_DB_PATH = join(DATA_DIR, 'knowledge.db')

/** Asia/Shanghai cron schedules for the three daily report jobs. */
export const MORNING_CRON = '0 8 * * *'    // 08:00 CST — morning check
export const PREMARKET_CRON = '0 21 * * *'  // 21:00 CST — US pre-market (day before)
export const CLOSE_CRON = '0 6 * * *'       // 06:00 CST — US market close recap
/** Portfolio refresh (拉 futu+IBKR 写 state) — 07:30 & 20:30 CST,赶在早间/盘前报告前。 */
export const REFRESH_CRON = '30 7,20 * * *'
/** 机会扫描(进攻自动化)— 工作日 09:00 CST,早间体检后主动找赚钱机会。 */
export const OPPORTUNITY_CRON = '0 9 * * 1-5'
/** 周反思(自进化)— 周日 21:00 CST,从真实交易数据学教训写进记忆。 */
export const REFLECTION_CRON = '0 21 * * 0'
/** 成本周报 — 周一 08:30 CST,汇总上周各模型用量/成本/缓存命中。 */
export const COST_REPORT_CRON = '30 8 * * 1'
/** 决策自动结算(可问责闭环)— 07:45 & 20:45 CST,紧跟持仓刷新之后跑。 */
export const DECISION_TRACK_CRON = process.env.DECISION_TRACK_CRON ?? '45 7,20 * * *'
/** 无目标/止损位的建议,持仓超过这么多天后按盈亏方向自动结算(天)。非法 env 值兜底 30。 */
const _decisionAutoCloseDaysEnv = parseInt(process.env.DECISION_AUTO_CLOSE_DAYS ?? '30', 10)
export const DECISION_AUTO_CLOSE_DAYS = Number.isFinite(_decisionAutoCloseDaysEnv) ? _decisionAutoCloseDaysEnv : 30

/** 披露追踪(Tier 4):每周一 07:00 CST,追踪持仓/观察名单的财报+SEC 文件 → 入知识库。 */
export const DISCLOSURE_CRON = '0 7 * * 1'
/** 健康自愈检查 — 每 20 分钟,异常才推(冷却内静默)。 */
export const HEALTH_CRON = '*/20 * * * *'
/** IBKR positions cache file (agent writes via connector; portfolio_state.py reads it). */
export const IBKR_POSITIONS_FILE = join(STATE_ROOT, 'ibkr_positions.json')
/** L1 portfolio_state.py generator (pulls futu + reads ibkr_positions.json → writes state). */
export const PORTFOLIO_STATE_GEN = join(SKILLS_ROOT, 'portfolio-manager/scripts/portfolio_state.py')

// ── Alert / EventSource config ────────────────────────────────────────────────
/** How often the EventSource polls detectors (ms). */
export const EVENT_INTERVAL_MS = 15 * 60_000

/** Minimum gap between re-firing the same alert key (ms). Default 6 hours. */
export const COOLDOWN_TTL_MS = 6 * 3600_000

/** Maximum soft alerts dispatched per day (stop_hit is exempt). */
export const ALERT_DAILY_CAP = 6

/** Quiet hours in Asia/Shanghai: suppress soft alerts from start to end (exclusive). */
export const QUIET_HOURS = { start: 23, end: 7 } as const

/** Single-position concentration breach threshold (weight_pct is already in %). */
export const SINGLE_CONC_PCT = 25

/** Unrealized-gain nudge threshold (%). A position up ≥ this (on fresh price)
 *  triggers a "consider locking profit / trail the stop" gain_alert. */
export const GAIN_ALERT_PCT = 30

/** Portfolio peak-to-current NAV drawdown alert threshold (%). */
export const DRAWDOWN_PCT = 10

/** Gain alerts re-fire far less often than risk alerts — a standing winner
 *  should nudge at most ~weekly per gain band, not every cooldown window. */
export const GAIN_COOLDOWN_MS = 7 * 24 * 3600_000

/** Semiconductor bucket concentration breach threshold (%). */
export const SEMIS_CONC_PCT = 40

/** Thesis verdict strings considered as decaying / broken. */
export const DECAY_VERDICTS: readonly string[] = [
  'decaying', 'broken', 'thesis_broken', 'decay', 'impaired', 'failed',
]

/** Disclaimer appended to investment-related AI responses. */
export const DISCLAIMER = '以上为 AI 辅助分析，非投资建议；AI 不下单，请自行决策与执行。'

/** Grace period after startup before the first alert tick fires (ms). */
export const STARTUP_GRACE = 60_000

// ── Streaming / incremental edit config ──────────────────────────────────────
/** Minimum ms between streaming edit-updates to the Discord placeholder. */
export const STREAM_EDIT_INTERVAL_MS = 1500

/** Minimum new characters accumulated before a streaming edit is issued. */
export const STREAM_EDIT_MIN_CHARS = 60

// ── Discord state dir ─────────────────────────────────────────────────────────
export const STATE_DIR = process.env.DISCORD_STATE_DIR ?? join(PROJECT_ROOT, 'secrets', 'discord')
export const ACCESS_FILE = join(STATE_DIR, 'access.json')
export const ENV_FILE = join(STATE_DIR, '.env')
export const INBOX_DIR = join(STATE_DIR, 'inbox')

// Load ~/.claude/channels/discord/.env into process.env. Real env wins.
// Plugin-spawned servers don't get an env block — this is where the token lives.
try {
  // Token is a credential — lock to owner. No-op on Windows (would need ACLs).
  chmodSync(ENV_FILE, 0o600)
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = line.match(/^(\w+)=(.*)$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
  }
} catch {}

export const TOKEN = process.env.DISCORD_BOT_TOKEN
export const PROXY_URL = process.env.PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY

// Only enforce when Discord is the active channel. The DeepSeek/微信 instance
// runs with NIMBUS_DISCORD_ENABLED=0 and legitimately has no Discord token.
if (DISCORD_ENABLED && !TOKEN) {
  process.stderr.write(
    `discord channel: DISCORD_BOT_TOKEN required\n` +
    `  set in ${ENV_FILE}\n` +
    `  format: DISCORD_BOT_TOKEN=MTIz...\n`,
  )
  process.exit(1)
}
