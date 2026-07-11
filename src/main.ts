// ── main.ts — first line must import proxy to ensure WebSocket override runs
// before any discord.js import occurs anywhere in the module graph.
import './channels/discord/proxy.js'

import { mkdirSync } from 'fs'
import { DiscordChannel } from './channels/discord/index.js'
import { ApiChannel } from './channels/api.js'
import { WeixinInboundChannel } from './channels/weixin-inbound.js'
import { Dispatcher } from './core/dispatcher.js'
import { SimpleRegistry } from './core/registry.js'
import { agentRunner, assertSubscriptionMode, setUsageLogger } from './core/agent.js'
import { refreshModels } from './core/models.js'
import { memory, setMemoryStore } from './core/memory.js'
import { safety } from './core/safety.js'
import { WORKSPACE, DATA_DIR, DAILY_COST_BUDGET_USD, WEIXIN_INBOUND_ENABLED, API_CHANNEL_ENABLED, DISCORD_ENABLED } from './config.js'
import { defaultDb, closeDb } from './core/db.js'
import { getProvider } from './core/provider.js'
import { Scheduler } from './core/scheduler.js'
import { reportModules } from './modules/reports/index.js'
import { portfolioRefreshModules } from './modules/portfolio-refresh/index.js'
import { opportunityModules } from './modules/opportunity/index.js'
import { reflectionModules } from './modules/reflection/index.js'
import { disclosureTrackerModules } from './modules/disclosure-tracker/index.js'
import { decisionTrackerModules } from './modules/decision-tracker/index.js'
import { costReportModules } from './modules/ops/cost-report.js'
import { healthModules } from './modules/ops/health.js'
import { paperModules } from './modules/paper/index.js'
import { alertModules } from './modules/alerts/index.js'
import { EventSource } from './core/eventsource.js'
import { defaultDetectors } from './modules/alerts/detectors.js'
import { fetchPriceMap } from './modules/quote/index.js'
import { PermissionBroker } from './core/permission.js'

// Last-resort safety net
process.on('unhandledRejection', err => {
  process.stderr.write(`nimbus: unhandled rejection: ${err}\n`)
})
process.on('uncaughtException', err => {
  process.stderr.write(`nimbus: uncaught exception: ${err}\n`)
})

// ── Workspace + data directories ─────────────────────────────────────────────
mkdirSync(WORKSPACE, { recursive: true })
mkdirSync(DATA_DIR, { recursive: true })

// ── Subscription mode guard ───────────────────────────────────────────────────
assertSubscriptionMode()

// 动态模型发现:启动时解析每档到最新可用别名,然后每 24h 刷新一次(跟随新发布)。
void refreshModels()
setInterval(() => { void refreshModels() }, 24 * 3600_000).unref()

// ── Database ──────────────────────────────────────────────────────────────────
const db = defaultDb()

// ── Usage tracking (Phase 1 省额度可见性) ─────────────────────────────────────
// Every agent run logs cost/tokens; advisory warning when over daily budget.
// Wire persistent memory store (Phase 2) — buildContext now includes learned prefs.
setMemoryStore(db)

setUsageLogger(u => {
  db.logUsage(u)
  const today = db.getTodayCost()
  if (today > DAILY_COST_BUDGET_USD) {
    process.stderr.write(
      `nimbus: ⚠️ 今日成本 $${today.toFixed(2)} 超预算 $${DAILY_COST_BUDGET_USD}（最近一条 ${u.model} $${u.costUsd.toFixed(3)}）\n`,
    )
  }
})

// ── Assemble ──────────────────────────────────────────────────────────────────

const registry = new SimpleRegistry()

// Discord 主渠道。默认开;NIMBUS_DISCORD_ENABLED=0 时(DeepSeek/微信实例)不构造、
// 不注册,避免无 token 启动崩溃,也不抢占第二个 bot 连接。
let discordChannel: DiscordChannel | undefined
if (DISCORD_ENABLED) {
  discordChannel = new DiscordChannel()
  registry.register(discordChannel)
}

let apiChannel: ApiChannel | undefined
if (API_CHANNEL_ENABLED) {
  apiChannel = new ApiChannel()
  registry.register(apiChannel)
}

