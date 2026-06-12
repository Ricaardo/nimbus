/**
 * router.ts — Intent classifier for the three-tier routing model (M7).
 *
 * Tiers:
 *  - quote  (L0): Pure price-check intent + extractable symbol(s), no deep words.
 *  - opus   (L2): Deep analysis intent (分析, 估值, 该不该买/卖, portfolio, etc.)
 *  - sonnet (L1): Default / fallback (chat, news, light questions, note-taking, etc.)
 *
 * Bias-up rules:
 *  - quote + opus overlap → opus (deep wins over quote).
 *  - quote intent but no extractable symbols → sonnet (let agent parse Chinese names).
 *
 * Pure function — no I/O, no side effects.  Fully unit-testable.
 */

import { extractSymbols } from './symbol.js'

export type Tier = 'quote' | 'haiku' | 'sonnet' | 'opus'

export interface ClassifyResult {
  tier: Tier
  symbols: string[]
}

// ── Keyword sets ──────────────────────────────────────────────────────────────

/** L0 quote-intent keywords (Chinese + English). */
const QUOTE_WORDS = [
  '报价', '行情', '价格', '股价', '现价', '多少钱',
  '涨跌', '跌了多少', '涨了多少', '涨了', '跌了',
  'quote', 'price',
]

/** L2 depth-intent keywords (Chinese + English). */
const DEPTH_WORDS = [
  '分析', '深度', '估值', 'valuation', 'DCF', 'dcf',
  '该不该', '要不要买', '要不要卖', '加仓', '减仓', '清仓',
  '研报', '复盘', '组合', 'portfolio', '仓位',
  '风险', '集中度', 'scenario', '场景', 'regime',
  '牛熊', '论点', 'thesis', '前景', '后市', '对比', 'compare',
  '怎么看',
]

/** L-Haiku casual / low-judgment keywords: greetings, acks, note-ops, chitchat.
 *  Only routed to Haiku when NO symbol and NO depth/quote intent present. */
const CASUAL_WORDS = [
  '你好', '哈喽', 'hi', 'hello', 'hey', '在吗', '在么', '早', '早上好', '晚安', '午安',
  '谢谢', '谢啦', 'thanks', 'thank', '辛苦', '好的', '收到', '嗯', '哈哈', 'ok', 'okay',
  '记一下', '记笔记', '记下', '帮我记', '提醒我', '备注',
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function hasAny(content: string, words: string[]): boolean {
  const lower = content.toLowerCase()
  return words.some(w => lower.includes(w.toLowerCase()))
}

// ── Classifier ────────────────────────────────────────────────────────────────

/**
 * Classify inbound message content into a routing tier.
 *
 * @param content - Raw message text from the user.
 * @returns { tier, symbols } — tier drives the routing decision;
 *   symbols is populated (non-empty) only when tier === 'quote'.
 */
export function classify(content: string): ClassifyResult {
  const isQuote = hasAny(content, QUOTE_WORDS)
  const isDepth = hasAny(content, DEPTH_WORDS)

  // Depth always wins over quote (bias-up rule).
  if (isDepth) {
    return { tier: 'opus', symbols: [] }
  }

  if (isQuote) {
    const symbols = extractSymbols(content)
    if (symbols.length > 0) {
      // Clean quote intent with resolvable symbol(s) → L0 fast path.
      return { tier: 'quote', symbols }
    }
    // Quote intent but no resolvable symbols (e.g. "腾讯股价多少") → sonnet.
    return { tier: 'sonnet', symbols: [] }
  }

  // Casual / low-judgment ops with no symbol → Haiku (cheap, fast).
  // Guarded: only when no resolvable symbol (don't risk investment judgment).
  if (hasAny(content, CASUAL_WORDS) && extractSymbols(content).length === 0) {
    return { tier: 'haiku', symbols: [] }
  }

  // Default: sonnet (chat, news, light questions, etc.)
  return { tier: 'sonnet', symbols: [] }
}
