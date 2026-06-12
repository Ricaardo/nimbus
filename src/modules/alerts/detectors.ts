/**
 * detectors.ts — Pure stateless portfolio-state detectors (M6 Batch 1).
 *
 * Each detector implements the Detector interface: synchronous, read-only,
 * no side effects, no I/O beyond reading portfolio_state via ctx.memory.
 *
 * Thresholds are imported from config.ts constants for testability.
 */

import type { Detector, DetectCtx, EventPayload, Position } from '../module.js'
import { SINGLE_CONC_PCT, DECAY_VERDICTS, GAIN_ALERT_PCT, DRAWDOWN_PCT } from '../../config.js'

/** Fresh intraday price for a position if the EventSource probe supplied one,
 *  else the (twice-daily) portfolio_state snapshot price. */
function freshPrice(ctx: DetectCtx, pos: Position): number {
  return ctx.prices?.get(pos.code) ?? pos.price
}

// ── Stop-hit detector ─────────────────────────────────────────────────────────

/**
 * Fires a `stop_hit` payload for every position whose price has crossed
 * at or below its stop_loss level.
 *
 * Only positions with a non-null stop_loss are considered.
 */
export const stopHitDetector: Detector = {
  name: 'stop_hit',
  event: 'stop_hit',

  detect(ctx: DetectCtx): EventPayload[] {
    const state = ctx.memory.loadPortfolioState()
    if (!state) return []

    const results: EventPayload[] = []
    for (const pos of state.positions) {
      if (pos.stop_loss === null || pos.stop_loss === undefined) continue
      const price = freshPrice(ctx, pos)
      if (price <= pos.stop_loss) {
        const live = ctx.prices?.has(pos.code) ? '实时价' : `as_of: ${state.as_of}`
        results.push({
          event: 'stop_hit',
          key: `stop_hit:${pos.code}`,
          summary: `止损触发：${pos.code} (${pos.name}) 当前价 ${price} ≤ 止损价 ${pos.stop_loss}（${live}）`,
          data: {
            code: pos.code,
            name: pos.name,
            price,
            stop_loss: pos.stop_loss,
            as_of: state.as_of,
          },
        })
      }
    }
    return results
  },
}

// ── Gain / take-profit detector ───────────────────────────────────────────────

/**
 * Fires `gain_alert` ("consider locking profit / trail the stop") when, on the
 * fresh price, a position has either:
 *   (a) reached its explicit take_profit target (if set), or
 *   (b) an unrealized gain ≥ GAIN_ALERT_PCT.
 *
 * The dedup key embeds the 25%-gain band so crossing into a higher band re-fires
 * promptly, while a position sitting in one band stays quiet (combined with the
 * longer GAIN_COOLDOWN_MS applied in EventSource). Skips losers / flat / no-cost.
 */
export const gainAlertDetector: Detector = {
  name: 'gain_alert',
  event: 'gain_alert',

  detect(ctx: DetectCtx): EventPayload[] {
    const state = ctx.memory.loadPortfolioState()
    if (!state) return []

    const results: EventPayload[] = []
    for (const pos of state.positions) {
      if (!(pos.avg_cost > 0)) continue
      const price = freshPrice(ctx, pos)
      const gainPct = ((price - pos.avg_cost) / pos.avg_cost) * 100

      const targetHit = pos.take_profit != null && pos.take_profit > 0 && price >= pos.take_profit
      const bigGain = gainPct >= GAIN_ALERT_PCT
      if (!targetHit && !bigGain) continue

      const band = Math.floor(gainPct / 25) * 25 // 25/50/75/… band for dedup
      const reason = targetHit
        ? `已达止盈目标 ${pos.take_profit}（现价 ${price}）`
        : `浮盈 +${gainPct.toFixed(1)}%（现价 ${price} / 成本 ${pos.avg_cost}）`
      results.push({
        event: 'gain_alert',
        key: `gain_alert:${pos.code}:${targetHit ? 'tp' : band}`,
        summary: `止盈提示：${pos.code} (${pos.name}) ${reason} — 考虑锁利或上移止损保护利润`,
        data: {
          code: pos.code,
          name: pos.name,
          price,
          avg_cost: pos.avg_cost,
          gain_pct: Number(gainPct.toFixed(1)),
          take_profit: pos.take_profit ?? null,
        },
      })
    }
    return results
  },
}

// ── Portfolio drawdown detector ───────────────────────────────────────────────

/**
 * Fires `drawdown` when total NAV has fallen ≥ DRAWDOWN_PCT from its peak
 * (high-water mark). The HWM is supplied via ctx.navHighWater (read + ratcheted
 * by EventSource from persistent kv); the detector itself stays pure — it only
 * compares the two numbers. No HWM yet, or NAV at/above peak → no alert.
 */
