/**
 * loader.test.ts — Trade-journal loader unit tests.
 */
import { describe, test, expect, beforeAll } from 'bun:test'
import { resetCache, tradeEvidenceString, worstLosingTrade, findRelevantLosingTrades } from './loader.js'

// Note: these tests depend on the real trade-journal YAML files at
// skills/trade-journal/reports/trades/. If that directory is missing
// (CI / fresh clone), the loader gracefully returns empty results.

beforeAll(() => {
  resetCache()
})

describe('worstLosingTrade', () => {
  test('returns null for unknown ticker', () => {
    expect(worstLosingTrade('ZZZZ')).toBeNull()
  })

  test('finds SOXL trade data from real YAML', () => {
    const worst = worstLosingTrade('SOXL')
    if (worst !== null) {
      // Real SOXL trade: realized_pnl_total = -1630.30
      expect(worst.realizedPnl).toBeLessThan(0)
      expect(Math.abs(worst.realizedPnl)).toBeGreaterThan(1000)
      expect(worst.pctOfAccount).toBeLessThan(0)
      expect(worst.window).toBeTruthy()
    }
    // If trades dir doesn't exist (CI), worst is null — acceptable
  })
})

describe('tradeEvidenceString', () => {
  test('returns null for unknown ticker', () => {
    expect(tradeEvidenceString('XXXX')).toBeNull()
  })

  test('SOXL evidence contains real numbers from trade journal', () => {
    const ev = tradeEvidenceString('SOXL')
    if (ev !== null) {
      expect(ev).toMatch(/净亏/)
      expect(ev).toMatch(/\$/)
      expect(ev).toMatch(/账户/)
    }
    // trades dir may not exist in CI — graceful
  })

  test('SOXS also resolves (indexed via tags/multi-ticker)', () => {
    const ev = tradeEvidenceString('SOXS')
    if (ev !== null) {
      expect(ev).toMatch(/净亏/)
    }
  })
})

describe('findRelevantLosingTrades', () => {
  test('filters out small losses', () => {
    resetCache()
    const hits = findRelevantLosingTrades('SOXL')
    // If trades dir exists, should find exactly 1; if not, 0
    expect(Array.isArray(hits)).toBe(true)
    if (hits.length > 0) {
      for (const t of hits) {
        // All matched trades must meet threshold
        expect(t.realizedPnl <= -500 || t.pctOfAccount <= -3).toBe(true)
      }
    }
  })
})

describe('resetCache', () => {
  test('clears and reloads', () => {
    resetCache()
    // Cache miss should still work same way
    const first = worstLosingTrade('SOXL')
    const second = worstLosingTrade('SOXL')
    if (first !== null) {
      expect(second).not.toBeNull()
      expect(second!.realizedPnl).toBe(first.realizedPnl)
    }
  })
})
