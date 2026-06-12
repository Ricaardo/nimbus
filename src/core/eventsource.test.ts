/**
 * eventsource.test.ts — Unit tests for EventSource (M6 Batch 1).
 *
 * Uses mock detectors, dispatcher, db, and memory.
 * Does not use real timers (tests call tick() directly).
 */

import { describe, test, expect } from 'bun:test'
import { EventSource } from './eventsource.js'
import type { Detector, DetectCtx, EventPayload, DB, Memory } from '../modules/module.js'
import { ALERT_DAILY_CAP } from '../config.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePayload(event: EventPayload['event'], key: string): EventPayload {
  return {
    event,
    key,
    summary: `Alert: ${key}`,
  }
}

function makeDetector(event: EventPayload['event'], payloads: EventPayload[]): Detector {
  return {
    name: event,
    event,
    detect: (_ctx: DetectCtx) => payloads,
  }
}

function makeNullMemory(): Memory {
  return {
    loadPortfolioState: () => null,
    riskProfile: () => '',
    buildContext: () => '',
  }
}

interface DispatchedEvent {
  payload: EventPayload
  targetChat: string
}

function makeDispatcher(): {
  dispatched: DispatchedEvent[]
  dispatcher: { dispatchEvent(payload: EventPayload, targetChat: string): Promise<void> }
} {
  const dispatched: DispatchedEvent[] = []
  const dispatcher = {
    async dispatchEvent(payload: EventPayload, targetChat: string): Promise<void> {
      dispatched.push({ payload, targetChat })
    },
  }
  return { dispatched, dispatcher }
}

interface CooldownStore { [key: string]: number }

function makeDb(initialCooldowns: CooldownStore = {}): {
  db: DB
  cooldowns: CooldownStore
  kv: Record<string, string>
} {
  const cooldowns: CooldownStore = { ...initialCooldowns }
  const kv: Record<string, string> = {}
  const db: DB = {
    getSession: () => null,
    putSession: () => {},
    audit: () => {},
    getJob: () => null,
    upsertJob: () => {},
    markJobRun: () => {},
    getCooldown: (key: string) => cooldowns[key] ?? null,
    setCooldown: (key: string, ts: number) => { cooldowns[key] = ts },
    getKv: (key: string) => kv[key] ?? null,
    setKv: (key: string, value: string) => { kv[key] = value },
  }
  return { db, cooldowns, kv }
}

// ── First tick is skipped (seed cooldowns) ────────────────────────────────────

describe('EventSource: first tick is skipped', () => {
  test('first tick seeds cooldowns but does NOT dispatch', async () => {
    const payload = makePayload('stop_hit', 'stop_hit:AVGO')
    const detector = makeDetector('stop_hit', [payload])
    const { dispatched, dispatcher } = makeDispatcher()
    const { db } = makeDb()
    const memory = makeNullMemory()

    const es = new EventSource([detector], dispatcher as never, db, memory)
    await es.tick() // first tick = seed, no dispatch

    expect(dispatched).toHaveLength(0)
  })

  test('first tick seeds cooldown keys for existing breaches', async () => {
    const payload = makePayload('stop_hit', 'stop_hit:TEST')
    const detector = makeDetector('stop_hit', [payload])
    const { dispatcher } = makeDispatcher()
    const { db, cooldowns } = makeDb()
    const memory = makeNullMemory()

    const es = new EventSource([detector], dispatcher as never, db, memory)
    await es.tick() // first tick: seed

    expect(cooldowns['stop_hit:TEST']).toBeDefined()
  })

  test('second tick dispatches after first seed', async () => {
    // Create a payload that fires on second tick (cooldown seeded on first tick,
    // but we'll test a fresh payload that doesn't get seeded)
    const dispatched: DispatchedEvent[] = []
    let callCount = 0

    // Detector returns payload only on second call
    const detector: Detector = {
      name: 'stop_hit',
      event: 'stop_hit',
      detect: () => {
        callCount++
        if (callCount === 1) return [] // first tick: nothing
        return [makePayload('stop_hit', 'stop_hit:NEW')]
      },
    }

    const dispatcher = {
      async dispatchEvent(payload: EventPayload, targetChat: string): Promise<void> {
        dispatched.push({ payload, targetChat })
      },
    }

    const { db } = makeDb()
    const memory = makeNullMemory()

    const es = new EventSource([detector], dispatcher as never, db, memory)
    await es.tick() // first tick (callCount=1): empty → nothing seeded
    await es.tick() // second tick (callCount=2): new payload → dispatched

    expect(dispatched).toHaveLength(1)
    expect(dispatched[0].payload.key).toBe('stop_hit:NEW')
  })
})

