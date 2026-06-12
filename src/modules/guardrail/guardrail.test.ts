/**
 * guardrail.test.ts — Unit tests for the P0 behaviour guardrail.
 */

import { describe, test, expect } from 'bun:test'
import { detect } from './index.js'

// ── Positive matches ──────────────────────────────────────────────────────────

describe('detect: trigger keywords return non-null instruction', () => {
  const cases: Array<[string, string]> = [
    ['满仓买入', '满仓'],
    ['all in NVDA', 'all in'],
    ['梭哈半导体', '梭哈'],
    ['想加杠杆', '加杠杆'],
    ['杠杆ETF怎么选', '杠杆ETF'],
    ['TQQQ还能买吗', 'TQQQ'],
    ['SOXL抄底机会', 'SOXL'],
    ['SOXS做空', 'SOXS'],
    ['UPRO还是SPXL', 'UPRO'],
    ['TSLL好久没看了', 'TSLL'],
    ['接飞刀风险高吗', '接飞刀'],
    ['抄底时机到了吗', '抄底'],
    ['越跌越买是对的', '越跌越买'],
    ['该补仓了', '补仓'],
    ['逆势操作', '逆势'],
    ['反手做多', '反手'],
    ['割肉止损', '割肉'],
    ['清仓离场', '清仓'],
    ['认输了', '认输'],
    ['投降式止损', '投降'],
    ['3x杠杆产品', '3x'],
    ['2X收益基金', '2X'],
  ]

  for (const [content, label] of cases) {
    test(`"${label}" triggers guardrail`, () => {
      const result = detect(content)
      expect(result).not.toBeNull()
    })
  }
})

// ── Instruction content checks ────────────────────────────────────────────────

describe('detect: instruction content', () => {
  test('framed as strong-reminder, not dogma', () => {
    const result = detect('想抄底 SOXL')
    expect(result).toContain('强提醒')
    expect(result).toContain('别教条')
  })

  test('contains 弱点 keyword', () => {
    const result = detect('满仓进场')
    expect(result).toContain('弱点')
  })

  test('contains 右侧确认 keyword', () => {
    const result = detect('接飞刀感觉要反了')
    expect(result).toContain('右侧确认')
  })

  test('reminds about emotional reversal for capitulation content', () => {
    const result = detect('割肉了之后反手做空')
    expect(result).toContain('情绪')
  })

  test('mentions real-position check (futu)', () => {
    const result = detect('梭哈半导体')
    expect(result).toContain('futu')
  })
})

// ── Leverage clause date-awareness ────────────────────────────────────────────

describe('detect: date-aware leverage clause', () => {
  test('leverage hit cites evidence (historical cost / SOXL)', () => {
    const result = detect('SOXL还能买吗')
    expect(result).not.toBeNull()
    const hasEvidence = result!.includes('历史代价') || result!.includes('SOXL')
    expect(hasEvidence).toBe(true)
  })

  test('leverage hit includes decay warning', () => {
    const result = detect('TQQQ怎么样')
    expect(result).toContain('decay')
  })
})

// ── Negative: clean messages return null ─────────────────────────────────────

describe('detect: clean messages return null', () => {
  const clean: string[] = [
    'NVDA 怎么样',
    '帮我分析一下苹果的基本面',
    '市场今天走势如何',
    '半导体板块最近表现',
    '请做一下 DCF 估值',
    '腾讯 Q3 财报分析',
    '今天有什么财经新闻',
    '帮我看一下组合偏离',
    'BTC 价格',
  ]

  for (const content of clean) {
    test(`"${content}" returns null`, () => {
      expect(detect(content)).toBeNull()
    })
  }
})
