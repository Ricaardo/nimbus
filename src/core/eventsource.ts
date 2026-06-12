/**
 * eventsource.ts — Periodic portfolio-state event poller (M6 Batch 1).
 *
 * Runs detectors on a configurable interval, gates each payload through:
 *   1. Cooldown check (default 6h per key)
 *   2. Quiet-hours suppression (23:00–07:00 Asia/Shanghai), stop_hit exempt
 *   3. Daily soft-alert cap (default 6), stop_hit exempt
 *
 * First tick is skipped (startup grace + seed cooldowns) to avoid burst on boot.
 * Dispatches via dispatcher.dispatchEvent() which enqueues into the REPORT_DM
 * per-chat queue for serialization with live DM messages.
 *
 * Detector errors are caught per-detector and do not halt the tick.
 */

import type { Detector, DB, Memory } from '../modules/module.js'
import type { Dispatcher } from './dispatcher.js'
import {
  EVENT_INTERVAL_MS,
  COOLDOWN_TTL_MS,
  GAIN_COOLDOWN_MS,
  ALERT_DAILY_CAP,
  QUIET_HOURS,
  REPORT_DM,
} from '../config.js'

/** Fetches fresh { futu-code → last price } for the given held codes. Injected
 *  by main.ts (L0 futu snapshot probe); empty/throwing → detectors use snapshot. */
export type PriceFetcher = (codes: string[]) => Promise<Map<string, number>>

/** Return the current hour (0-23) in Asia/Shanghai timezone. */
function shanghaiHour(now: Date): number {
  // Use Intl.DateTimeFormat to extract the local hour in Asia/Shanghai.
  // This avoids relying on the host system's timezone.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(now)
  const hourPart = parts.find(p => p.type === 'hour')
  return hourPart ? parseInt(hourPart.value, 10) % 24 : now.getUTCHours()
}

/** Returns true if the current time is within quiet hours (start..end, wrapping midnight). */
function isQuietHour(now: Date): boolean {
  const h = shanghaiHour(now)
  const { start, end } = QUIET_HOURS
  // start=23, end=7: quiet if h >= 23 OR h < 7
  if (start > end) return h >= start || h < end
  // start=0, end=7: quiet if h >= 0 && h < 7
  return h >= start && h < end
}

export class EventSource {
  readonly #detectors: Detector[]
  readonly #dispatcher: Dispatcher
  readonly #db: DB
  readonly #memory: Memory
  readonly #priceFetcher?: PriceFetcher

  #timer: ReturnType<typeof setInterval> | undefined
  #firstTick = true
  /** In-memory soft-alert count for today. Resets when quiet-period ends. */
  #dailyCount = 0
  /** The last date (YYYY-MM-DD in Asia/Shanghai) when the daily counter was reset. */
  #lastResetDate = ''

  constructor(
    detectors: Detector[],
    dispatcher: Dispatcher,
    db: DB,
    memory: Memory,
    priceFetcher?: PriceFetcher,
  ) {
    this.#detectors = detectors
    this.#dispatcher = dispatcher
    this.#db = db
    this.#memory = memory
    this.#priceFetcher = priceFetcher
  }

  /** Probe fresh intraday prices for currently-held codes. Never throws —
   *  a miss returns undefined and detectors fall back to the snapshot price. */
  async #freshPrices(): Promise<Map<string, number> | undefined> {
    if (!this.#priceFetcher) return undefined
    try {
      const state = this.#memory.loadPortfolioState()
      const codes = (state?.positions ?? []).map(p => p.code).filter(Boolean)
      if (codes.length === 0) return undefined
      const map = await this.#priceFetcher(codes)
      return map.size > 0 ? map : undefined
    } catch (err) {
      process.stderr.write(`nimbus: eventsource price probe failed (using snapshot): ${err}\n`)
      return undefined
    }
  }

  /** Return the prior NAV high-water mark (for the drawdown detector) and ratchet
   *  the stored HWM up if current NAV set a new high. Returns undefined when kv
   *  storage isn't available or NAV is unknown. */
  #syncHighWater(): number | undefined {
    if (!this.#db.getKv || !this.#db.setKv) return undefined
    const nav = this.#memory.loadPortfolioState()?.nav_usd
    if (!(typeof nav === 'number' && nav > 0)) return undefined
    const stored = this.#db.getKv('nav_hwm')
    const prior = stored ? Number(stored) : 0
    if (nav > prior) this.#db.setKv('nav_hwm', String(nav))
    return prior > 0 ? prior : undefined
  }

