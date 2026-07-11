import { describe, test, expect } from 'bun:test'
import { decisionTrackerModules, evaluateDecision, shouldBackfillPrice, type TrackedDecision } from './index.js'

const NOW = Date.parse('2026-07-11T12:00:00Z')

function mkDecision(overrides: Partial<TrackedDecision> = {}): TrackedDecision {
  return {
    id: 1,
    ts: NOW,
    symbol: 'NVDA',
    direction: 'buy',
    price_at_decision: null,
    target: null,
    stop: null,
    ...overrides,
  }
}

describe('decision-tracker module shape', () => {
  test('is a cron module targeting REPORT_DM', () => {
    const m = decisionTrackerModules[0]!
    expect(m.name).toBe('decision:track')
    expect(typeof m.cron).toBe('string')
    expect(typeof m.targetChat).toBe('string')
  })
})

describe('evaluateDecision — buy', () => {
  test('target-hit → win', () => {
    const d = mkDecision({ direction: 'buy', price_at_decision: 100, target: 120, stop: 90 })
    const r = evaluateDecision(d, 121, NOW)
    expect(r).not.toBeNull()
    expect(r!.outcome).toContain('win')
    expect(r!.outcome).toContain('+21.0%')
    expect(r!.outcome).toContain('target-hit')
  })
  test('stop-hit → loss', () => {
    const d = mkDecision({ direction: 'buy', price_at_decision: 100, target: 120, stop: 90 })
    const r = evaluateDecision(d, 89, NOW)
    expect(r).not.toBeNull()
    expect(r!.outcome).toContain('loss')
    expect(r!.outcome).toContain('-11.0%')
    expect(r!.outcome).toContain('stop-hit')
  })
  test('between levels → no-op', () => {
    const d = mkDecision({ direction: 'buy', price_at_decision: 100, target: 120, stop: 90 })
    expect(evaluateDecision(d, 105, NOW)).toBeNull()
  })
  test('missing price_at_decision → outcome omits pct part', () => {
    const d = mkDecision({ direction: 'buy', price_at_decision: null, target: 120, stop: 90 })
    const r = evaluateDecision(d, 125, NOW)
    expect(r).not.toBeNull()
    expect(r!.outcome).toBe(`auto: win target-hit ${new Date(NOW + 8 * 3600_000).toISOString().slice(0, 10)}`)
  })
})

describe('evaluateDecision — sell (symmetric)', () => {
  test('target-hit (price drops to/below target) → win', () => {
    const d = mkDecision({ direction: 'sell', price_at_decision: 100, target: 80, stop: 110 })
    const r = evaluateDecision(d, 79, NOW)
    expect(r!.outcome).toContain('win')
    expect(r!.outcome).toContain('target-hit')
  })
  test('target-hit pct sign reads from the short perspective (price fell → positive pct)', () => {
    const d = mkDecision({ direction: 'sell', price_at_decision: 100, target: 80, stop: 110 })
    const r = evaluateDecision(d, 79, NOW)
    // Raw price move is -21% (100→79); a short profits on a price drop, so the
    // reported pct must read as a gain (+), not the raw negative price delta.
    expect(r!.outcome).toContain('+21.0%')
  })
  test('stop-hit (price rises to/above stop) → loss', () => {
    const d = mkDecision({ direction: 'sell', price_at_decision: 100, target: 80, stop: 110 })
    const r = evaluateDecision(d, 111, NOW)
    expect(r!.outcome).toContain('loss')
    expect(r!.outcome).toContain('stop-hit')
  })
  test('between levels → no-op', () => {
    const d = mkDecision({ direction: 'sell', price_at_decision: 100, target: 80, stop: 110 })
    expect(evaluateDecision(d, 95, NOW)).toBeNull()
  })
})

