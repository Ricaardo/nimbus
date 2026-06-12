/**
 * detectors.test.ts — Unit tests for alert detectors (M6 Batch 1).
 *
 * Uses inline fixture objects so tests are hermetic and fast.
 * No I/O except constructing DetectCtx with a mock Memory object.
 */

import { describe, test, expect } from 'bun:test'
import { stopHitDetector, gainAlertDetector, drawdownDetector, concentrationDetector, thesisDecayDetector } from './detectors.js'
import type { DetectCtx, PortfolioState, Memory } from '../module.js'
import { SINGLE_CONC_PCT, GAIN_ALERT_PCT, DRAWDOWN_PCT } from '../../config.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCtx(state: PortfolioState | null, prices?: Map<string, number>, navHighWater?: number): DetectCtx {
  const memory: Memory = {
    loadPortfolioState: () => state,
    riskProfile: () => '',
    buildContext: () => '',
  }
  return { memory, ...(prices ? { prices } : {}), ...(navHighWater !== undefined ? { navHighWater } : {}) }
}

function basePosition(overrides: Partial<PortfolioState['positions'][0]> = {}): PortfolioState['positions'][0] {
  return {
    code: 'TEST',
    name: 'Test Corp',
    source: 'futu',
    qty: 10,
    avg_cost: 100,
    price: 100,
    mv_usd: 1000,
    pl_pct: 0,
    canon: 'TEST',
    is_option: false,
    underlying: null,
    weight_pct: 10.0,
    thesis: null,
    conviction_score: null,
    thesis_verdict: null,
    stop_loss: null,
    ...overrides,
  }
}

function baseState(overrides: Partial<PortfolioState> = {}): PortfolioState {
  return {
    as_of: new Date().toISOString(),
    nav_usd: 20000,
    cash_usd: 2000,
    cash_pct: 10,
    ibkr_stale: false,
    positions: [],
    reconcile_flags: [],
    ...overrides,
  }
}

// ── stopHitDetector ───────────────────────────────────────────────────────────