// ── Cooldown gate ─────────────────────────────────────────────────────────────

describe('EventSource: cooldown gate', () => {
  test('does not re-dispatch within cooldown window', async () => {
    const payload = makePayload('stop_hit', 'stop_hit:AVGO')
    const detector = makeDetector('stop_hit', [payload])
    const { dispatched, dispatcher } = makeDispatcher()

    // Pre-seed cooldown with a "just now" timestamp
    const now = Date.now()
    const { db } = makeDb({ 'stop_hit:AVGO': now })
    const memory = makeNullMemory()

    const es = new EventSource([detector], dispatcher as never, db, memory)
    await es.tick() // first tick → seed (already seeded, no-op)
    await es.tick() // second tick → within cooldown → no dispatch

    expect(dispatched).toHaveLength(0)
  })

  test('dispatches after cooldown expires (simulated via expired timestamp)', async () => {
    const payload = makePayload('stop_hit', 'stop_hit:MRVL')
    const detector = makeDetector('stop_hit', [payload])
    const { dispatched, dispatcher } = makeDispatcher()

    // Pre-seed cooldown with a timestamp 7h ago (> 6h TTL)
    const sevenHoursAgo = Date.now() - 7 * 3600_000
    const { db } = makeDb({ 'stop_hit:MRVL': sevenHoursAgo })
    const memory = makeNullMemory()

    const es = new EventSource([detector], dispatcher as never, db, memory)
    await es.tick() // first tick → seed (already has expired cooldown, no re-seed per logic)
    await es.tick() // second tick → expired cooldown → dispatches

    expect(dispatched).toHaveLength(1)
    expect(dispatched[0].payload.key).toBe('stop_hit:MRVL')
  })
})

// ── Quiet hours gate ──────────────────────────────────────────────────────────

describe('EventSource: quiet hours suppression', () => {
  // We can't easily mock Date.now() in Bun without monkey-patching,
  // so we verify the quiet-hour logic through the isQuietHour helper
  // indirectly by observing dispatch behavior.
  //
  // The quiet-hours check uses Intl (Asia/Shanghai). We test the gate behavior
  // by verifying that stop_hit bypasses it (exempt), while other events are
  // suppressed. Since we can't force the clock, we test at the gate level:
  // if the current hour happens to be in quiet hours, soft alerts don't fire.
  // We instead just verify the stop_hit exemption always works.

  test('stop_hit is dispatched regardless of hour (no cooldown in DB)', async () => {
    // stop_hit bypasses quiet-hour check — dispatches if cooldown clear.
    // To avoid the seed cooldown from blocking, we use a detector that returns
    // nothing on the seed tick and the payload on the second tick.
    const stopPayload = makePayload('stop_hit', 'stop_hit:ALWAYS')
    const callCount = { n: 0 }
    const detector: Detector = {
      name: 'stop_hit',
      event: 'stop_hit',
      detect: () => {
        callCount.n++
        return callCount.n === 1 ? [] : [stopPayload] // empty on seed, payload on tick 2
      },
    }

    const { dispatched, dispatcher } = makeDispatcher()
    const { db } = makeDb()
    const memory = makeNullMemory()

    const es = new EventSource([detector], dispatcher as never, db, memory)
    await es.tick() // seed (callCount=1: returns empty → nothing seeded)
    await es.tick() // dispatch (callCount=2: returns stop_hit → dispatched)

    expect(dispatched).toHaveLength(1)
    expect(dispatched[0].payload.event).toBe('stop_hit')
  })
})

// ── Daily cap ─────────────────────────────────────────────────────────────────

