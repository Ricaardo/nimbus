import { describe, test, expect } from 'bun:test'
import { costReportModules } from './cost-report.js'
import { healthModules } from './health.js'
import { openDb } from '../../core/db.js'

function makeCtx(db: any, sends: string[]) {
  return {
    trigger: { kind: 'cron', job: 'x' },
    channels: { async send(_c: string, _ch: string, t: string) { sends.push(t); return 'id' }, async edit(){}, async sendTyping(){} },
    db, memory: {}, safety: {}, agent: {},
  } as any
}

describe('ops: cost-report', () => {
  test('summarizes usage by model', async () => {
    const db = openDb(':memory:')
    db.logUsage({ model: 'claude-haiku-4-5', costUsd: 0.01, inputTokens: 500, outputTokens: 100, cacheReadTokens: 200 })
    db.logUsage({ model: 'claude-opus-4-8', costUsd: 0.5, inputTokens: 9000, outputTokens: 1200, cacheReadTokens: 8000 })
    const sends: string[] = []
    await costReportModules[0]!.handle(makeCtx(db, sends))
    expect(sends[0]).toContain('成本周报')
    expect(sends[0]).toContain('$0.51')
    expect(sends[0]).toContain('claude-opus-4-8')
    db.close()
  })
  test('empty usage → no-record message', async () => {
    const db = openDb(':memory:'); const sends: string[] = []
    await costReportModules[0]!.handle(makeCtx(db, sends))
    expect(sends[0]).toContain('无 agent 调用')
    db.close()
  })
})

describe('ops: health module shape', () => {
  test('is a cron module', () => {
    expect(healthModules[0]!.name).toBe('ops:health')
    expect(typeof healthModules[0]!.cron).toBe('string')
  })
})