describe('stopHitDetector', () => {
  test('returns [] when state is null', () => {
    const result = stopHitDetector.detect(makeCtx(null))
    expect(result).toEqual([])
  })

  test('returns [] when no positions', () => {
    const result = stopHitDetector.detect(makeCtx(baseState()))
    expect(result).toEqual([])
  })

  test('returns [] when price > stop_loss (not hit)', () => {
    const state = baseState({
      positions: [basePosition({ code: 'AVGO', price: 235.0, stop_loss: 200.0 })],
    })
    const result = stopHitDetector.detect(makeCtx(state))
    expect(result).toEqual([])
  })

  test('returns [] when stop_loss is null', () => {
    const state = baseState({
      positions: [basePosition({ code: 'MRVL', price: 50.0, stop_loss: null })],
    })
    const result = stopHitDetector.detect(makeCtx(state))
    expect(result).toEqual([])
  })

  test('fires when price === stop_loss (at exactly stop)', () => {
    const state = baseState({
      positions: [basePosition({ code: 'NOK', name: 'Nokia', price: 12.0, stop_loss: 12.0 })],
    })
    const result = stopHitDetector.detect(makeCtx(state))
    expect(result).toHaveLength(1)
    expect(result[0].event).toBe('stop_hit')
    expect(result[0].key).toBe('stop_hit:NOK')
    expect(result[0].summary).toContain('NOK')
    expect(result[0].summary).toContain('Nokia')
    expect(result[0].summary).toContain('12')
  })

  test('fires when price < stop_loss (below stop)', () => {
    const state = baseState({
      positions: [basePosition({ code: 'MRVL', name: 'Marvell', price: 50.0, stop_loss: 55.0 })],
    })
    const result = stopHitDetector.detect(makeCtx(state))
    expect(result).toHaveLength(1)
    expect(result[0].key).toBe('stop_hit:MRVL')
    expect(result[0].summary).toContain('50')
    expect(result[0].summary).toContain('55')
  })

  test('fires for multiple positions with stop hit', () => {
    const state = baseState({
      positions: [
        basePosition({ code: 'A', price: 90.0, stop_loss: 100.0 }),   // hit
        basePosition({ code: 'B', price: 150.0, stop_loss: 100.0 }),  // not hit
        basePosition({ code: 'C', price: 10.0, stop_loss: 12.0 }),    // hit
      ],
    })
    const result = stopHitDetector.detect(makeCtx(state))
    expect(result).toHaveLength(2)
    expect(result.map(r => r.key)).toContain('stop_hit:A')
    expect(result.map(r => r.key)).toContain('stop_hit:C')
  })

  test('payload data contains expected fields', () => {
    const asOf = '2026-06-07T08:00:00Z'
    const state = baseState({
      as_of: asOf,
      positions: [basePosition({ code: 'XYZ', name: 'XYZ Corp', price: 45.0, stop_loss: 50.0 })],
    })
    const result = stopHitDetector.detect(makeCtx(state))
    expect(result[0].data).toMatchObject({
      code: 'XYZ',
      name: 'XYZ Corp',
      price: 45.0,
      stop_loss: 50.0,
      as_of: asOf,
    })
  })

  test('fresh price overrides snapshot — fires when intraday price breaks stop', () => {
    // Snapshot price (60) is above stop (55) → would NOT fire on stale data.
    const state = baseState({
      positions: [basePosition({ code: 'US.NVDA', name: 'NVDA', price: 60.0, stop_loss: 55.0 })],
    })
    const fresh = new Map([['US.NVDA', 52.0]]) // intraday broke the stop
    const result = stopHitDetector.detect(makeCtx(state, fresh))
    expect(result).toHaveLength(1)
    expect(result[0].summary).toContain('52')
    expect(result[0].summary).toContain('实时价')
    expect(result[0].data).toMatchObject({ price: 52.0 })
  })

  test('fresh price above stop suppresses a stale-snapshot breach', () => {
    // Snapshot (50) below stop (55) but intraday recovered to 58 → no alert.
    const state = baseState({
      positions: [basePosition({ code: 'US.NVDA', price: 50.0, stop_loss: 55.0 })],
    })
    const fresh = new Map([['US.NVDA', 58.0]])
    expect(stopHitDetector.detect(makeCtx(state, fresh))).toEqual([])
  })
})

// ── gainAlertDetector ─────────────────────────────────────────────────────────

describe('gainAlertDetector', () => {
  test('returns [] when state is null', () => {
    expect(gainAlertDetector.detect(makeCtx(null))).toEqual([])
  })

  test('does not fire for a small gain below threshold', () => {
    const state = baseState({
      positions: [basePosition({ code: 'AAA', avg_cost: 100, price: 100 + GAIN_ALERT_PCT - 5 })],
    })
    expect(gainAlertDetector.detect(makeCtx(state))).toEqual([])
  })

  test('fires when unrealized gain ≥ threshold', () => {
    const state = baseState({
      positions: [basePosition({ code: 'NVDA', name: 'Nvidia', avg_cost: 100, price: 145 })],
    })
    const result = gainAlertDetector.detect(makeCtx(state))
    expect(result).toHaveLength(1)
    expect(result[0].event).toBe('gain_alert')
    expect(result[0].summary).toContain('+45')
    expect(result[0].key).toBe('gain_alert:NVDA:25') // band floor(45/25)*25
  })

  test('uses fresh intraday price for the gain calc', () => {
    const state = baseState({
      positions: [basePosition({ code: 'US.NVDA', avg_cost: 100, price: 100 })], // flat on snapshot
    })
    const fresh = new Map([['US.NVDA', 160.0]]) // +60% intraday
    const result = gainAlertDetector.detect(makeCtx(state, fresh))
    expect(result).toHaveLength(1)
    expect(result[0].key).toBe('gain_alert:US.NVDA:50')
  })

  test('explicit take_profit hit fires even below the % threshold', () => {
    const state = baseState({
      positions: [basePosition({ code: 'TGT', avg_cost: 100, price: 110, take_profit: 108 })],
    })
    const result = gainAlertDetector.detect(makeCtx(state))
    expect(result).toHaveLength(1)
    expect(result[0].key).toBe('gain_alert:TGT:tp')
    expect(result[0].summary).toContain('止盈目标')
  })

  test('skips losers and zero-cost positions', () => {
    const state = baseState({
      positions: [
        basePosition({ code: 'LOSS', avg_cost: 100, price: 70 }),
        basePosition({ code: 'ZERO', avg_cost: 0, price: 50 }),
      ],
    })
    expect(gainAlertDetector.detect(makeCtx(state))).toEqual([])
  })
})