describe('evaluateDecision — hold (only stop applies)', () => {
  test('price at/below stop → neutral stop-hit (no win/loss word)', () => {
    const d = mkDecision({ direction: 'hold', price_at_decision: 100, target: null, stop: 90 })
    const r = evaluateDecision(d, 88, NOW)
    expect(r).not.toBeNull()
    expect(r!.outcome).toContain('stop-hit')
    expect(r!.outcome).not.toContain('win')
    expect(r!.outcome).not.toContain('loss')
  })
  test('price above stop → no-op', () => {
    const d = mkDecision({ direction: 'hold', price_at_decision: 100, target: null, stop: 90 })
    expect(evaluateDecision(d, 95, NOW)).toBeNull()
  })
})

describe('evaluateDecision — age settlement (no target/stop)', () => {
  const OLD_TS = NOW - 31 * 86_400_000
  test('>30d with snapshot, buy, price up → win 30d-settle', () => {
    const d = mkDecision({ ts: OLD_TS, direction: 'buy', price_at_decision: 100, target: null, stop: null })
    const r = evaluateDecision(d, 110, NOW)
    expect(r).not.toBeNull()
    expect(r!.outcome).toContain('win')
    expect(r!.outcome).toContain('30d-settle')
  })
  test('>30d with snapshot, buy, price down → loss', () => {
    const d = mkDecision({ ts: OLD_TS, direction: 'buy', price_at_decision: 100, target: null, stop: null })
    const r = evaluateDecision(d, 90, NOW)
    expect(r!.outcome).toContain('loss')
  })
  test('>30d with snapshot, sell, inverted', () => {
    const d = mkDecision({ ts: OLD_TS, direction: 'sell', price_at_decision: 100, target: null, stop: null })
    expect(evaluateDecision(d, 90, NOW)!.outcome).toContain('win')
    expect(evaluateDecision(d, 110, NOW)!.outcome).toContain('loss')
  })
  test('>30d with snapshot, hold → expired', () => {
    const d = mkDecision({ ts: OLD_TS, direction: 'hold', price_at_decision: 100, target: null, stop: null })
    expect(evaluateDecision(d, 105, NOW)!.outcome).toContain('expired')
  })
  test('<30d → no-op even with snapshot', () => {
    const d = mkDecision({ ts: NOW - 10 * 86_400_000, direction: 'buy', price_at_decision: 100, target: null, stop: null })
    expect(evaluateDecision(d, 130, NOW)).toBeNull()
  })
  test('>30d but no price_at_decision snapshot → no-op (can’t judge direction)', () => {
    const d = mkDecision({ ts: OLD_TS, direction: 'buy', price_at_decision: null, target: null, stop: null })
    expect(evaluateDecision(d, 130, NOW)).toBeNull()
  })
})

describe('evaluateDecision — unknown direction is conservative (treated as hold)', () => {
  test('unknown direction + stop only → still evaluated as hold', () => {
    const d = mkDecision({ direction: 'weird-unknown', price_at_decision: 100, target: null, stop: 90 })
    expect(evaluateDecision(d, 85, NOW)!.outcome).toContain('stop-hit')
  })
  test('unknown direction + target only (no stop) → no-op (target ignored for hold)', () => {
    const d = mkDecision({ direction: 'weird-unknown', price_at_decision: 100, target: 120, stop: null })
    expect(evaluateDecision(d, 130, NOW)).toBeNull()
  })
})

describe('evaluateDecision — fresh real-world-shaped open decision never auto-closes', () => {
  test('no target/stop, no price snapshot, <30d old → null (acceptance guard)', () => {
    const d = mkDecision({ ts: NOW - 5 * 86_400_000, direction: 'buy', price_at_decision: null, target: null, stop: null })
    expect(evaluateDecision(d, 145.2, NOW)).toBeNull()
  })
})

describe('shouldBackfillPrice (48h guard)', () => {
  test('null snapshot + age < 48h → true', () => {
    expect(shouldBackfillPrice({ price_at_decision: null, ts: NOW - 3600_000 }, NOW)).toBe(true)
  })
  test('null snapshot + age > 48h → false', () => {
    expect(shouldBackfillPrice({ price_at_decision: null, ts: NOW - 72 * 3600_000 }, NOW)).toBe(false)
  })
  test('existing snapshot → false regardless of age', () => {
    expect(shouldBackfillPrice({ price_at_decision: 100, ts: NOW - 3600_000 }, NOW)).toBe(false)
  })
})
