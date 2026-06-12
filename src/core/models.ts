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
import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { HAIKU_MODEL, SONNET_MODEL, OPUS_MODEL, PROJECT_ROOT } from '../config.js'

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
  // 1. exact rolling alias
  const exact = models.find(m => m.value === family)
  if (exact) return exact.value
  // 2. alias with context suffix (e.g. 'sonnet[1m]')
  const suffixed = models.find(m => m.value.startsWith(`${family}[`))
  if (suffixed) return suffixed.value
  // 3. any value/displayName containing the family keyword (case-insensitive)
  const kw = models.find(m =>
    m.value.toLowerCase().includes(family) || (m.displayName ?? '').toLowerCase().includes(family),
  )
  return kw ? kw.value : null
}

function loadMcp(): Record<string, unknown> {
  const m: Record<string, unknown> = {}
  for (const p of [join(homedir(), '.claude.json'), join(homedir(), '.claude', 'mcp.json'), join(PROJECT_ROOT, 'secrets', 'mcp.json')]) {
    try { const r = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>; Object.assign(m, (r.mcpServers ?? r) as Record<string, unknown>) } catch {}
  }
  delete m['grok-search']
  return m
}

/** Query SDK for currently-available models and re-resolve each tier.
 *  Safe to call at boot and periodically; never throws (keeps fallbacks). */
export async function refreshModels(): Promise<Record<Tier, string>> {
  try {
    const q = query({
      prompt: 'ping',
      options: { settingSources: ['project', 'local'], cwd: PROJECT_ROOT, mcpServers: loadMcp() as never, permissionMode: 'default' },
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
