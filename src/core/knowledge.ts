/**
 * knowledge.ts — 知识层 (RAG) 客户端。
 *
 * 薄 HTTP 客户端,对接 scripts/kb-server.py(Python sidecar,127.0.0.1:6901):该 sidecar
 * 持有 fastembed 多语言模型 + data/knowledge.db(sqlite-vec 向量库),存研究报告/thesis/
 * 复盘/filing 的 chunk。Bun 侧不碰原生 sqlite 扩展。
 *
 * 设计:**弱依赖,降级不崩**。sidecar 挂了/超时 → kbSearch 返回 [],kbIngest 静默吞掉。
 * recall 链路本就 `?? []` 兜底,知识层不可用时 bot 照常运转(只是少了历史召回)。
 *
 * Phase 2 可观测性:连续失败超过阈值时写 stderr 告警,避免静默裸奔数天无人知。
 */

import { KB_BASE_URL } from '../config.js'

// ── Observability ──────────────────────────────────────────────────────────────

/** Consecutive kb-server request failures. Reset on first success. */
let consecutiveFailures = 0
/** Log a warning to stderr when consecutive failures reach this threshold. */
const FAILURE_WARN_THRESHOLD = 5

function recordFailure(): void {
  consecutiveFailures++
  if (consecutiveFailures === FAILURE_WARN_THRESHOLD) {
    process.stderr.write(
      `nimbus: kb-server unreachable for ${consecutiveFailures} consecutive requests — ` +
      `知识层召回已静默失效。历史研究/复盘/论点将不可召回,agent 缺少 grounding。\n` +
      `  检查: curl ${KB_BASE_URL}/health 或 lsof -iTCP:6901\n`,
    )
  } else if (consecutiveFailures > 0 && consecutiveFailures % 20 === 0) {
    process.stderr.write(
      `nimbus: kb-server still unreachable (${consecutiveFailures} consecutive failures)\n`,
    )
  }
}

function recordSuccess(): void {
  if (consecutiveFailures >= FAILURE_WARN_THRESHOLD) {
    process.stderr.write(`nimbus: kb-server recovered after ${consecutiveFailures} failures\n`)
  }
  consecutiveFailures = 0
}

export interface KbResult {
  artifact_id: number
  kind: string
  ticker: string | null
  symbols?: string[]
  tags?: string[]
  title: string | null
  created_at: number
  source_path: string | null
  source_id?: string | null
  provenance?: Record<string, unknown> | null
  score: number // cosine 相似度 × 时效权重(0~1)。注意:已混入 recency 衰减,旧文档分数被压低,minScore 据此过滤
  snippet: string
}

export interface KbArtifact {
  kind: string // research | thesis | reflection | journal | filing | earnings_call | framework | analysis | opportunity
  body: string
  ticker?: string
  title?: string
  source_path?: string
  meta?: Record<string, unknown>
  // ResearchArtifact v1 fields (docs/contracts/research-artifact-v1.md)
  symbols?: string[]
  tags?: string[]
  source_id?: string
  provenance?: Record<string, unknown>
}

async function post<T>(path: string, payload: unknown, timeoutMs: number): Promise<T | null> {
  try {
    const res = await fetch(`${KB_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) { recordFailure(); return null }
    recordSuccess()
    return (await res.json()) as T
  } catch {
    recordFailure()
    return null // sidecar down / timeout → caller degrades gracefully
  }
}

/** 语义检索研究产物。失败返回 []。minScore 过滤噪声(cosine < 阈值丢弃)。 */
export async function kbSearch(
  query: string,
  opts: { limit?: number; kind?: string; ticker?: string; minScore?: number } = {},
): Promise<KbResult[]> {
  const { limit = 6, kind, ticker, minScore = 0.3 } = opts
  const out = await post<{ results: KbResult[] }>(
    '/search',
    { query, limit, kind, ticker },
    2000,
  )
  if (!out) return []
  return out.results.filter(r => r.score >= minScore)
}

/** 入库一篇研究产物(同 source_path 覆盖)。失败静默(知识层非关键路径)。 */
export async function kbIngest(a: KbArtifact): Promise<{ artifact_id: number; chunks: number } | null> {
  return post<{ artifact_id: number; chunks: number }>('/ingest', a, 15000)
}

/** sidecar 健康(health cron / 自检用)。 */
export async function kbHealth(): Promise<{ ok: boolean; artifacts: number; chunks: number } | null> {
  try {
    const res = await fetch(`${KB_BASE_URL}/health`, { signal: AbortSignal.timeout(1500) })
    if (!res.ok) return null
    return (await res.json()) as { ok: boolean; artifacts: number; chunks: number }
  } catch {
    return null
  }
}

/** 启动时健康检查:ping kb-server,不可用时写 stderr 告警(不阻塞启动)。
 *  由 main.ts 在 dispatcher 初始化前调用,早发现早修。 */
export async function kbStartupCheck(): Promise<void> {
  const ok = await kbHealth()
  if (!ok) {
    process.stderr.write(
      'nimbus: ⚠️ kb-server 启动健康检查失败 — 知识层召回不可用。\n' +
      `  sidecar 预期在 ${KB_BASE_URL},请确认 scripts/kb-server.py 是否在运行。\n` +
      '  bot 仍可正常运转,但缺少历史研究/复盘 grounding,幻觉风险升高。\n',
    )
  } else {
    process.stderr.write(
      `nimbus: kb-server ok — ${ok.artifacts} artifacts, ${ok.chunks} chunks\n`,
    )
  }
}

/** 把检索结果格式化成注入 agent 上下文的一段(带 kind·ticker·日期 标注,可追溯)。 */
export function formatRecall(results: KbResult[]): string {
  if (results.length === 0) return ''
  const lines = results.map(r => {
    const date = new Date(r.created_at * 1000).toISOString().slice(0, 10)
    const tag = [r.kind, r.ticker, date].filter(Boolean).join('·')
    // Cite the artifact source so the agent can attribute its recall.
    const cite = r.source_id ?? r.source_path ?? `kb#${r.artifact_id}`
    return `• [${tag}] ${r.title ?? ''}（来源 ${cite}）\n  ${r.snippet.replace(/\n+/g, ' ').slice(0, 220)}`
  })
  return '【历史研究召回（你过去对相关标的的研究/论点，供延续与对照，避免冷启动）】\n' + lines.join('\n')
}