export const drawdownDetector: Detector = {
  name: 'drawdown',
  event: 'drawdown',

  detect(ctx: DetectCtx): EventPayload[] {
    const state = ctx.memory.loadPortfolioState()
    if (!state) return []
    const nav = state.nav_usd
    const hwm = ctx.navHighWater
    if (!hwm || hwm <= 0 || !(nav > 0)) return []

    const ddPct = ((hwm - nav) / hwm) * 100
    if (ddPct < DRAWDOWN_PCT) return []

    // Band the dedup key by 5% so a deepening drawdown re-alerts on new lows.
    const band = Math.floor(ddPct / 5) * 5
    return [{
      event: 'drawdown',
      key: `drawdown:${band}`,
      summary: `组合回撤告警：总市值从高点 $${Math.round(hwm)} 回撤 ${ddPct.toFixed(1)}% 至 $${Math.round(nav)}（as_of: ${state.as_of}）`,
      data: { nav_usd: nav, hwm_usd: hwm, drawdown_pct: Number(ddPct.toFixed(1)), as_of: state.as_of },
    }]
  },
}

// ── Concentration detector ────────────────────────────────────────────────────

/**
 * Fires `concentration_breach` payloads for:
 * (a) Single position whose weight_pct >= SINGLE_CONC_PCT (already in %)
 * (b) Semiconductor bucket — reads reconcile_flags for the SEMI>30% flag;
 *     does NOT self-compute the semi sum, relies on L1 classification.
 */
export const concentrationDetector: Detector = {
  name: 'concentration',
  event: 'concentration_breach',

  detect(ctx: DetectCtx): EventPayload[] {
    const state = ctx.memory.loadPortfolioState()
    if (!state) return []

    const results: EventPayload[] = []

    // (a) Single-position overweight
    for (const pos of state.positions) {
      if (pos.weight_pct >= SINGLE_CONC_PCT) {
        results.push({
          event: 'concentration_breach',
          key: `concentration_breach:single:${pos.code}`,
          summary: `单票集中度告警：${pos.code} (${pos.name}) 占仓 ${pos.weight_pct.toFixed(2)}%，超过阈值 ${SINGLE_CONC_PCT}%`,
          data: { code: pos.code, name: pos.name, weight_pct: pos.weight_pct },
        })
      }
    }

    // (b) Semiconductor bucket — read from reconcile_flags (type contains 'SEMI')
    const flags = state.reconcile_flags ?? []
    const semiFlag = flags.find(f => f.type === '行业集中_SEMI>30%' || f.ticker === 'SEMI')
    if (semiFlag) {
      results.push({
        event: 'concentration_breach',
        key: 'concentration_breach:semis',
        summary: `半导体行业集中度告警：${semiFlag.detail}`,
        data: semiFlag,
      })
    }

    return results
  },
}

// ── Thesis-decay detector ─────────────────────────────────────────────────────

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000

/**
 * Fires `thesis_decay` for positions whose thesis is stale or degraded:
 * - `as_of` more than 90 days ago (zombie thesis) — uses state.as_of as proxy
 *   since thesis last-updated isn't a separate field.
 * - `thesis_verdict` is in DECAY_VERDICTS (e.g. 'decaying', 'broken').
 *
 * Positions with no thesis (null) are skipped.
 * Current normal verdicts (bull_correction, on_track) do NOT trigger.
 */
export const thesisDecayDetector: Detector = {
  name: 'thesis_decay',
  event: 'thesis_decay',

  detect(ctx: DetectCtx): EventPayload[] {
    const state = ctx.memory.loadPortfolioState()
    if (!state) return []

    const results: EventPayload[] = []

    // Parse as_of as a reference timestamp for staleness check
    const asOfMs = Date.parse(state.as_of)
    const nowMs = Date.now()
    const stateIsStale = !isNaN(asOfMs) && (nowMs - asOfMs) > NINETY_DAYS_MS

    for (const pos of state.positions) {
      // Skip positions without any thesis on record
      if (!pos.thesis) continue

      const verdictDecayed = pos.thesis_verdict !== null &&
        pos.thesis_verdict !== undefined &&
        (DECAY_VERDICTS as readonly string[]).includes(pos.thesis_verdict)

      if (verdictDecayed || stateIsStale) {
        const reason = verdictDecayed
          ? `论点状态 ${pos.thesis_verdict}`
          : `持仓状态文件超过90天未更新（as_of: ${state.as_of}）`

        results.push({
          event: 'thesis_decay',
          key: `thesis_decay:${pos.code}`,
          summary: `论点衰减：${pos.code} (${pos.name}) — ${reason}`,
          data: {
            code: pos.code,
            name: pos.name,
            thesis: pos.thesis,
            thesis_verdict: pos.thesis_verdict,
            as_of: state.as_of,
          },
        })
      }
    }
    return results
  },
}

/** All built-in detectors in run order. */
export const defaultDetectors: Detector[] = [
  stopHitDetector,
  gainAlertDetector,
  drawdownDetector,
  concentrationDetector,
  thesisDecayDetector,
]
