/**
 * disclaimer.ts — Investment-content disclaimer detection and injection (M6 Batch 1).
 *
 * shouldAppend(text) returns true when the text contains investment signals
 * (tickers, position/valuation keywords).  Returns false for short/casual messages.
 * Conservative: prefer false-negative over false-positive for pure chit-chat.
 */

import { DISCLAIMER } from '../config.js'

export { DISCLAIMER }

// US ticker: 2-5 uppercase letters not all-common-words
const US_TICKER_RE = /\b[A-Z]{2,5}\b/
// A-share / HK 4-6 digit codes
const CN_TICKER_RE = /\b\d{4,6}\b/
// Investment action/valuation keywords
const INVEST_KEYWORD_RE = /仓位|止损|买入|卖出|估值|目标价|加仓|减仓|PE|买|卖|持仓|建仓|平仓|做多|做空|涨停|跌停|止盈|斩仓|割肉|抄底|补仓|减持|增持|回调|反弹|突破|压力|支撑|均线|MACD|RSI|KDJ|成交量|市值|市盈率|市净率|EPS|ROE|ROA|EBITDA|DCF|自由现金流|盈利/

// Short pure-casual patterns — explicit list only, no catch-all
const CASUAL_RE = /^(你好|hi|hello|嗯|好的|谢谢|感谢|哈哈|哈|OK|ok|嗯嗯)$/i

/**
 * Returns true when text is likely investment-related and warrants a disclaimer.
 *
 * Decision logic (conservative — richer check = safer):
 * 1. If text is very short / pure casual greeting → false.
 * 2. If text contains a US ticker pattern OR A/HK digit code → true.
 * 3. If text contains an investment keyword → true.
 * 4. Otherwise → false.
 */
export function shouldAppend(text: string): boolean {
  const trimmed = text.trim()

  // Very short or casual → no disclaimer needed
  if (trimmed.length < 20 && CASUAL_RE.test(trimmed)) return false

  if (US_TICKER_RE.test(trimmed)) return true
  if (CN_TICKER_RE.test(trimmed)) return true
  if (INVEST_KEYWORD_RE.test(trimmed)) return true

  return false
}

/**
 * Appends the disclaimer to text if shouldAppend returns true.
 * Adds two newlines as separator before the disclaimer.
 */
export function maybeAppendDisclaimer(text: string): string {
  if (!shouldAppend(text)) return text
  return `${text}\n\n${DISCLAIMER}`
}
