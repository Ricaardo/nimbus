// ── main.ts — first line must import proxy to ensure WebSocket override runs
// before any discord.js import occurs anywhere in the module graph.
import './channels/discord/proxy.js'

import { mkdirSync } from 'fs'
import { DiscordChannel } from './channels/discord/index.js'
import { Dispatcher } from './core/dispatcher.js'
import { SimpleRegistry } from './core/registry.js'
import { agentRunner, assertSubscriptionMode, setUsageLogger } from './core/agent.js'
import { refreshModels } from './core/models.js'
import { memory, setMemoryStore } from './core/memory.js'
import { safety } from './core/safety.js'
import { WORKSPACE, DATA_DIR, DAILY_COST_BUDGET_USD } from './config.js'
import { defaultDb, closeDb } from './core/db.js'
import { Scheduler } from './core/scheduler.js'
import { reportModules } from './modules/reports/index.js'
import { portfolioRefreshModules } from './modules/portfolio-refresh/index.js'
import { opportunityModules } from './modules/opportunity/index.js'
import { reflectionModules } from './modules/reflection/index.js'
import { disclosureTrackerModules } from './modules/disclosure-tracker/index.js'
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

const discordChannel = new DiscordChannel()

const registry = new SimpleRegistry()
registry.register(discordChannel)

// All modules: reports + refresh + opportunity + reflection + ops + alert handlers
const allModules = [...paperModules, ...reportModules, ...portfolioRefreshModules, ...opportunityModules, ...reflectionModules, ...disclosureTrackerModules, ...costReportModules, ...healthModules, ...alertModules]

// Human-in-the-loop approval: ASK-listed ops (publish/send/destructive) prompt
// the user over their chat and wait for `y/n <code>` before the agent proceeds.
const broker = new PermissionBroker((ch, chat, text) => registry.send(ch, chat, text))

const dispatcher = new Dispatcher(
  allModules,
  registry,
  agentRunner,
  db,
  memory,
  safety,
  undefined, // quoteFetcher → default
  broker,
)

// ── Scheduler ──────────────────────────────────────────────────────────────────
const cronModules = [...reportModules, ...portfolioRefreshModules, ...opportunityModules, ...reflectionModules, ...disclosureTrackerModules, ...costReportModules, ...healthModules]
const scheduler = new Scheduler(dispatcher, db)
for (const mod of cronModules) {
  scheduler.register(mod)
}
scheduler.start(cronModules)

// ── EventSource (alert poller) ─────────────────────────────────────────────────
// Inject an L0 futu-snapshot price probe so stop/gain detectors run on fresh
// intraday prices, not just the twice-daily portfolio_state snapshot.
const eventSource = new EventSource(defaultDetectors, dispatcher, db, memory, codes => fetchPriceMap(codes))
eventSource.start()

discordChannel.onMessage(m => {
  dispatcher.dispatch(m).catch(err => {
    process.stderr.write(`nimbus: dispatcher error: ${err}\n`)
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
    void Promise.resolve(discordChannel.destroy()).finally(() => {
      closeDb()
      process.exit(0)
    })
  })
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

// ── Start ─────────────────────────────────────────────────────────────────────
await discordChannel.start()
