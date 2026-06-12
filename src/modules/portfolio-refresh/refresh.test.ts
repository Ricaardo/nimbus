import { describe, test, expect } from 'bun:test'
import { portfolioRefreshModules } from './index.js'
import type { ModuleContext } from '../module.js'

const mod = portfolioRefreshModules[0]!

function ctxWith(captured: { opts?: Record<string, unknown> }): ModuleContext {
  return {
    trigger: { kind: 'cron', job: 'portfolio:refresh' },
    channels: { async send() { return 'x' }, async edit() {}, async sendTyping() {} },
    agent: { async run(opts: Record<string, unknown>) { captured.opts = opts; return { text: '✅ 持仓已刷新' } } },
    db: {} as never,
    memory: {} as never,
    safety: {} as never,
  } as unknown as ModuleContext
}

describe('portfolio:refresh module', () => {
  test('is a cron module targeting the report DM', () => {
    expect(mod.name).toBe('portfolio:refresh')
    expect(typeof mod.cron).toBe('string')
    expect(mod.targetChat).toBeTruthy()
  })

  test('cron run uses user settingSources (IBKR connector) + low effort + IBKR/rebuild in prompt', async () => {
    const captured: { opts?: Record<string, unknown> } = {}
    await mod.handle(ctxWith(captured))
    const o = captured.opts!
    expect(o['settingSources']).toEqual(['user', 'project', 'local'])
    expect(o['effort']).toBe('low')
    const prompt = String(o['prompt'])
    expect(prompt).toContain('IBKR')
    expect(prompt).toContain('ibkr_positions.json')
    expect(prompt).toContain('portfolio_state.py')
    expect(prompt).toContain('AI 绝不下单')
  })

  test('non-cron trigger is ignored (no agent call)', async () => {
    const captured: { opts?: Record<string, unknown> } = {}
    const c = ctxWith(captured)
    ;(c as { trigger: unknown }).trigger = { kind: 'message', payload: {} }
    await mod.handle(c)
    expect(captured.opts).toBeUndefined()
  })
})