// Phase 3:wechat-io 经 OpenAI 兼容口入站(/v1/chat/completions)。DeepSeek 实例开。
let weixinInboundChannel: WeixinInboundChannel | undefined
if (WEIXIN_INBOUND_ENABLED) {
  weixinInboundChannel = new WeixinInboundChannel()
  registry.register(weixinInboundChannel)
}

const channels = registry

// All modules: reports + refresh + opportunity + reflection + ops + alert handlers
const allModules = [...paperModules, ...reportModules, ...portfolioRefreshModules, ...opportunityModules, ...reflectionModules, ...disclosureTrackerModules, ...decisionTrackerModules, ...costReportModules, ...healthModules, ...alertModules]

// Human-in-the-loop approval: ASK-listed ops (publish/send/destructive) prompt
// the user over their chat and wait for `y/n <code>` before the agent proceeds.
const broker = new PermissionBroker((ch, chat, text) => channels.send(ch, chat, text))

const dispatcher = new Dispatcher(
  allModules,
  channels,
  agentRunner,
  db,
  memory,
  safety,
  undefined, // quoteFetcher → default
  broker,
)

// ── Scheduler ──────────────────────────────────────────────────────────────────
const cronModules = [...reportModules, ...portfolioRefreshModules, ...opportunityModules, ...reflectionModules, ...disclosureTrackerModules, ...decisionTrackerModules, ...costReportModules, ...healthModules]
const scheduler = new Scheduler(dispatcher, db)
// PROVIDER=deepseek(微信群实例)不跑 Cici 的自动推送(日报/告警/反思 cron)——
// 那些会在 DeepSeek 上空跑、无渠道投递、白烧 token。on-demand 模块路由仍保留。
if (getProvider() !== 'deepseek') {
  for (const mod of cronModules) {
    scheduler.register(mod)
  }
  scheduler.start(cronModules)
}

// ── EventSource (alert poller) ─────────────────────────────────────────────────
// Inject an L0 futu-snapshot price probe so stop/gain detectors run on fresh
// intraday prices, not just the twice-daily portfolio_state snapshot.
const eventSource = new EventSource(defaultDetectors, dispatcher, db, memory, codes => fetchPriceMap(codes))
// 同上:微信群实例不跑告警轮询(行情异动检测面向 Cici 的持仓,与微信群无关)。
if (getProvider() !== 'deepseek') {
  eventSource.start()
}

discordChannel?.onMessage(m => {
  dispatcher.dispatch(m).catch(err => {
    process.stderr.write(`nimbus: dispatcher error: ${err}\n`)
  })
})

apiChannel?.onMessage(m => {
  dispatcher.dispatch(m).catch(err => {
    process.stderr.write(`nimbus api: dispatcher error: ${err}\n`)
  })
})

weixinInboundChannel?.onMessage(m => {
  dispatcher.dispatch(m).catch(err => {
    process.stderr.write(`nimbus weixin-inbound: dispatcher error: ${err}\n`)
  })
})

// ── Graceful shutdown ─────────────────────────────────────────────────────────
let shuttingDown = false
function shutdown(): void {
  if (shuttingDown) return
  shuttingDown = true
  process.stderr.write('nimbus: shutting down\n')

  // Stop accepting new cron triggers and event polling immediately.
  scheduler.stop()
  eventSource.stop()

  // Drain in-flight tasks (max 10 s) before closing DB so late db.putSession /
  // db.audit / db.markJobRun calls don't write to an already-closed database (B3).
  const drainTimeout = new Promise<void>(resolve => setTimeout(resolve, 10_000))
  void Promise.race([dispatcher.drain(), drainTimeout]).finally(() => {
    void Promise.resolve(discordChannel?.destroy()).finally(() => {
      apiChannel?.destroy()
      weixinInboundChannel?.destroy()
      closeDb()
      process.exit(0)
    })
  })
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

// ── Start ─────────────────────────────────────────────────────────────────────
if (discordChannel) await discordChannel.start()
if (apiChannel) await apiChannel.start()
if (weixinInboundChannel) await weixinInboundChannel.start()
