/**
 * router.test.ts — Unit tests for classify() (M7).
 */

import { describe, test, expect } from 'bun:test'
import { classify } from './router.js'

describe('classify — L0 quote tier', () => {
  test('pure price request with US ticker → quote + symbol', () => {
    const r = classify('NVDA 现价多少')
    expect(r.tier).toBe('quote')
    expect(r.symbols).toContain('US.NVDA')
  })

  test('英文price keyword + ticker → quote', () => {
    const r = classify('AAPL price?')
    expect(r.tier).toBe('quote')
    expect(r.symbols).toContain('US.AAPL')
  })

  test('行情关键词 + HK code → quote', () => {
    const r = classify('00700 行情怎样')
    expect(r.tier).toBe('quote')
    expect(r.symbols).toContain('HK.00700')
  })

  test('涨跌 keyword + ticker → quote', () => {
    const r = classify('TSLA 涨了多少')
    expect(r.tier).toBe('quote')
    expect(r.symbols).toContain('US.TSLA')
  })

  test('quote keyword but unresolvable name → sonnet downgrade', () => {
    const r = classify('这家公司股价多少')
    expect(r.tier).toBe('sonnet')
    expect(r.symbols).toHaveLength(0)
  })

  test('quote keyword + known Chinese name → quote (NAME_MAP)', () => {
    const r = classify('腾讯股价多少')
    expect(r.tier).toBe('quote')
    expect(r.symbols).toContain('HK.00700')
  })

  test('quote keyword no symbol at all → sonnet', () => {
    const r = classify('最近行情怎么样')
    expect(r.tier).toBe('sonnet')
  })
})

describe('classify — bare ticker (no keyword) → quote', () => {
  test('bare US ticker → quote', () => {
    const r = classify('NVDA')
    expect(r.tier).toBe('quote')
    expect(r.symbols).toContain('US.NVDA')
  })

  test('bare known Chinese name → quote', () => {
    const r = classify('腾讯')
    expect(r.tier).toBe('quote')
    expect(r.symbols).toContain('HK.00700')
  })

  test('bare HK digit code → quote', () => {
    const r = classify('00700')
    expect(r.tier).toBe('quote')
    expect(r.symbols).toContain('HK.00700')
  })

  test('filler + ticker stays bare → quote', () => {
    const r = classify('查下 AAPL')
    expect(r.tier).toBe('quote')
    expect(r.symbols).toContain('US.AAPL')
  })

  test('multiple bare tickers → quote with all symbols', () => {
    const r = classify('NVDA AAPL')
    expect(r.tier).toBe('quote')
    expect(r.symbols).toContain('US.NVDA')
    expect(r.symbols).toContain('US.AAPL')
  })

  test('ticker + real question does NOT hijack to quote', () => {
    const r = classify('NVDA 怎么样')
    expect(r.tier).not.toBe('quote')
  })

  test('ticker + depth word still wins to opus', () => {
    const r = classify('NVDA 分析')
    expect(r.tier).toBe('opus')
  })

  test('all-caps English chit-chat does NOT hijack to quote', () => {
    for (const word of ['OK', 'NO', 'ALL', 'ARE', 'IT', 'AI', 'YES', 'ALL GOOD', 'I DO']) {
      expect(classify(word).tier).not.toBe('quote')
    }
  })

  test('explicit quote keyword overrides stopword guard (ON 股价 → quote)', () => {
    const r = classify('ON 股价')
    expect(r.tier).toBe('quote')
    expect(r.symbols).toContain('US.ON')
  })

  test('real ticker that is not a stopword still routes to quote', () => {
    expect(classify('TSM').tier).toBe('quote')
  })
})

describe('classify — L2 opus tier', () => {
  test('分析 keyword → opus', () => {
    const r = classify('NVDA 深度分析一下')
    expect(r.tier).toBe('opus')
    expect(r.symbols).toHaveLength(0)
  })

  test('估值 keyword → opus', () => {
    const r = classify('AAPL 估值如何')
    expect(r.tier).toBe('opus')
  })

  test('该不该买 → opus', () => {
    const r = classify('NVDA 该不该买')
    expect(r.tier).toBe('opus')
  })

  test('要不要卖 → opus', () => {
    const r = classify('TSLA 要不要卖')
    expect(r.tier).toBe('opus')
  })

  test('组合 portfolio keyword → opus', () => {
    const r = classify('我的portfolio怎么调整')
    expect(r.tier).toBe('opus')
  })

  test('仓位 keyword → opus', () => {
    const r = classify('当前仓位风险如何')
    expect(r.tier).toBe('opus')
  })

  test('regime keyword → opus', () => {
    const r = classify('当前市场regime是什么')
    expect(r.tier).toBe('opus')
  })

  test('valuation English keyword → opus', () => {
    const r = classify('run a valuation on AAPL')
    expect(r.tier).toBe('opus')
  })

  test('DCF keyword → opus', () => {
    const r = classify('做个DCF看看')
    expect(r.tier).toBe('opus')
  })

  test('怎么看 → opus (light question with depth tag)', () => {
    const r = classify('NVDA 怎么看')
    expect(r.tier).toBe('opus')
  })
})

describe('classify — bias-up: quote + depth words → opus', () => {
  test('quote + 分析 mixed → opus wins', () => {
    const r = classify('NVDA 股价和分析')
    expect(r.tier).toBe('opus')
  })

  test('price + 估值 mixed → opus wins', () => {
    const r = classify('AAPL price and valuation comparison')
    expect(r.tier).toBe('opus')
  })
})

describe('classify — L1 sonnet default', () => {
  test('casual greeting → haiku (P0 cheap lane)', () => {
    const r = classify('你好，今天怎么样')
    expect(r.tier).toBe('haiku')
    expect(r.symbols).toHaveLength(0)
  })

  test('substantive light question (no casual word) → sonnet', () => {
    const r = classify('今天有什么市场新闻')
    expect(r.tier).toBe('sonnet')
  })

  test('news request → sonnet', () => {
    const r = classify('今天有什么市场新闻')
    expect(r.tier).toBe('sonnet')
  })

  test('note taking request → sonnet', () => {
    const r = classify('帮我记个笔记：NVDA止损380')
    expect(r.tier).toBe('sonnet')
  })

  test('simple X怎么样 (without 怎么看 = no depth word) → sonnet', () => {
    // 怎么样 is NOT in depth words (only 怎么看 is)
    const r = classify('NVDA 怎么样')
    expect(r.tier).toBe('sonnet')
  })

  test('empty string → sonnet', () => {
    const r = classify('')
    expect(r.tier).toBe('sonnet')
    expect(r.symbols).toHaveLength(0)
  })
})
