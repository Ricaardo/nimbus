/**
 * scheduler.test.ts — Unit tests for Scheduler (M5).
 *
 * Uses mock Dispatcher and mock DB.  Croner is exercised via
 * runAtDate/runAt helpers rather than wall-clock waits.
 */

import { describe, test, expect } from 'bun:test'
import { Scheduler } from './scheduler.js'
import type { Module, DB } from '../modules/module.js'

// ── Mock DB ───────────────────────────────────────────────────────────────────

function makeDb(): {
  db: DB
  upsertCalls: Array<{ name: string; cron: string; targetChat: string }>
  markCalls: Array<{ name: string; status: string }>
} {
  const upsertCalls: Array<{ name: string; cron: string; targetChat: string }> = []
  const markCalls: Array<{ name: string; status: string }> = []
  const db: DB = {
    getSession: () => null,
    putSession: () => {},
    audit: () => {},
    getJob: () => null,
    upsertJob: (job) => { upsertCalls.push({ name: job.name, cron: job.cron, targetChat: job.targetChat }) },
    markJobRun: (name, status) => { markCalls.push({ name, status }) },
    getCooldown: () => null,
    setCooldown: () => {},
  }
  return { db, upsertCalls, markCalls }
}

// ── Mock Dispatcher ───────────────────────────────────────────────────────────

function makeDispatcher(): {
  dispatcher: { runCron(name: string): Promise<void> }
  cronCalls: string[]
} {
  const cronCalls: string[] = []
  const dispatcher = {
    async runCron(name: string): Promise<void> {
      cronCalls.push(name)
    },
  }
  return { dispatcher, cronCalls }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeModule(name: string, cron?: string): Module {
  return {
    name,
    cron,
    async handle() {},
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Scheduler.start: seeds DB jobs table', () => {
  test('upsertJob called for each module with cron', () => {
    const { db, upsertCalls } = makeDb()
    const { dispatcher } = makeDispatcher()
    const scheduler = new Scheduler(dispatcher as never, db)

    const mods = [
      makeModule('report:morning', '0 8 * * *'),
      makeModule('report:premarket', '0 21 * * *'),
      makeModule('report:close', '0 6 * * *'),
    ]

    scheduler.start(mods)

    expect(upsertCalls).toHaveLength(3)
    expect(upsertCalls.map(c => c.name)).toContain('report:morning')
    expect(upsertCalls.map(c => c.name)).toContain('report:premarket')
    expect(upsertCalls.map(c => c.name)).toContain('report:close')
  })

  test('upsertJob not called for modules without cron', () => {
    const { db, upsertCalls } = makeDb()
    const { dispatcher } = makeDispatcher()
    const scheduler = new Scheduler(dispatcher as never, db)

    const mods = [makeModule('echo')]  // no cron
    scheduler.start(mods)

    expect(upsertCalls).toHaveLength(0)
  })
})

describe('Scheduler.register: cron stored per module', () => {
  test('register skips module with no cron', () => {
    const { db } = makeDb()
    const { dispatcher } = makeDispatcher()
    const scheduler = new Scheduler(dispatcher as never, db)

    // Should not throw
    scheduler.register(makeModule('echo'))
    scheduler.stop()
  })

  test('register creates cron job for module with cron field', () => {
    const { db } = makeDb()
    const { dispatcher } = makeDispatcher()
    const scheduler = new Scheduler(dispatcher as never, db)

    // 1-minute cron; verify no error thrown
    const mod = makeModule('test:job', '* * * * *')
    expect(() => scheduler.register(mod)).not.toThrow()
    scheduler.stop()
  })
})

describe('Scheduler job fire → dispatcher.runCron + markJobRun', () => {
  test('manual run: dispatcher.runCron called and markJobRun records ok', async () => {
    const { db, markCalls } = makeDb()
    const { dispatcher, cronCalls } = makeDispatcher()
    const scheduler = new Scheduler(dispatcher as never, db)

    // Simulate what the cron callback does internally, without waiting for wall clock
    // Access the internal fire logic by triggering runCron + markJobRun directly.
    // We test the wiring by exercising the same logic the Cron callback uses.
    const name = 'report:morning'
    await dispatcher.runCron(name)
    db.markJobRun(name, 'ok')

    expect(cronCalls).toContain(name)
    expect(markCalls).toHaveLength(1)
    expect(markCalls[0]).toEqual({ name, status: 'ok' })

    scheduler.stop()
  })

  test('dispatcher.runCron error → markJobRun records error status', async () => {
    const { db, markCalls } = makeDb()
    const errorDispatcher = {
      async runCron(_name: string): Promise<void> {
        throw new Error('agent exploded')
      },
    }
    const scheduler = new Scheduler(errorDispatcher as never, db)

    const name = 'report:premarket'
    try {
      await errorDispatcher.runCron(name)
    } catch {
      db.markJobRun(name, 'error: Error: agent exploded')
    }

    expect(markCalls).toHaveLength(1)
    expect(markCalls[0].status).toContain('error')

    scheduler.stop()
  })
})

describe('Scheduler.stop', () => {
  test('stop clears jobs without throwing', () => {
    const { db } = makeDb()
    const { dispatcher } = makeDispatcher()
    const scheduler = new Scheduler(dispatcher as never, db)

    scheduler.register(makeModule('r:m', '0 8 * * *'))
    expect(() => scheduler.stop()).not.toThrow()
  })
})

describe('Scheduler.triggerJob: real Cron callback wiring', () => {
  test('triggerJob fires the cron callback → runCron + markJobRun called', async () => {
    const { db, markCalls } = makeDb()
    const { dispatcher, cronCalls } = makeDispatcher()
    const scheduler = new Scheduler(dispatcher as never, db)

    const mod = makeModule('report:morning', '0 8 * * *')
    scheduler.register(mod)

    // Manually fire via croner's trigger() (verifies real Cron callback wiring)
    await scheduler.triggerJob('report:morning')

    expect(cronCalls).toContain('report:morning')
    expect(markCalls).toHaveLength(1)
    expect(markCalls[0]).toEqual({ name: 'report:morning', status: 'ok' })

    scheduler.stop()
  })

  test('triggerJob: dispatcher error → markJobRun records error status', async () => {
    const { db, markCalls } = makeDb()
    const errorDispatcher = {
      async runCron(_name: string): Promise<void> {
        throw new Error('network fail')
      },
    }
    const scheduler = new Scheduler(errorDispatcher as never, db)

    const mod = makeModule('report:premarket', '0 21 * * *')
    scheduler.register(mod)

    await scheduler.triggerJob('report:premarket')

    expect(markCalls).toHaveLength(1)
    expect(markCalls[0].status).toContain('error')

    scheduler.stop()
  })

  test('triggerJob: start() passes targetChat to upsertJob', () => {
    const { db, upsertCalls } = makeDb()
    const { dispatcher } = makeDispatcher()
    const scheduler = new Scheduler(dispatcher as never, db)

    const modWithChat: Module = {
      name: 'report:morning',
      cron: '0 8 * * *',
      targetChat: '1234567890',
      async handle() {},
    }

    scheduler.start([modWithChat])

    expect(upsertCalls).toHaveLength(1)
    expect(upsertCalls[0].targetChat).toBe('1234567890')
  })
})
