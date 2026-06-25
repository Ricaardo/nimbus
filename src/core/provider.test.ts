/**
 * provider.test.ts — Unit tests for provider.ts.
 *
 * Coverage:
 *   - getProvider() default and env-switch behaviour
 *   - DEEPSEEK_MODELS tier→model mapping
 *   - computeCostUsd() numeric accuracy per official price table
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { getProvider, DEEPSEEK_MODELS, DEEPSEEK_PRICE_TABLE, computeCostUsd } from './provider.js'

// ── getProvider ───────────────────────────────────────────────────────────────

describe('getProvider — default (PROVIDER unset)', () => {
  let original: string | undefined

  beforeEach(() => {
    original = process.env.PROVIDER
    delete process.env.PROVIDER
  })

  afterEach(() => {
    if (original === undefined) {
      delete process.env.PROVIDER
    } else {
      process.env.PROVIDER = original
    }
  })

  test('returns "claude" when PROVIDER is not set', () => {
    expect(getProvider()).toBe('claude')
  })
})

describe('getProvider — PROVIDER=deepseek', () => {
  let original: string | undefined

  beforeEach(() => {
    original = process.env.PROVIDER
    process.env.PROVIDER = 'deepseek'
  })

  afterEach(() => {
    if (original === undefined) {
      delete process.env.PROVIDER
    } else {
      process.env.PROVIDER = original
    }
  })

  test('returns "deepseek" when PROVIDER=deepseek', () => {
    expect(getProvider()).toBe('deepseek')
  })

  test('is case-insensitive (DEEPSEEK)', () => {
    process.env.PROVIDER = 'DEEPSEEK'
    expect(getProvider()).toBe('deepseek')
  })
})

describe('getProvider — unknown value falls back to claude', () => {
  let original: string | undefined

  beforeEach(() => {
    original = process.env.PROVIDER
    process.env.PROVIDER = 'openai'
  })

  afterEach(() => {
    if (original === undefined) {
      delete process.env.PROVIDER
    } else {
      process.env.PROVIDER = original
    }
  })

  test('returns "claude" for an unrecognised PROVIDER value', () => {
    expect(getProvider()).toBe('claude')
  })
})

// ── DEEPSEEK_MODELS tier→model mapping ───────────────────────────────────────

describe('DEEPSEEK_MODELS tier mapping', () => {
  test('haiku tier maps to deepseek-v4-flash', () => {
    expect(DEEPSEEK_MODELS.haiku).toBe('deepseek-v4-flash')
  })

  test('sonnet tier maps to deepseek-v4-flash', () => {
    expect(DEEPSEEK_MODELS.sonnet).toBe('deepseek-v4-flash')
  })

  test('opus tier maps to deepseek-v4-pro', () => {
    expect(DEEPSEEK_MODELS.opus).toBe('deepseek-v4-pro')
  })

  test('all tier model strings are non-empty', () => {
    for (const model of Object.values(DEEPSEEK_MODELS)) {
      expect(model.length).toBeGreaterThan(0)
    }
  })
})

// ── DEEPSEEK_PRICE_TABLE structure ───────────────────────────────────────────

describe('DEEPSEEK_PRICE_TABLE', () => {
  test('contains an entry for deepseek-v4-flash', () => {
    expect(DEEPSEEK_PRICE_TABLE['deepseek-v4-flash']).toBeDefined()
  })

  test('contains an entry for deepseek-v4-pro', () => {
    expect(DEEPSEEK_PRICE_TABLE['deepseek-v4-pro']).toBeDefined()
  })

  test('deepseek-v4-flash official prices (2026-06-25)', () => {
    const p = DEEPSEEK_PRICE_TABLE['deepseek-v4-flash']!
    expect(p.input).toBeCloseTo(0.14, 6)
    expect(p.cacheRead).toBeCloseTo(0.0028, 6)
    expect(p.output).toBeCloseTo(0.28, 6)
  })

  test('deepseek-v4-pro official prices (2026-06-25)', () => {
    const p = DEEPSEEK_PRICE_TABLE['deepseek-v4-pro']!
    expect(p.input).toBeCloseTo(0.435, 6)
    expect(p.cacheRead).toBeCloseTo(0.003625, 6)
    expect(p.output).toBeCloseTo(0.87, 6)
  })

  test('all entries have positive input, cacheRead, output prices', () => {
    for (const p of Object.values(DEEPSEEK_PRICE_TABLE)) {
      expect(p.input).toBeGreaterThan(0)
      expect(p.cacheRead).toBeGreaterThan(0)
      expect(p.output).toBeGreaterThan(0)
    }
  })
})

// ── computeCostUsd — deepseek-v4-flash (haiku/sonnet tier) ───────────────────
// Official prices: input=$0.14/M, cacheRead=$0.0028/M, output=$0.28/M

describe('computeCostUsd — deepseek-v4-flash', () => {
  test('zero tokens → $0.00', () => {
    const cost = computeCostUsd('deepseek-v4-flash', { inputTokens: 0, cacheReadTokens: 0, outputTokens: 0 })
    expect(cost).toBe(0)
  })

  test('1M pure non-cached input tokens → $0.14', () => {
    // inputTokens=1M, cacheReadTokens=0 → nonCachedInput=1M
    const cost = computeCostUsd('deepseek-v4-flash', { inputTokens: 1_000_000, cacheReadTokens: 0, outputTokens: 0 })
    expect(cost).toBeCloseTo(0.14, 6)
  })

  test('1M cache-read tokens → $0.0028', () => {
    // inputTokens=1M (includes cacheRead), cacheRead=1M → nonCachedInput=0
    const cost = computeCostUsd('deepseek-v4-flash', { inputTokens: 1_000_000, cacheReadTokens: 1_000_000, outputTokens: 0 })
    expect(cost).toBeCloseTo(0.0028, 6)
  })

  test('1M output tokens → $0.28', () => {
    const cost = computeCostUsd('deepseek-v4-flash', { inputTokens: 0, cacheReadTokens: 0, outputTokens: 1_000_000 })
    expect(cost).toBeCloseTo(0.28, 6)
  })

  test('mixed tokens: 100K input + 80K cache-read + 10K output', () => {
    // nonCachedInput = 100K - 80K = 20K
    // cost = (20K * 0.14 + 80K * 0.0028 + 10K * 0.28) / 1M
    const expected = (20_000 * 0.14 + 80_000 * 0.0028 + 10_000 * 0.28) / 1_000_000
    const cost = computeCostUsd('deepseek-v4-flash', { inputTokens: 100_000, cacheReadTokens: 80_000, outputTokens: 10_000 })
    expect(cost).toBeCloseTo(expected, 9)
  })
})

// ── computeCostUsd — deepseek-v4-pro (opus tier) ─────────────────────────────
// Official prices: input=$0.435/M, cacheRead=$0.003625/M, output=$0.87/M

describe('computeCostUsd — deepseek-v4-pro', () => {
  test('1M non-cached input tokens → $0.435', () => {
    const cost = computeCostUsd('deepseek-v4-pro', { inputTokens: 1_000_000, cacheReadTokens: 0, outputTokens: 0 })
    expect(cost).toBeCloseTo(0.435, 6)
  })

  test('1M cache-read tokens → $0.003625', () => {
    const cost = computeCostUsd('deepseek-v4-pro', { inputTokens: 1_000_000, cacheReadTokens: 1_000_000, outputTokens: 0 })
    expect(cost).toBeCloseTo(0.003625, 6)
  })

  test('1M output tokens → $0.87', () => {
    const cost = computeCostUsd('deepseek-v4-pro', { inputTokens: 0, cacheReadTokens: 0, outputTokens: 1_000_000 })
    expect(cost).toBeCloseTo(0.87, 6)
  })

  test('matches price table entry for opus model constant', () => {
    // The DEEPSEEK_MODELS.opus string must have a price table entry —
    // otherwise cost tracking silently uses the fallback (wrong model, wrong price).
    const opusModel = DEEPSEEK_MODELS.opus
    expect(DEEPSEEK_PRICE_TABLE[opusModel]).toBeDefined()
  })
})

// ── computeCostUsd — edge cases ───────────────────────────────────────────────

describe('computeCostUsd — unknown model falls back gracefully', () => {
  test('unrecognised model string → positive cost (non-zero fallback)', () => {
    const cost = computeCostUsd('deepseek-unknown-model-xyz', { inputTokens: 1_000_000, cacheReadTokens: 0, outputTokens: 0 })
    // Fallback uses pro prices (input=$0.435/M) so result should be positive.
    expect(cost).toBeGreaterThan(0)
  })
})

describe('computeCostUsd — cacheReadTokens cannot exceed inputTokens', () => {
  test('clamps nonCachedInput to 0 when cacheRead > input (defensive)', () => {
    // Should not produce a negative cost even with malformed SDK data
    const cost = computeCostUsd('deepseek-v4-flash', { inputTokens: 100, cacheReadTokens: 200, outputTokens: 0 })
    expect(cost).toBeGreaterThanOrEqual(0)
  })
})
