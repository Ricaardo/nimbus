/**
 * guardrail/loader.ts — Trade-journal case loader.
 *
 * Reads all YAML files from skills/trade-journal/reports/trades/, extracts
 * realized P&L data and repeat warnings.  Used by guardrail to synthesize
 * evidence-based warnings from real trade history instead of hardcoded text.
 *
 * Cached in-process (re-loads when file count or mtime changes).
 * Directory missing / empty → returns empty map (no crash).
 */

import { join } from 'node:path'
import { readdirSync, readFileSync, statSync } from 'node:fs'

const TRADES_DIR = join(import.meta.dir, '../../..', 'skills/trade-journal/reports/trades')

export interface TradeCase {
  ticker: string
  name: string
  realizedPnl: number
  pctOfAccount: number
  window: string
  repeatWarning: string | null
  tags: string[]
  mistakes: string[]
}

interface CacheEntry {
  /** mtime of the directory at last load (millis) */
  mtime: number
  fileCount: number
  cases: Map<string, TradeCase[]>
}

let cache: CacheEntry | null = null
let cacheDir: string

/** Reset cache (exported for testing). */
export function resetCache(): void {
  cache = null
}

function loadTradeCases(): Map<string, TradeCase[]> {
  let dirStat: ReturnType<typeof statSync>
  try {
    dirStat = statSync(TRADES_DIR)
  } catch {
    return new Map()
  }

  let files: string[]
  try {
    files = readdirSync(TRADES_DIR).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
  } catch {
    return new Map()
  }

  // Cache hit: same mtime + same file count
  if (cache && cache.mtime === dirStat.mtimeMs && cache.fileCount === files.length) {
    return cache.cases
  }

  // Load & parse
  const cases = new Map<string, TradeCase[]>()
  for (const fn of files) {
    try {
      const raw = readFileSync(join(TRADES_DIR, fn), 'utf-8')
      let doc: Record<string, unknown>
      try {
        // biome-ignore lint/suspicious/noExplicitAny: YAML shape varies
        doc = (Bun as any).YAML.parse(raw)
      } catch {
        continue // skip unparseable files
      }
      if (!doc || typeof doc !== 'object') continue

      const ticker = String(doc.ticker ?? '').toUpperCase()
      if (!ticker) continue

      // Normalize multi-ticker (SOXL+SOXS) to the first ticker for lookup
      const primaryTicker = ticker.split(/[+/]/)[0].trim()

      const tc: TradeCase = {
        ticker,
        name: String(doc.name ?? ''),
        realizedPnl: Number(doc.realized_pnl_total) || 0,
        pctOfAccount: Number(doc.pct_of_account) || 0,
        window: String(doc.window ?? ''),
        repeatWarning: String(doc.repeat_warning ?? '') || null,
        tags: Array.isArray(doc.tags) ? doc.tags.map(String) : [],
        mistakes: Array.isArray(doc.mistake_tags)
          ? (doc.mistake_tags as Array<Record<string, unknown>>).map(m => String(m.name ?? m.code ?? ''))
          : [],
      }

      // Index by primary ticker AND each tag-ticker
      for (const idx of [primaryTicker, ...tc.tags]) {
        if (!idx) continue
        const key = idx.toUpperCase()
        if (!cases.has(key)) cases.set(key, [])
        cases.get(key)!.push(tc)
      }
    } catch {
      continue // skip corrupt files
    }
  }

  cache = { mtime: dirStat.mtimeMs, fileCount: files.length, cases }
  return cases
}

/**
 * Find significant losing trades for a ticker.
 *
 * Returns trades where realizedPnl <= minLoss (default -500) OR
 * pctOfAccount <= -3%, excluding flat/winning cases.
 */
export function findRelevantLosingTrades(ticker: string): TradeCase[] {
  const all = loadTradeCases()
  const hits = all.get(ticker.toUpperCase()) ?? []

  return hits.filter(t => t.realizedPnl <= -500 || t.pctOfAccount <= -3)
}

/**
 * Get the worst losing trade (most negative realizedPnl) for a ticker.
 */
export function worstLosingTrade(ticker: string): TradeCase | null {
  const hits = findRelevantLosingTrades(ticker)
  if (hits.length === 0) return null
  return hits.reduce((a, b) => (a.realizedPnl < b.realizedPnl ? a : b))
}

/**
 * Build a one-line evidence string for a significant losing trade.
 * Returns null if no material trade found for the ticker.
 */
export function tradeEvidenceString(ticker: string): string | null {
  const worst = worstLosingTrade(ticker)
  if (!worst) return null

  const parts: string[] = []
  if (worst.name) parts.push(worst.name)

  const cost = Math.abs(worst.realizedPnl)
  parts.push(`净亏 $${cost.toLocaleString()}`)
  if (worst.pctOfAccount) {
    parts.push(`(账户${Math.abs(worst.pctOfAccount)}%)`)
  }
  if (worst.window) parts.push(worst.window)

  return parts.join(' ')
}
