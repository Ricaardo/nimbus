/**
 * scheduler.ts — Cron job runner for Nimbus (M5).
 *
 * Wraps croner.  Each registered job is a Module with a cron? field.
 * On fire: enqueues via Dispatcher.runCron() → per-chat serial queue →
 * module.handle({ trigger: { kind:'cron', job: name }, ... }).
 *
 * DB: seeds jobs table on start(); records last run status via markJobRun().
 */

import { Cron } from 'croner'
import type { Module, DB } from '../modules/module.js'
import type { Dispatcher } from './dispatcher.js'

export class Scheduler {
  readonly #jobs: Map<string, Cron> = new Map()

  constructor(
    private readonly dispatcher: Dispatcher,
    private readonly db: DB,
  ) {}

  /** Register a module's cron job.  No-op if module has no cron expression. */
  register(mod: Module): void {
    if (!mod.cron) return

    const cronExpr = mod.cron
    const name = mod.name

    const job = new Cron(
      cronExpr,
      { timezone: 'Asia/Shanghai', protect: true },
      async () => {
        try {
          await this.dispatcher.runCron(name)
          this.db.markJobRun(name, 'ok')
        } catch (err) {
          process.stderr.write(`nimbus: scheduler job ${name} error: ${err}\n`)
          this.db.markJobRun(name, `error: ${err}`)
        }
      },
    )

    this.#jobs.set(name, job)
  }

  /** Seed the DB jobs table and start all registered cron jobs. */
  start(modules: Module[]): void {
    for (const mod of modules) {
      if (!mod.cron) continue
      this.db.upsertJob({ name: mod.name, cron: mod.cron, targetChat: mod.targetChat ?? '' })
    }
    // Jobs were already started by Cron constructor; nothing more to do.
  }

  /** Stop all cron jobs (call on SIGTERM). */
  stop(): void {
    for (const [, job] of this.#jobs) {
      job.stop()
    }
    this.#jobs.clear()
  }

  // ── Test helper ─────────────────────────────────────────────────────────────
  /** Manually fire the croner job for a given module name.
   *  Used in tests to verify the Cron callback wiring without wall-clock waits. */
  async triggerJob(name: string): Promise<void> {
    const job = this.#jobs.get(name)
    if (!job) throw new Error(`Scheduler.triggerJob: no job named "${name}"`)
    await job.trigger()
  }
}
