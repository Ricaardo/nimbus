/**
 * disclaimer.test.ts — Unit tests for shouldAppend and maybeAppendDisclaimer (M6 Batch 1).
 */

import { describe, test, expect } from 'bun:test'
import { shouldAppend, maybeAppendDisclaimer, DISCLAIMER } from './disclaimer.js'

// ── shouldAppend: investment text → true ──────────────────────────────────────

describe('shouldAppend: investment text returns true', () => {
  test('text with US ticker returns true', () => {
    expect(shouldAppend('AVGO 最近下跌了很多，要不要买入？')).toBe(true)
  })

  test('text with multiple US tickers', () => {
    expect(shouldAppend('对比 MRVL 和 AVGO 哪个更好')).toBe(true)
  })

  test('text with 买入 keyword returns true', () => {
    expect(shouldAppend('现在可以考虑买入这只股票')).toBe(true)
  })

  test('text with 卖出 keyword returns true', () => {
    expect(shouldAppend('建议卖出部分持仓减少风险')).toBe(true)
  })

  test('text with 止损 keyword returns true', () => {
    expect(shouldAppend('建议把止损设在200元')).toBe(true)
  })

  test('text with 目标价 returns true', () => {
    expect(shouldAppend('目标价 500 元，上涨空间 30%')).toBe(true)
  })

  test('text with 仓位 returns true', () => {
    expect(shouldAppend('当前仓位过于集中需要分散')).toBe(true)
  })

  test('text with 加仓 returns true', () => {
    expect(shouldAppend('可以考虑加仓')).toBe(true)
  })

  test('text with 减仓 returns true', () => {
    expect(shouldAppend('建议减仓半导体板块')).toBe(true)
  })

  test('text with PE ratio mention returns true', () => {
    expect(shouldAppend('当前PE估值偏高，建议谨慎')).toBe(true)
  })

  test('text with 估值 returns true', () => {
    expect(shouldAppend('这只股票估值很高')).toBe(true)
  })

  test('text with A-share 4-digit code returns true', () => {
    expect(shouldAppend('600036 招商银行今天表现不错')).toBe(true)
  })

  test('text with 做多 returns true', () => {
    expect(shouldAppend('可以在这个位置做多')).toBe(true)
  })

  test('text with 做空 returns true', () => {
    expect(shouldAppend('趋势转弱可以做空')).toBe(true)
  })

  test('investment analysis text with ticker and verdict', () => {
    expect(shouldAppend('AVGO 止损触发，建议执行卖出操作，参考价格 380 USD')).toBe(true)
  })
})

// ── shouldAppend: casual text → false ────────────────────────────────────────

describe('shouldAppend: casual text returns false', () => {
  test('plain greeting returns false', () => {
    expect(shouldAppend('你好')).toBe(false)
  })

  test('hi returns false', () => {
    expect(shouldAppend('hi')).toBe(false)
  })

  test('OK returns false', () => {
    expect(shouldAppend('OK')).toBe(false)
  })

  test('谢谢 returns false', () => {
    expect(shouldAppend('谢谢')).toBe(false)
  })

  test('感谢 returns false', () => {
    expect(shouldAppend('感谢')).toBe(false)
  })

  test('short laugh returns false', () => {
    expect(shouldAppend('哈哈')).toBe(false)
  })
})

// ── maybeAppendDisclaimer ─────────────────────────────────────────────────────

describe('maybeAppendDisclaimer', () => {
  test('appends disclaimer to investment text', () => {
    const text = 'AVGO 建议止损在 350 USD'
    const result = maybeAppendDisclaimer(text)
    expect(result).toContain(text)
    expect(result).toContain(DISCLAIMER)
    expect(result.endsWith(DISCLAIMER)).toBe(true)
  })

  test('does NOT append disclaimer to casual text', () => {
    const text = '你好'
    const result = maybeAppendDisclaimer(text)
    expect(result).toBe(text)
    expect(result).not.toContain(DISCLAIMER)
  })

  test('separator is two newlines before disclaimer', () => {
    const text = 'MRVL 止损建议'
    const result = maybeAppendDisclaimer(text)
    expect(result).toContain(`${text}\n\n${DISCLAIMER}`)
  })
})