describe('EventSource: daily cap', () => {
  test(`soft alerts capped at ALERT_DAILY_CAP (${ALERT_DAILY_CAP}) per day`, async () => {
    // Create more payloads than the cap
    const payloads = Array.from({ length: ALERT_DAILY_CAP + 3 }, (_, i) =>
      makePayload('concentration_breach', `concentration_breach:single:POS${i}`),
    )

    // Each call returns all payloads (distinct keys)
    const callCount = { n: 0 }
    const detector: Detector = {
      name: 'concentration',
      event: 'concentration_breach',
      detect: () => {
        callCount.n++
        return callCount.n === 1 ? [] : payloads // first tick: empty (seed), second: all
      },
    }

    const { dispatched, dispatcher } = makeDispatcher()
    const { db } = makeDb()
    const memory = makeNullMemory()

    const es = new EventSource([detector], dispatcher as never, db, memory)
    await es.tick() // seed
    await es.tick() // dispatch → capped at ALERT_DAILY_CAP

    expect(dispatched.length).toBeLessThanOrEqual(ALERT_DAILY_CAP)
  })

  test('stop_hit bypasses daily cap', async () => {
    // Fill the daily cap first with concentration breaches, then try stop_hit
    const softPayloads = Array.from({ length: ALERT_DAILY_CAP }, (_, i) =>
      makePayload('concentration_breach', `concentration_breach:single:P${i}`),
    )
    const stopPayload = makePayload('stop_hit', 'stop_hit:CRITICAL')

    const callCount = { n: 0 }
    const detector: Detector = {
      name: 'test',
      event: 'concentration_breach',
      detect: () => {
        callCount.n++
        if (callCount.n === 1) return []
        return [...softPayloads, stopPayload]
      },
    }

    const { dispatched, dispatcher } = makeDispatcher()
    const { db } = makeDb()
    const memory = makeNullMemory()

    const es = new EventSource([detector], dispatcher as never, db, memory)
    await es.tick() // seed
    await es.tick() // dispatch

    // stop_hit should always be present despite cap
    const stopDispatched = dispatched.find(d => d.payload.key === 'stop_hit:CRITICAL')
    expect(stopDispatched).toBeDefined()
  })
})

// ── Dispatcher serialization (per-chat queue) ─────────────────────────────────

describe('EventSource: dispatches to REPORT_DM target chat', () => {
  test('dispatchEvent is called with REPORT_DM targetChat', async () => {
    const { REPORT_DM } = await import('../config.js')

    // Use detector that returns empty on seed tick, payload on second tick
    const stopPayload = makePayload('stop_hit', 'stop_hit:DM_CHECK')
    const callCount = { n: 0 }
    const detector: Detector = {
      name: 'stop_hit',
      event: 'stop_hit',
      detect: () => {
        callCount.n++
        return callCount.n === 1 ? [] : [stopPayload]
      },
    }

    const { dispatched, dispatcher } = makeDispatcher()
    const { db } = makeDb()
    const memory = makeNullMemory()

    const es = new EventSource([detector], dispatcher as never, db, memory)
    await es.tick() // seed
    await es.tick() // dispatch

    expect(dispatched).toHaveLength(1)
    expect(dispatched[0].targetChat).toBe(REPORT_DM)
  })
})

// ── Detector error isolation ──────────────────────────────────────────────────

describe('EventSource: detector errors do not crash tick', () => {
  test('throwing detector does not prevent other detectors from running', async () => {
    const goodPayload = makePayload('stop_hit', 'stop_hit:GOOD')

    const throwingDetector: Detector = {
      name: 'bad',
      event: 'concentration_breach',
      detect: () => { throw new Error('detector exploded') },
    }

    const callCount = { n: 0 }
    const goodDetector: Detector = {
      name: 'good',
      event: 'stop_hit',
      detect: () => {
        callCount.n++
        return callCount.n === 1 ? [] : [goodPayload]
      },
    }

    const { dispatched, dispatcher } = makeDispatcher()
    const { db } = makeDb()
    const memory = makeNullMemory()

    const es = new EventSource([throwingDetector, goodDetector], dispatcher as never, db, memory)
    // Should not throw
    await expect(es.tick()).resolves.toBeUndefined() // seed tick
    await expect(es.tick()).resolves.toBeUndefined() // dispatch tick

    // Good detector still ran
    expect(dispatched).toHaveLength(1)
    expect(dispatched[0].payload.key).toBe('stop_hit:GOOD')
  })
})

// ── Fresh-price probe + per-event cooldown ────────────────────────────────────

