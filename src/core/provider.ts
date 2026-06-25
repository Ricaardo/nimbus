/**
 * provider.ts — Provider abstraction for multi-backend support.
 *
 * Reads PROVIDER env to determine whether this process runs against Claude
 * (the default / Cici path) or DeepSeek (微信群 DeepSeek instance).
 *
 * When PROVIDER is unset or 'claude', NOTHING changes — all existing code paths
 * run byte-for-byte identical to before this file existed.
 *
 * When PROVIDER=deepseek, this module:
 *   - Exposes the fixed model strings to use per tier (bypasses supportedModels()).
 *   - Provides computeCostUsd() so the DeepSeek instance tracks real spend
 *     (the SDK returns total_cost_usd=0 for unrecognised DeepSeek models).
 *
 * The ANTHROPIC_BASE_URL and ANTHROPIC_API_KEY overrides are NOT set here —
 * they must be injected via the launchd plist EnvironmentVariables block so
 * they are strictly process-local to the DeepSeek instance and never leak into
 * the Cici process.
 */

export type Provider = 'claude' | 'deepseek'

/** Read PROVIDER env; defaults to 'claude' if unset or unrecognised. */
export function getProvider(): Provider {
  const v = process.env.PROVIDER?.toLowerCase()
  if (v === 'deepseek') return 'deepseek'
  return 'claude'
}

// ── DeepSeek model strings ────────────────────────────────────────────────────

/**
 * Fixed model strings for each tier when PROVIDER=deepseek.
 * These are the canonical names the DeepSeek Anthropic-compatible endpoint
 * actually accepts (confirmed by endpoint validation 2026-06-25).
 *   deepseek-v4-flash — fast/cheap; haiku and sonnet tiers.
 *   deepseek-v4-pro   — full reasoning; opus tier only (expensive).
 */
export const DEEPSEEK_MODELS = {
  haiku:  'deepseek-v4-flash',
  sonnet: 'deepseek-v4-flash',
  opus:   'deepseek-v4-pro',
} as const

// ── DeepSeek pricing table ─────────────────────────────────────────────────────
//
// Prices in USD per 1 million tokens.
// Source: DeepSeek official pricing page, snapshot 2026-06-25.
//   https://api-docs.deepseek.com/quick_start/pricing
//
// deepseek-v4-flash (haiku/sonnet tier):
//   input:      $0.14 / M tokens
//   cache_read: $0.0028 / M tokens
//   output:     $0.28 / M tokens
//
// deepseek-v4-pro (opus tier):
//   input:      $0.435 / M tokens
//   cache_read: $0.003625 / M tokens
//   output:     $0.87 / M tokens
//
// Keys are the canonical model strings returned by the endpoint (= what agent.ts
// reads from r.modelUsage), so table lookup matches correctly.
// Structure: { model: { input, cacheRead, output } } — all in USD/M tokens.

interface TokenPriceUsdPerM {
  /** Price per million input tokens (non-cached). */
  input: number
  /** Price per million cache-read tokens (prompt cache hit). */
  cacheRead: number
  /** Price per million output tokens. */
  output: number
}

export const DEEPSEEK_PRICE_TABLE: Record<string, TokenPriceUsdPerM> = {
  // Fast model — haiku/sonnet tier.  Official pricing 2026-06-25.
  'deepseek-v4-flash': { input: 0.14, cacheRead: 0.0028, output: 0.28 },
  // Full reasoning model — opus tier.  Official pricing 2026-06-25.
  'deepseek-v4-pro':   { input: 0.435, cacheRead: 0.003625, output: 0.87 },
}

/** Fallback price entry used when a model is not in the table (conservative: pro prices). */
const DEEPSEEK_PRICE_FALLBACK: TokenPriceUsdPerM = { input: 0.435, cacheRead: 0.003625, output: 0.87 }

/**
 * Compute cost (USD) from raw token counts for a DeepSeek model.
 *
 * The Agent SDK sets total_cost_usd=0 for models it doesn't recognise
 * (all deepseek-* ids).  Call this instead to get real spend figures.
 *
 * @param model          Model string as returned by the SDK (e.g. 'deepseek-chat').
 * @param tokens.inputTokens       Non-cached input tokens (cache_creation included in SDK sum).
 * @param tokens.cacheReadTokens   Prompt-cache read tokens (cheap).
 * @param tokens.outputTokens      Output / completion tokens.
 */
export function computeCostUsd(
  model: string,
  tokens: { inputTokens: number; cacheReadTokens: number; outputTokens: number },
): number {
  const price = DEEPSEEK_PRICE_TABLE[model] ?? DEEPSEEK_PRICE_FALLBACK
  const M = 1_000_000
  // inputTokens from agent.ts already includes cacheRead in its sum (see agent.ts line ~324).
  // We need to subtract cacheRead to get the real non-cached input count for pricing.
  // NB: cache_creation tokens stay in this bucket and are billed at the input rate —
  // DeepSeek has no cache-write premium (unlike Anthropic's 1.25×), so this is correct.
  const nonCachedInput = Math.max(0, tokens.inputTokens - tokens.cacheReadTokens)
  return (
    (nonCachedInput  * price.input    / M) +
    (tokens.cacheReadTokens * price.cacheRead / M) +
    (tokens.outputTokens    * price.output    / M)
  )
}