// ── drawdownDetector ──────────────────────────────────────────────────────────

describe('drawdownDetector', () => {
  test('returns [] when state is null', () => {
    expect(drawdownDetector.detect(makeCtx(null, undefined, 20000))).toEqual([])
  })

  test('returns [] when no high-water mark yet (first observation)', () => {
    const state = baseState({ nav_usd: 20000 })
    expect(drawdownDetector.detect(makeCtx(state))).toEqual([])
  })

  test('returns [] when NAV is at/above peak', () => {
    const state = baseState({ nav_usd: 21000 })
    expect(drawdownDetector.detect(makeCtx(state, undefined, 20000))).toEqual([])
  })

  test('returns [] for a drawdown below threshold', () => {
    const state = baseState({ nav_usd: 20000 * (1 - (DRAWDOWN_PCT - 2) / 100) })
    expect(drawdownDetector.detect(makeCtx(state, undefined, 20000))).toEqual([])
  })

  test('fires when peak-to-current drawdown ≥ threshold', () => {
    const hwm = 20000
    const nav = hwm * (1 - (DRAWDOWN_PCT + 5) / 100) // ~15% drawdown
    const state = baseState({ nav_usd: nav })
    const result = drawdownDetector.detect(makeCtx(state, undefined, hwm))
    expect(result).toHaveLength(1)
    expect(result[0].event).toBe('drawdown')
    expect(result[0].summary).toContain('回撤')
    expect(result[0].data).toMatchObject({ hwm_usd: hwm })
    // band = floor(15/5)*5 = 15
    expect(result[0].key).toBe('drawdown:15')
  })
})

// ── concentrationDetector ─────────────────────────────────────────────────────

