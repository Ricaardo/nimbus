/**
 * chunk.test.ts — Unit tests for the shared chunk helper.
 * After extraction from discord/outbound.ts, the logic must behave identically
 * whether imported from shared/chunk.ts or re-exported via discord/outbound.ts.
 */

import { describe, test, expect } from 'bun:test'
import { chunk } from './chunk.js'

describe('chunk (shared)', () => {
  test('returns single-element array when text fits within limit', () => {
    expect(chunk('hello', 4096, 'length')).toEqual(['hello'])
    expect(chunk('hello', 5, 'length')).toEqual(['hello'])
  })

  test('hard-splits at limit in length mode', () => {
    const text = 'a'.repeat(10)
    const parts = chunk(text, 4, 'length')
    expect(parts).toHaveLength(3)
    expect(parts[0]).toBe('aaaa')
    expect(parts[1]).toBe('aaaa')
    expect(parts[2]).toBe('aa')
  })

  test('prefers paragraph break in newline mode', () => {
    // 'aaaa\n\nbbbbbb' — limit=6; para break at index 4, which is > 6/2=3 → split at 4.
    // The cut is at index 4 (before '\n\n'), remainder '\n\nbbbbbb' → strip leading \n → 'bbbbbb'
    const text = 'aaaa\n\nbbbbbb'
    const parts = chunk(text, 6, 'newline')
    expect(parts[0]).toBe('aaaa')
    expect(parts[1]).toBe('bbbbbb')
  })

  test('falls back to line break when no paragraph break', () => {
    // 'aaaa\nbbbbbb' — limit=6; no para break, line break at index 4 > 6/2=3 → split at 4
    const text = 'aaaa\nbbbbbb'
    const parts = chunk(text, 6, 'newline')
    expect(parts[0]).toBe('aaaa')
    expect(parts[1]).toBe('bbbbbb')
  })

  test('falls back to space when no line break', () => {
    // 'aaa bbbb' — limit=6; space at index 3 > 0 → cut there; rest = ' bbbb' → stripped? No.
    // The code strips only LEADING \n+, not spaces. So remainder has the space.
    // To get 'aaa' and 'bbbb', we need limit ≤ 7 so that cut=3 (space at idx 3).
    const text = 'aaa bbbb'
    const parts = chunk(text, 7, 'newline')
    expect(parts[0]).toBe('aaa')
    // remainder after slice(3) = ' bbbb' — replace(/^\n+/,'') only strips newlines
    expect(parts[1]).toBe(' bbbb')
  })

  test('4096-char limit: text exactly at limit stays in one chunk', () => {
    const text = 'x'.repeat(4096)
    expect(chunk(text, 4096, 'length')).toHaveLength(1)
  })

  test('4096-char limit: text over limit splits into two chunks', () => {
    const text = 'x'.repeat(4097)
    const parts = chunk(text, 4096, 'length')
    expect(parts).toHaveLength(2)
    expect(parts[0]!.length).toBe(4096)
    expect(parts[1]!.length).toBe(1)
  })

  test('empty string returns single empty chunk', () => {
    expect(chunk('', 100, 'length')).toEqual([''])
  })

  test('strips leading newlines from remainder after cut', () => {
    const text = 'aaaa\n\n\nbbbb'
    const parts = chunk(text, 6, 'newline')
    // After cut at para break, rest is stripped of leading newlines → 'bbbb'
    expect(parts[parts.length - 1]).toBe('bbbb')
  })
})