function makeMemoryWithCodes(codes: string[]): Memory {
  return {
    loadPortfolioState: () => ({
      as_of: new Date().toISOString(),
      nav_usd: 1, cash_usd: 0, cash_pct: 0, ibkr_stale: false,
      positions: codes.map(code => ({
        code, name: code, source: 'futu', qty: 1, avg_cost: 1, price: 1, mv_usd: 1,
        pl_pct: 0, canon: code, is_option: false, underlying: null, weight_pct: 1,
        thesis: null, conviction_score: null, thesis_verdict: null, stop_loss: null,
      })),
      reconcile_flags: [],
    }),
    riskProfile: () => '',
    buildContext: () => '',
  }
}

describe('EventSource: fresh-price probe', () => {
  test('invokes priceFetcher with held codes and passes prices to detectors', async () => {
    let seenCodes: string[] = []
    let seenPrices: Map<string, number> | undefined
    const probe = async (codes: string[]) => {
      seenCodes = codes
      return new Map([['US.NVDA', 52]])
    }
    const calls = { n: 0 }
    const detector: Detector = {
      name: 'stop_hit', event: 'stop_hit',
      detect: (ctx: DetectCtx) => {
        calls.n++
        seenPrices = ctx.prices
        // [] on the seed tick (calls.n===1) so nothing seeds the cooldown.
        return calls.n === 1 ? [] : [makePayload('stop_hit', 'stop_hit:US.NVDA')]
      },
    }
    const { dispatched, dispatcher } = makeDispatcher()
    const { db } = makeDb()
    const es = new EventSource([detector], dispatcher as never, db, makeMemoryWithCodes(['US.NVDA']), probe)

    await es.tick() // seed
    await es.tick() // dispatch

    expect(seenCodes).toEqual(['US.NVDA'])
    expect(seenPrices?.get('US.NVDA')).toBe(52)
    expect(dispatched).toHaveLength(1)
  })

  test('gain_alert respects the long cooldown (not re-fired within 6h)', async () => {
    const detector = makeDetector('gain_alert', [makePayload('gain_alert', 'gain_alert:NVDA:25')])
    const { dispatched, dispatcher } = makeDispatcher()
    // Seed a cooldown 1h ago — well inside GAIN_COOLDOWN_MS (7d).
    const { db } = makeDb({ 'gain_alert:NVDA:25': Date.now() - 3600_000 })
    const es = new EventSource([detector], dispatcher as never, db, makeNullMemory())

    await es.tick() // seed
    await es.tick() // would dispatch, but cooldown blocks

    expect(dispatched).toHaveLength(0)
  })
})

// ── NAV high-water mark + drawdown wiring ─────────────────────────────────────

function makeMemoryWithNav(nav: number): Memory {
  return {
    loadPortfolioState: () => ({
      as_of: new Date().toISOString(),
      nav_usd: nav, cash_usd: 0, cash_pct: 0, ibkr_stale: false,
      positions: [], reconcile_flags: [],
    }),
    riskProfile: () => '',
    buildContext: () => '',
  }
}

describe('EventSource: NAV high-water mark', () => {
  test('seeds HWM on first observation and ratchets up on new highs', async () => {
    const detector = makeDetector('drawdown', []) // no payloads; we only check kv
    const { dispatcher } = makeDispatcher()
    const { db, kv } = makeDb()
    // NAV 20000 — first real tick should seed HWM.
    const es = new EventSource([detector], dispatcher as never, db, makeMemoryWithNav(20000))
    await es.tick() // seed cooldowns (no HWM sync on the skipped first tick)
    await es.tick() // observes nav=20000 → sets HWM
    expect(kv['nav_hwm']).toBe('20000')
  })

  test('passes the prior stored HWM to the detector (does not lower it on a dip)', async () => {
    let seenHwm: number | undefined
    const detector: Detector = {
      name: 'drawdown', event: 'drawdown',
      detect: (ctx: DetectCtx) => { seenHwm = ctx.navHighWater; return [] },
    }
    const { dispatcher } = makeDispatcher()
    // Prior peak already stored at 25000; current NAV 20000 (a dip).
    const { db, kv } = makeDb()
    db.setKv!('nav_hwm', '25000')
    const es = new EventSource([detector], dispatcher as never, db, makeMemoryWithNav(20000))

    await es.tick() // seed
    await es.tick() // detector sees the prior HWM

    expect(seenHwm).toBe(25000)      // detector got the peak, not current NAV
    expect(kv['nav_hwm']).toBe('25000') // HWM not lowered by the dip
  })
})
