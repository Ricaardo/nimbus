/**
 * models.ts — 动态模型注册表(实时跟随 Anthropic 新发布的模型)。
 *
 * 不写死版本号(claude-opus-4-8 这种会过时)。启动时调 SDK 的
 * supportedModels() 拿当前可用模型(返回滚动别名 haiku/sonnet/opus 等),
 * 把三档(haiku/sonnet/opus)解析到真实可用的 value。Anthropic 发新版 →
 * 别名自动指向最新 → nimbus 无需改代码就用上最新模型。
 * 解析不到(离线/异常)→ 退回 config 的 fallback 别名。
 */

import { query } from '@anthropic-ai/claude-agent-sdk'
import { HAIKU_MODEL, SONNET_MODEL, OPUS_MODEL, PROJECT_ROOT } from '../config.js'
import { getProvider, DEEPSEEK_MODELS } from './provider.js'

export type Tier = 'haiku' | 'sonnet' | 'opus'

// Resolved per-tier model values. Start with config fallbacks; refreshed at boot.
const resolved: Record<Tier, string> = {
  haiku: HAIKU_MODEL,
  sonnet: SONNET_MODEL,
  opus: OPUS_MODEL,
}
let lastRefresh = 0

/** Current model value for a tier (resolved alias, or fallback). */
export function modelFor(tier: Tier): string {
  return resolved[tier]
}

/** Pick the best available model value for a tier from supportedModels() output.
 *  Prefer the bare rolling alias (haiku/sonnet/opus) — it always points at the
 *  latest. Else any value whose id/displayName contains the family keyword. */
function pick(models: Array<{ value: string; displayName?: string }>, family: Tier): string | null {
  // ★避开需额外付费的上下文变体(如 'sonnet[1m]' = 1M 上下文,订阅外要 credits)。
  // 优先裸别名(标准上下文,订阅内免费)。
  // 1. exact rolling alias (bare, standard context) — 首选
  const exact = models.find(m => m.value === family)
  if (exact) return exact.value
  // 2. family keyword but WITHOUT a '[...]' paid-context suffix
  const standard = models.find(m =>
    !/\[.*\]/.test(m.value) &&
    (m.value.toLowerCase().includes(family) || (m.displayName ?? '').toLowerCase().includes(family)),
  )
  if (standard) return standard.value
  // ★绝不自动选付费 [1m] 变体。没有免费标准别名 → 返回 null → 调用方用 config
  //   的标准全名 fallback(免费标准上下文)。
  return null
}

/** Query SDK for currently-available models and re-resolve each tier.
 *  Safe to call at boot and periodically; never throws (keeps fallbacks).
 *  supportedModels() does not need any business MCP servers — pass empty map
 *  to avoid loading all tool definitions (省启动 ping 的全量加载). */
export async function refreshModels(): Promise<Record<Tier, string>> {
  // ── DeepSeek provider branch ─────────────────────────────────────────────────
  // When PROVIDER=deepseek, skip supportedModels() entirely (it calls Anthropic
  // and would fail against the DeepSeek endpoint).  Return fixed model strings
  // from the provider config instead.  The 'claude' path below is byte-identical
  // to before this branch was added — no behaviour change when PROVIDER is unset.
  if (getProvider() === 'deepseek') {
    // DEEPSEEK_MODEL env 覆盖（如 Cici 强制 pro）；未设则按 tier 映射（flash/省钱）
    const force = process.env['DEEPSEEK_MODEL']
    resolved.haiku  = force ?? DEEPSEEK_MODELS.haiku
    resolved.sonnet = force ?? DEEPSEEK_MODELS.sonnet
    resolved.opus   = force ?? DEEPSEEK_MODELS.opus
    lastRefresh = Date.now()
    process.stderr.write(
      `nimbus: models resolved (deepseek) — haiku=${resolved.haiku} sonnet=${resolved.sonnet} opus=${resolved.opus}\n`,
    )
    return { ...resolved }
  }
  // ── Claude path (original, unchanged) ───────────────────────────────────────
  try {
    const q = query({
      prompt: 'ping',
      options: { settingSources: ['project', 'local'], cwd: PROJECT_ROOT, permissionMode: 'default' },
    }) as unknown as { supportedModels(): Promise<Array<{ value: string; displayName?: string }>> }
    const models = await q.supportedModels()
    if (Array.isArray(models) && models.length > 0) {
      for (const tier of ['haiku', 'sonnet', 'opus'] as Tier[]) {
        const v = pick(models, tier)
        if (v) resolved[tier] = v
      }
      lastRefresh = Date.now()
      process.stderr.write(`nimbus: models resolved — haiku=${resolved.haiku} sonnet=${resolved.sonnet} opus=${resolved.opus}\n`)
    }
  } catch (err) {
    process.stderr.write(`nimbus: model refresh failed (keeping fallbacks): ${err}\n`)
  }
  return { ...resolved }
}

export function lastRefreshTs(): number {
  return lastRefresh
}
