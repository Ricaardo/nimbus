/**
 * knowledge.test.ts — 知识层客户端单测。
 *
 * 核心保证:**弱依赖,降级不崩**。sidecar 挂了/超时/非 200 → kbSearch 返回 [],
 * kbIngest 返回 null,绝不抛错(调用方靠此降级而不中断消息处理)。
 * 全部覆写 globalThis.fetch,无真实网络。
 */

import { describe, test, expect, afterEach } from 'bun:test'
import { kbSearch, kbIngest, formatRecall } from './knowledge.js'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

function stubFetch(fn: (url: string) => unknown): void {
  // @ts-expect-error — 测试替身,签名简化
  globalThis.fetch = async (url: string) => fn(url)
}

describe('knowledge.kbSearch — 弱依赖降级', () => {
  test('sidecar 挂了(fetch 抛错) → 返回 [],不抛', async () => {
    stubFetch(() => { throw new Error('ECONNREFUSED') })
    expect(await kbSearch('NVDA 护城河')).toEqual([])
  })

  test('非 200 响应 → 返回 []', async () => {
    stubFetch(() => ({ ok: false, json: async () => ({}) }))
    expect(await kbSearch('NVDA')).toEqual([])
  })

  test('正常返回 + minScore 过滤噪声', async () => {
    stubFetch(() => ({
      ok: true,
      json: async () => ({ results: [
        { artifact_id: 1, kind: 'thesis', ticker: 'NVDA', title: 'NVDA', created_at: 0, source_path: null, score: 0.55, snippet: 'a' },
        { artifact_id: 2, kind: 'research', ticker: 'X', title: 'X', created_at: 0, source_path: null, score: 0.12, snippet: 'b' },
      ] }),
    }))
    const r = await kbSearch('NVDA', { minScore: 0.3 })
    expect(r).toHaveLength(1)
    expect(r[0].ticker).toBe('NVDA')
  })
})

describe('knowledge.kbIngest — 弱依赖', () => {
  test('sidecar 挂了 → 返回 null,不抛', async () => {
    stubFetch(() => { throw new Error('down') })
    expect(await kbIngest({ kind: 'analysis', body: 'x' })).toBeNull()
  })

  test('正常 → 返回 artifact 信息', async () => {
    stubFetch(() => ({ ok: true, json: async () => ({ artifact_id: 7, chunks: 3 }) }))
    expect(await kbIngest({ kind: 'analysis', body: 'x' })).toEqual({ artifact_id: 7, chunks: 3 })
  })
})

describe('knowledge.formatRecall', () => {
  test('空结果 → 空串(不注入任何块)', () => {
    expect(formatRecall([])).toBe('')
  })

  test('有结果 → 含召回标题 + kind·ticker·date 标注', () => {
    const out = formatRecall([
      { artifact_id: 1, kind: 'thesis', ticker: 'NVDA', title: 'NVDA 多头', created_at: 1781835681, source_path: null, score: 0.6, snippet: 'CUDA 护城河' },
    ])
    expect(out).toContain('历史研究召回')
    expect(out).toContain('thesis')
    expect(out).toContain('NVDA')
    expect(out).toContain('CUDA 护城河')
  })
})