  start(): void {
    if (this.#timer !== undefined) return // already running

    this.#timer = setInterval(() => {
      void this.#tick()
    }, EVENT_INTERVAL_MS)

    // Allow the process to exit without waiting for the interval.
    if (typeof this.#timer === 'object' && this.#timer !== null && 'unref' in this.#timer) {
      (this.#timer as NodeJS.Timeout).unref()
    }
  }

  stop(): void {
    if (this.#timer !== undefined) {
      clearInterval(this.#timer)
      this.#timer = undefined
    }
  }

  /** Exposed for testing: run one detection cycle directly. */
  async tick(): Promise<void> {
    return this.#tick()
  }

  async #tick(): Promise<void> {
    // Skip the very first tick to avoid boot-time alert burst.
    if (this.#firstTick) {
      this.#firstTick = false
      // Seed cooldowns for any currently-breached conditions so they don't
      // immediately fire on the second tick either.
      await this.#seedCooldowns()
      return
    }

    const now = Date.now()
    const nowDate = new Date(now)

    // Reset daily counter at quiet-period end (hour == QUIET_HOURS.end in Shanghai)
    const shanghaiDateStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(nowDate)

    if (shanghaiDateStr !== this.#lastResetDate) {
      // Only reset if we're past quiet hours (i.e., start of trading day)
      const h = shanghaiHour(nowDate)
      if (h === QUIET_HOURS.end || (h > QUIET_HOURS.end && h < QUIET_HOURS.start)) {
        this.#dailyCount = 0
        this.#lastResetDate = shanghaiDateStr
      }
    }

    const quiet = isQuietHour(nowDate)

    // Fresh intraday prices (once per tick) so stop/gain detectors run on
    // near-real-time data rather than the twice-daily portfolio_state snapshot.
    const prices = await this.#freshPrices()

    // NAV high-water mark: pass the prior peak to the drawdown detector, then
    // ratchet it up if NAV made a new high. First observation just seeds the HWM.
    const navHighWater = this.#syncHighWater()

    for (const detector of this.#detectors) {
      let payloads
      try {
        payloads = detector.detect({ memory: this.#memory, prices, navHighWater })
      } catch (err) {
        process.stderr.write(`nimbus: eventsource detector "${detector.name}" error: ${err}\n`)
        continue
      }

      for (const payload of payloads) {
        const isStopHit = payload.event === 'stop_hit'

        // 1. Cooldown gate (gain alerts re-fire far less often than risk alerts)
        const ttl = payload.event === 'gain_alert' ? GAIN_COOLDOWN_MS : COOLDOWN_TTL_MS
        const lastFired = this.#db.getCooldown(payload.key)
        if (lastFired !== null && (now - lastFired) <= ttl) {
          continue // within cooldown window
        }

        // 2. Quiet-hours gate (stop_hit is exempt — urgent)
        if (quiet && !isStopHit) {
          continue
        }

        // 3. Daily soft-alert cap (stop_hit is exempt)
        if (!isStopHit && this.#dailyCount >= ALERT_DAILY_CAP) {
          continue
        }

        // All gates passed — dispatch
        this.#db.setCooldown(payload.key, now)
        if (!isStopHit) {
          this.#dailyCount++
        }

        void this.#dispatcher.dispatchEvent(payload, REPORT_DM)
      }
    }
  }

  /** Silently seed cooldowns for currently-detected payloads so we don't
   *  immediately re-fire them on the second tick. */
  async #seedCooldowns(): Promise<void> {
    const now = Date.now()
    for (const detector of this.#detectors) {
      try {
        const payloads = detector.detect({ memory: this.#memory })
        for (const payload of payloads) {
          // Only seed if not already in cooldown
          const lastFired = this.#db.getCooldown(payload.key)
          if (lastFired === null) {
            this.#db.setCooldown(payload.key, now)
          }
        }
      } catch {
        // Ignore errors during seed
      }
    }
  }
}
