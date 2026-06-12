/**
 * detectors.ts — Pure stateless portfolio-state detectors (M6 Batch 1).
 *
 * Each detector implements the Detector interface: synchronous, read-only,
 * no side effects, no I/O beyond reading portfolio_state via ctx.memory.
 *
 * Thresholds are imported from config.ts constants for testability.
 */

import type { Detector, DetectCtx, EventPayload } from '../module.js'
import { SINGLE_CONC_PCT, DECAY_VERDICTS } from '../../config.js'

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
      if (pos.price <= pos.stop_loss) {
        results.push({
          event: 'stop_hit',
          key: `stop_hit:${pos.code}`,
          summary: `止损触发：${pos.code} (${pos.name}) 当前价 ${pos.price} ≤ 止损价 ${pos.stop_loss}（as_of: ${state.as_of}）`,
          data: {
            code: pos.code,
            name: pos.name,
            price: pos.price,
            stop_loss: pos.stop_loss,
            as_of: state.as_of,
          },
        })
      }
    }
    return results
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
  concentrationDetector,
  thesisDecayDetector,
]
