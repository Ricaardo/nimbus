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

import { extractSymbols, residualText } from './symbol.js'

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

/** Trivial filler that doesn't change a bare-ticker lookup into a question.
 *  Longer phrases first so they're stripped before their single-char parts. */
const QUOTE_FILLER = [
  '查询', '查一下', '查下', '看一下', '看下', '报一下', '一下',
  '多少钱', '多少', '现在', '现价', '股价', '价格', '行情', '报价',
  '查', '的', '吗', '呢', '呀', '啊', '哦', '嘛', '咋样',
]

/** Common short English words that ALSO happen to be (or look like) US tickers
 *  — e.g. ON, NO, ALL, ARE, IT, AI. When a bare all-caps message is only these,
 *  it's almost certainly chit-chat ("OK", "NO", "ALL GOOD"), not a quote request,
 *  so we must NOT hijack it to the L0 quote path. An explicit "ON 股价" still
 *  routes to quote via the quote-keyword branch above. */
const ENGLISH_STOPWORDS = new Set([
  'A', 'I', 'AN', 'AS', 'AT', 'BE', 'BY', 'DO', 'GO', 'HA', 'HI', 'HM', 'HO', 'IF', 'IN', 'IS', 'IT',
  'ME', 'MY', 'NO', 'OF', 'OH', 'OK', 'ON', 'OR', 'SO', 'TO', 'UP', 'US', 'WE', 'AI',
  'ALL', 'AND', 'ANY', 'ARE', 'BAD', 'BUT', 'CAN', 'DAY', 'DID', 'FEW', 'FOR', 'GET', 'GOT', 'HAD',
  'HAS', 'HER', 'HEY', 'HIM', 'HIS', 'HOW', 'ITS', 'LET', 'LOL', 'MAN', 'MAY', 'NEW', 'NOR', 'NOT',
  'NOW', 'OFF', 'ONE', 'OUR', 'OUT', 'OWN', 'SEE', 'SHE', 'THE', 'TOO', 'TWO', 'USE', 'WAS', 'WAY',
  'WHO', 'WHY', 'YES', 'YET', 'YOU',
  'OKAY', 'THAT', 'THIS', 'WHAT', 'WHEN', 'WITH', 'YEAH', 'SURE', 'NICE', 'GOOD', 'COOL', 'DONE',
  'THANKS', 'OMG', 'BRB', 'IDK', 'PLS', 'THX',
])

/** True when every uppercase token in the message is a common English word and
 *  there is no numeric market code — i.e. all-caps chit-chat, not a ticker query.
 *  Used to veto the bare-symbol fast path so "OK" / "NO" / "ALL" stay conversational. */
function isAllCapsEnglish(content: string): boolean {
  const tokens = content.match(/\b[A-Z]{1,6}\b/g) ?? []
  if (tokens.length === 0) return false
  if (/\d{4,6}/.test(content)) return false        // a numeric code = real symbol intent
  return tokens.every(t => ENGLISH_STOPWORDS.has(t))
}

/** True when the message is essentially nothing but ticker(s) + trivial filler,
 *  e.g. "NVDA" / "腾讯" / "查下 AAPL" — safe to drop straight to the L0 quote
 *  path. Returns false the moment any real intent text survives ("NVDA 怎么样"). */
function isBareSymbolQuery(content: string): boolean {
  // A question mark means the user is asking something, not just pulling a price
  // ("NVDA?" wants a view) — let it fall through to the agent.
  if (/[?？]/.test(content)) return false
  // All-caps English chit-chat ("OK" / "NO" / "ALL GOOD") → not a quote.
  if (isAllCapsEnglish(content)) return false
  let r = residualText(content).toLowerCase()
  for (const f of QUOTE_FILLER) r = r.split(f.toLowerCase()).join('')
  // strip whitespace + punctuation/symbols (Unicode-aware)
  r = r.replace(/[\s\p{P}\p{S}]/gu, '')
  return r.length === 0
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

  // Bare ticker (no quote/depth keyword) — e.g. user just types "NVDA" / "腾讯".
  // Only when nothing but symbol(s) + filler remains, so questions that merely
  // mention a ticker ("NVDA 怎么样") still fall through to the agent.
  const bareSymbols = extractSymbols(content)
  if (bareSymbols.length > 0 && isBareSymbolQuery(content)) {
    return { tier: 'quote', symbols: bareSymbols }
  }

  // Default: sonnet (chat, news, light questions, etc.)
  return { tier: 'sonnet', symbols: [] }
}
