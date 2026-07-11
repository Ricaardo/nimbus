/**
 * symbol.ts — Ticker normalization to futu code format.
 *
 * Replicates the normalization rules from ticker_mapper.py for use in the
 * classify() router (L0 quote path).  This is purely a string-formatting
 * concern — no investment logic.
 *
 * Rules (in order):
 *  1. Already has US./HK./SH./SZ./SG. prefix → pass through.
 *  2. Pure uppercase letters, 1-5 chars → US.<UPPER>
 *  3. 5-digit number → HK.NNNNN
 *  4. 4-digit number (e.g. "0700") → HK.00700 (zero-pad to 5)
 *  5. 6-digit number: 6x/9x/5x/8x start → SH.; 0x/3x/1x start → SZ.
 *  6. N.HK suffix (4-5 digits) → HK.NNNNN (zero-pad to 5)
 *  7. Otherwise → null (Chinese names, crypto, etc. — let the agent handle)
 */

/** Known crypto tickers that futu does not support. */
const CRYPTO_TICKERS = new Set(['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'USDT', 'USDC', 'AVAX', 'DOT', 'MATIC', 'LTC', 'BCH', 'LINK', 'UNI', 'ATOM', 'XLM', 'ETC'])

/**
 * Common company name (Chinese / colloquial) → futu code, so the L0 quote path
 * also fires for "英伟达多少钱" / "腾讯行情". Pure lookup table, not investment
 * logic. Holdings first (腾讯/药明/博通/迈威尔/诺基亚), then frequent names.
 * Keys are matched case-insensitively as substrings of the message.
 */
const NAME_MAP: Record<string, string> = {
  // ── holdings ──
  '腾讯': 'HK.00700', '騰訊': 'HK.00700', 'tencent': 'HK.00700',
  '药明康德': 'HK.02359', '藥明康德': 'HK.02359', '药明': 'HK.02359',
  '博通': 'US.AVGO', 'broadcom': 'US.AVGO',
  '迈威尔': 'US.MRVL', '迈威尔科技': 'US.MRVL', 'marvell': 'US.MRVL',
  '诺基亚': 'US.NOK', 'nokia': 'US.NOK',
  '阿里巴巴': 'HK.09988', '阿里': 'HK.09988', 'alibaba': 'HK.09988',
  // ── frequent US ──
  '英伟达': 'US.NVDA', '英偉達': 'US.NVDA', 'nvidia': 'US.NVDA',
  '苹果': 'US.AAPL', '蘋果': 'US.AAPL', 'apple': 'US.AAPL',
  '特斯拉': 'US.TSLA', 'tesla': 'US.TSLA',
  '微软': 'US.MSFT', '微軟': 'US.MSFT', 'microsoft': 'US.MSFT',
  '谷歌': 'US.GOOGL', 'google': 'US.GOOGL',
  '亚马逊': 'US.AMZN', '亞馬遜': 'US.AMZN', 'amazon': 'US.AMZN',
  '台积电': 'US.TSM', '台積電': 'US.TSM',
  '英特尔': 'US.INTC', 'intel': 'US.INTC',
  '拼多多': 'US.PDD', '超威': 'US.AMD', '超微': 'US.SMCI',
  '元宇宙': 'US.META', 'meta': 'US.META', '脸书': 'US.META',
  // ── frequent HK / A ──
  '美团': 'HK.03690', '美團': 'HK.03690',
  '小米': 'HK.01810', 'xiaomi': 'HK.01810',
  '比亚迪': 'HK.01211', '比亞迪': 'HK.01211',
  '京东': 'HK.09618', '京東': 'HK.09618',
  '网易': 'HK.09999', '網易': 'HK.09999',
  '百度': 'HK.09888', 'baidu': 'HK.09888',
  '快手': 'HK.01024',
  '茅台': 'SH.600519', '贵州茅台': 'SH.600519', '貴州茅台': 'SH.600519',
  '宁德时代': 'SZ.300750', '寧德時代': 'SZ.300750', '宁德': 'SZ.300750',
}

/** Scan a message for known company names → futu codes. */
function extractNames(content: string): string[] {
  const lower = content.toLowerCase()
  const out: string[] = []
  for (const [name, code] of Object.entries(NAME_MAP)) {
    // Chinese keys: direct substring; latin keys: case-insensitive
    const hit = /[a-z]/i.test(name) ? lower.includes(name.toLowerCase()) : content.includes(name)
    if (hit) out.push(code)
  }
  return out
}

/** Token regex shared by extractSymbols and residualText (prefixed codes |
 *  uppercase 1-5 letters | 4-6 digit strings). */
const TOKEN_RE = /\b(?:(?:US|HK|SH|SZ|SG)\.[A-Z0-9]{1,6}|[A-Z]{1,5}(?:[.\-][A-Z]{1,3})?|\d{4,6})\b/g

/**
 * Return what's left of a message after stripping every symbol-like token and
 * known company-name key.  Used by the router to decide whether a message is a
 * *bare* ticker lookup (residual is empty/trivial) vs. a question that merely
 * mentions a ticker (residual carries the real intent). No investment logic.
 */
export function residualText(content: string): string {
  let s = content.replace(TOKEN_RE, ' ')
  for (const name of Object.keys(NAME_MAP)) {
    if (/[a-z]/i.test(name)) s = s.replace(new RegExp(name, 'gi'), ' ')
    else s = s.split(name).join(' ')
  }
  return s
}

/** Normalize a single token to futu code format.  Returns null if
 *  the token cannot be mapped to a supported market code. */
export function normalizeSymbol(token: string): string | null {
  if (!token) return null
  const t = token.trim()

  // 1. Already futu format (US./HK./SH./SZ./SG.)
  if (/^(US|HK|SH|SZ|SG)\./.test(t)) return t

  // 1b. Crypto exclusion (before US ticker match)
  if (CRYPTO_TICKERS.has(t.toUpperCase())) return null

  // 2. Pure US ticker: 1-5 uppercase letters (may include . or - for class shares)
  if (/^[A-Z]{1,5}([.\-][A-Z]{1,3})?$/.test(t)) return `US.${t.toUpperCase()}`

  // 3+4. Plain HK 4-5 digit code
  if (/^\d{4,5}$/.test(t)) return `HK.${t.padStart(5, '0')}`

  // 5. Plain A-share 6-digit code
  if (/^\d{6}$/.test(t)) {
    if (/^(6[0-9]|[589][0-9])/.test(t)) return `SH.${t}`  // 60/68/58/90 etc
    if (/^(0[0-9]|3[0-9]|1[256])/.test(t)) return `SZ.${t}` // 00/30/15/16/12
    return `SH.${t}` // default
  }

  // 6. N.HK suffix
  const hkMatch = t.match(/^(\d{4,5})\.HK$/i)
  if (hkMatch) return `HK.${hkMatch[1]!.padStart(5, '0')}`

  return null
}

/**
 * Convert a decision-ledger symbol to futu format for price lookups.
 * Handles the "<digits>.SH/.SZ/.HK" suffix format the agent sometimes stores
 * (e.g. "601975.SH", "06651.HK"), falling back to normalizeSymbol for
 * everything else (bare US ticker, bare HK/A-share digits, already-futu code).
 * Returns null if the symbol can't be mapped to a supported market code.
 */
export function toFutuCode(symbol: string): string | null {
  const s = (symbol ?? '').trim().toUpperCase()
  if (!s) return null
  // HK suffix: allow 3-6 digits (e.g. "700.HK") — HK codes are commonly written
  // without leading zeros; left-pad to the futu 5-digit format.
  const hkSuffix = s.match(/^(\d{3,6})\.HK$/)
  if (hkSuffix) return `HK.${hkSuffix[1]!.padStart(5, '0')}`
  // A-share (SH/SZ) suffix — always 6 digits, unchanged.
  const cnSuffix = s.match(/^(\d{4,6})\.(SH|SZ)$/)
  if (cnSuffix) return `${cnSuffix[2]}.${cnSuffix[1]}`
  return normalizeSymbol(s)
}

/**
 * Convert a futu-format code (US.X / HK.NNNNN / SH.NNNNNN / SZ.NNNNNN) to the
 * canonical symbol contract (US:X / HK:NNNNN / CN:NNNNNN) used by the
 * data-gateway / signal-gateway. This makes symbol.ts the TypeScript adapter
 * onto the canonical contract (docs/contracts/symbol.md) without changing the
 * futu-format output the L0 router already depends on. Returns null if the
 * input is not a recognized futu code.
 */
export function toCanonical(futuCode: string): string | null {
  const t = (futuCode ?? '').trim()
  const m = t.match(/^(US|HK|SH|SZ)\.([A-Z0-9.\-]{1,8})$/i)
  if (!m) return null
  const market = m[1]!.toUpperCase()
  const local = m[2]!.toUpperCase()
  if (market === 'US') return `US:${local}`
  if (market === 'HK') return `HK:${local.padStart(5, '0')}`
  return `CN:${local}` // SH./SZ. both map to the canonical CN market
}

/** Convenience: extract symbols from a message as canonical codes. */
export function extractCanonicalSymbols(content: string): string[] {
  const out: string[] = []
  for (const code of extractSymbols(content)) {
    const c = toCanonical(code)
    if (c && !out.includes(c)) out.push(c)
  }
  return out
}

/**
 * Extract and normalize ticker-like tokens from a message string.
 *
 * Scans for:
 *  - Already-prefixed codes: US.NVDA, HK.00700, SH.600519, etc.
 *  - Uppercase letter sequences of 1-5 chars (likely US tickers)
 *  - Digit sequences of 4-6 chars (HK / A-share codes)
 *
 * Each candidate is run through normalizeSymbol; null results are dropped.
 * Returns an array of unique futu codes.
 */
export function extractSymbols(content: string): string[] {
  // Match: prefixed codes | uppercase 1-5 letters | 4-6 digit strings
  const seen = new Set<string>()
  const result: string[] = []

  const tokens = content.match(TOKEN_RE) ?? []
  for (const tok of tokens) {
    const code = normalizeSymbol(tok)
    if (code && !seen.has(code)) {
      seen.add(code)
      result.push(code)
    }
  }

  // Also scan for known company names (英伟达/腾讯/...) so L0 fires for them.
  for (const code of extractNames(content)) {
    if (!seen.has(code)) {
      seen.add(code)
      result.push(code)
    }
  }

  return result
}