describe('concentrationDetector', () => {
  test('returns [] when state is null', () => {
    const result = concentrationDetector.detect(makeCtx(null))
    expect(result).toEqual([])
  })

  test('returns [] when all positions below single threshold', () => {
    const state = baseState({
      positions: [
        basePosition({ code: 'A', weight_pct: 10.0 }),
        basePosition({ code: 'B', weight_pct: 20.0 }),
        basePosition({ code: 'C', weight_pct: 5.0 }),
      ],
    })
    const result = concentrationDetector.detect(makeCtx(state))
    expect(result).toEqual([])
  })

  test(`fires single-position breach at exactly ${SINGLE_CONC_PCT}%`, () => {
    const state = baseState({
      positions: [basePosition({ code: 'HEAVY', name: 'Heavy Corp', weight_pct: SINGLE_CONC_PCT })],
    })
    const result = concentrationDetector.detect(makeCtx(state))
    const match = result.find(r => r.key === `concentration_breach:single:HEAVY`)
    expect(match).toBeDefined()
    expect(match!.event).toBe('concentration_breach')
    expect(match!.summary).toContain('HEAVY')
  })

  test('fires single-position breach above threshold', () => {
    const state = baseState({
      positions: [basePosition({ code: 'BIG', name: 'Big Co', weight_pct: 30.0 })],
    })
    const result = concentrationDetector.detect(makeCtx(state))
    expect(result.find(r => r.key === 'concentration_breach:single:BIG')).toBeDefined()
  })

  test('does NOT fire for position just below threshold', () => {
    const state = baseState({
      positions: [basePosition({ code: 'SMALL', weight_pct: SINGLE_CONC_PCT - 0.01 })],
    })
    const result = concentrationDetector.detect(makeCtx(state))
    expect(result.find(r => r.key.includes('SMALL'))).toBeUndefined()
  })

  test('fires semis breach when reconcile_flags has SEMI type', () => {
    const state = baseState({
      reconcile_flags: [
        {
          type: '行业集中_SEMI>30%',
          ticker: 'SEMI',
          severity: 'high',
          detail: 'SEMI 合计 41.2% > 30.0%',
        },
      ],
    })
    const result = concentrationDetector.detect(makeCtx(state))
    const semiPayload = result.find(r => r.key === 'concentration_breach:semis')
    expect(semiPayload).toBeDefined()
    expect(semiPayload!.summary).toContain('SEMI')
    expect(semiPayload!.summary).toContain('41.2%')
  })

  test('does NOT fire semis breach when no SEMI flag', () => {
    const state = baseState({
      reconcile_flags: [
        {
          type: '裸仓_无论点',
          ticker: 'MRVL',
          severity: 'medium',
          detail: 'No thesis',
        },
      ],
    })
    const result = concentrationDetector.detect(makeCtx(state))
    expect(result.find(r => r.key === 'concentration_breach:semis')).toBeUndefined()
  })

  test('fires both single and semis when both conditions met', () => {
    const state = baseState({
      positions: [basePosition({ code: 'AVGO', weight_pct: 26.0 })],
      reconcile_flags: [
        { type: '行业集中_SEMI>30%', ticker: 'SEMI', severity: 'high', detail: 'SEMI 合计 41.2% > 30.0%' },
      ],
    })
    const result = concentrationDetector.detect(makeCtx(state))
    expect(result.find(r => r.key === 'concentration_breach:single:AVGO')).toBeDefined()
    expect(result.find(r => r.key === 'concentration_breach:semis')).toBeDefined()
  })

  test('returns [] when no positions and no reconcile_flags', () => {
    const state = baseState()
    const result = concentrationDetector.detect(makeCtx(state))
    expect(result).toEqual([])
  })
})

// ── thesisDecayDetector ───────────────────────────────────────────────────────

describe('thesisDecayDetector', () => {
  test('returns [] when state is null', () => {
    const result = thesisDecayDetector.detect(makeCtx(null))
    expect(result).toEqual([])
  })

  test('returns [] when no positions have thesis', () => {
    const state = baseState({
      positions: [
        basePosition({ code: 'NOTHESIS', thesis: null, thesis_verdict: null }),
      ],
    })
    const result = thesisDecayDetector.detect(makeCtx(state))
    expect(result).toEqual([])
  })

  test('does NOT fire for on_track verdict (recent state)', () => {
    const recentAsOf = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString() // 10 days ago
    const state = baseState({
      as_of: recentAsOf,
      positions: [
        basePosition({ code: 'AVGO', thesis: 'AI moat', thesis_verdict: 'on_track' }),
      ],
    })
    const result = thesisDecayDetector.detect(makeCtx(state))
    expect(result).toEqual([])
  })

  test('does NOT fire for bull_correction verdict (recent state)', () => {
    const recentAsOf = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
    const state = baseState({
      as_of: recentAsOf,
      positions: [
        basePosition({ code: 'MRVL', thesis: 'ASIC moat', thesis_verdict: 'bull_correction' }),
      ],
    })
    const result = thesisDecayDetector.detect(makeCtx(state))
    expect(result).toEqual([])
  })

  test('does NOT fire for null verdict on recent state with thesis', () => {
    const recentAsOf = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
    const state = baseState({
      as_of: recentAsOf,
      positions: [
        basePosition({ code: 'X', thesis: 'some thesis', thesis_verdict: null }),
      ],
    })
    const result = thesisDecayDetector.detect(makeCtx(state))
    expect(result).toEqual([])
  })

  test('fires for decaying verdict', () => {
    const recentAsOf = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
    const state = baseState({
      as_of: recentAsOf,
      positions: [
        basePosition({ code: 'DECAY1', name: 'Decaying Corp', thesis: 'Old thesis', thesis_verdict: 'decaying' }),
      ],
    })
    const result = thesisDecayDetector.detect(makeCtx(state))
    expect(result).toHaveLength(1)
    expect(result[0].key).toBe('thesis_decay:DECAY1')
    expect(result[0].event).toBe('thesis_decay')
    expect(result[0].summary).toContain('DECAY1')
    expect(result[0].summary).toContain('decaying')
  })

  test('fires for broken verdict', () => {
    const recentAsOf = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
    const state = baseState({
      as_of: recentAsOf,
      positions: [
        basePosition({ code: 'BRK', thesis: 'thesis', thesis_verdict: 'broken' }),
      ],
    })
    const result = thesisDecayDetector.detect(makeCtx(state))
    expect(result.find(r => r.key === 'thesis_decay:BRK')).toBeDefined()
  })

  test('fires for thesis_broken verdict', () => {
    const recentAsOf = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
    const state = baseState({
      as_of: recentAsOf,
      positions: [
        basePosition({ code: 'TBK', thesis: 'thesis', thesis_verdict: 'thesis_broken' }),
      ],
    })
    const result = thesisDecayDetector.detect(makeCtx(state))
    expect(result.find(r => r.key === 'thesis_decay:TBK')).toBeDefined()
  })

  test('fires for impaired verdict', () => {
    const recentAsOf = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
    const state = baseState({
      as_of: recentAsOf,
      positions: [
        basePosition({ code: 'IMP', thesis: 'thesis', thesis_verdict: 'impaired' }),
      ],
    })
    const result = thesisDecayDetector.detect(makeCtx(state))
    expect(result.find(r => r.key === 'thesis_decay:IMP')).toBeDefined()
  })

  test('fires for stale as_of (>90 days) even with on_track verdict', () => {
    // 91 days ago
    const staleAsOf = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString()
    const state = baseState({
      as_of: staleAsOf,
      positions: [
        basePosition({ code: 'ZOMBIE', name: 'Zombie Corp', thesis: 'old thesis', thesis_verdict: 'on_track' }),
      ],
    })
    const result = thesisDecayDetector.detect(makeCtx(state))
    expect(result).toHaveLength(1)
    expect(result[0].key).toBe('thesis_decay:ZOMBIE')
    expect(result[0].summary).toContain('90天')
  })

  test('fires for stale as_of even with null verdict', () => {
    const staleAsOf = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString()
    const state = baseState({
      as_of: staleAsOf,
      positions: [
        basePosition({ code: 'STALE', thesis: 'old thesis', thesis_verdict: null }),
      ],
    })
    const result = thesisDecayDetector.detect(makeCtx(state))
    expect(result.find(r => r.key === 'thesis_decay:STALE')).toBeDefined()
  })

  test('skips position without thesis even if stale', () => {
    const staleAsOf = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString()
    const state = baseState({
      as_of: staleAsOf,
      positions: [
        basePosition({ code: 'NOTHESIS', thesis: null, thesis_verdict: 'on_track' }),
      ],
    })
    const result = thesisDecayDetector.detect(makeCtx(state))
    expect(result).toEqual([])
  })

  test('payload data contains code, name, thesis, verdict, as_of', () => {
    const recentAsOf = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
    const state = baseState({
      as_of: recentAsOf,
      positions: [
        basePosition({
          code: 'XYZ',
          name: 'XYZ Inc',
          thesis: 'Growth thesis',
          thesis_verdict: 'decay',
        }),
      ],
    })
    const result = thesisDecayDetector.detect(makeCtx(state))
    expect(result[0].data).toMatchObject({
      code: 'XYZ',
      name: 'XYZ Inc',
      thesis: 'Growth thesis',
      thesis_verdict: 'decay',
    })
  })
})
