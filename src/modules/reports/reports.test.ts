/**
 * reports.test.ts — Unit tests for daily report modules (M5).
 *
 * Mocks agent + channels; verifies that each job:
 *   • uses trigger.kind === 'cron'
 *   • composes a prompt containing the required skill keywords
 *   • sends result to REPORT_DM
 *   • calls agent.run with model = REPORT_MODEL
 */

import { describe, test, expect } from 'bun:test'
import { reportModules } from './index.js'
import { REPORT_DM, REPORT_MODEL } from '../../config.js'
import type { ModuleContext, AgentRunner, ChannelRegistry, DB, Memory, Safety } from '../module.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

interface AgentCall {
  prompt: string
  model?: string
  resume?: string
}

function makeContext(agentCalls: AgentCall[], sendCalls: Array<{ chatId: string; text: string }>): ModuleContext {
  const agent: AgentRunner = {
    async run(opts) {
      agentCalls.push({ prompt: opts.prompt, model: opts.model, resume: opts.resume })
      return { sessionId: 'ses-report', text: 'report result' }
    },
  }

  const channels: ChannelRegistry = {
    async send(_channel, chatId, text, _opts) {
      sendCalls.push({ chatId, text })
      return 'msg-id'
    },
    async edit() {},
    async sendTyping() {},
  }

  const db: DB = {
    getSession: () => null,
    putSession: () => {},
    audit: () => {},
    getJob: () => null,
    upsertJob: () => {},
    markJobRun: () => {},
    getCooldown: () => null,
    setCooldown: () => {},
  }

  const memory: Memory = {
    loadPortfolioState: () => null,
    riskProfile: () => '',
    buildContext: () => '',
  }

  const safety: Safety = {
    canUseTool: async () => ({ behavior: 'allow' }),
  }

  return {
    trigger: { kind: 'cron', job: 'test' },
    channels,
    agent,
    db,
    memory,
    safety,
  }
}

// ── report:morning ────────────────────────────────────────────────────────────

describe('report:morning', () => {
  const mod = reportModules.find(m => m.name === 'report:morning')!

  test('module exists and has correct cron', () => {
    expect(mod).toBeDefined()
    expect(mod.cron).toBe('0 8 * * *')
  })

  test('runs agent with Opus model', async () => {
    const agentCalls: AgentCall[] = []
    const sendCalls: Array<{ chatId: string; text: string }> = []
    const ctx = makeContext(agentCalls, sendCalls)

    await mod.handle(ctx)

    expect(agentCalls).toHaveLength(1)
    expect(agentCalls[0].model).toBe(REPORT_MODEL)
  })

  test('prompt contains market-pulse skill keyword', async () => {
    const agentCalls: AgentCall[] = []
    const ctx = makeContext(agentCalls, [])
    await mod.handle(ctx)
    expect(agentCalls[0].prompt).toContain('market-pulse')
  })

  test('prompt contains event-calendar skill keyword', async () => {
    const agentCalls: AgentCall[] = []
    const ctx = makeContext(agentCalls, [])
    await mod.handle(ctx)
    expect(agentCalls[0].prompt).toContain('event-calendar')
  })

  test('prompt contains thesis-tracker skill keyword', async () => {
    const agentCalls: AgentCall[] = []
    const ctx = makeContext(agentCalls, [])
    await mod.handle(ctx)
    expect(agentCalls[0].prompt).toContain('thesis-tracker')
  })

  test('prompt contains portfolio-manager skill keyword', async () => {
    const agentCalls: AgentCall[] = []
    const ctx = makeContext(agentCalls, [])
    await mod.handle(ctx)
    expect(agentCalls[0].prompt).toContain('portfolio-manager')
  })

  test('result is sent to REPORT_DM', async () => {
    const sendCalls: Array<{ chatId: string; text: string }> = []
    const ctx = makeContext([], sendCalls)
    await mod.handle(ctx)
    expect(sendCalls.some(c => c.chatId === REPORT_DM)).toBe(true)
  })

  test('no-op when trigger.kind is not cron', async () => {
    const agentCalls: AgentCall[] = []
    const ctx = makeContext(agentCalls, [])
    ;(ctx as { trigger: { kind: string } }).trigger = { kind: 'message' } as never
    await mod.handle(ctx as never)
    expect(agentCalls).toHaveLength(0)
  })
})

// ── report:premarket ─────────────────────────────────────────────────────────

describe('report:premarket', () => {
  const mod = reportModules.find(m => m.name === 'report:premarket')!

  test('module exists and has correct cron', () => {
    expect(mod).toBeDefined()
    expect(mod.cron).toBe('0 21 * * *')
  })

  test('runs agent with Opus model', async () => {
    const agentCalls: AgentCall[] = []
    const ctx = makeContext(agentCalls, [])
    await mod.handle(ctx)
    expect(agentCalls[0].model).toBe(REPORT_MODEL)
  })

  test('prompt mentions futu real-position pull', async () => {
    const agentCalls: AgentCall[] = []
    const ctx = makeContext(agentCalls, [])
    await mod.handle(ctx)
    expect(agentCalls[0].prompt).toContain('futu')
  })

  test('prompt contains market-data skill keyword', async () => {
    const agentCalls: AgentCall[] = []
    const ctx = makeContext(agentCalls, [])
    await mod.handle(ctx)
    expect(agentCalls[0].prompt).toContain('market-data')
  })

  test('prompt contains news-dashboard skill keyword', async () => {
    const agentCalls: AgentCall[] = []
    const ctx = makeContext(agentCalls, [])
    await mod.handle(ctx)
    expect(agentCalls[0].prompt).toContain('news-dashboard')
  })

  test('result sent to REPORT_DM', async () => {
    const sendCalls: Array<{ chatId: string; text: string }> = []
    const ctx = makeContext([], sendCalls)
    await mod.handle(ctx)
    expect(sendCalls.some(c => c.chatId === REPORT_DM)).toBe(true)
  })
})

// ── report:close ─────────────────────────────────────────────────────────────

describe('report:close', () => {
  const mod = reportModules.find(m => m.name === 'report:close')!

  test('module exists and has correct cron', () => {
    expect(mod).toBeDefined()
    expect(mod.cron).toBe('0 6 * * *')
  })

  test('runs agent with Opus model', async () => {
    const agentCalls: AgentCall[] = []
    const ctx = makeContext(agentCalls, [])
    await mod.handle(ctx)
    expect(agentCalls[0].model).toBe(REPORT_MODEL)
  })

  test('prompt contains trade-journal skill keyword', async () => {
    const agentCalls: AgentCall[] = []
    const ctx = makeContext(agentCalls, [])
    await mod.handle(ctx)
    expect(agentCalls[0].prompt).toContain('trade-journal')
  })

  test('prompt contains market-pulse skill keyword', async () => {
    const agentCalls: AgentCall[] = []
    const ctx = makeContext(agentCalls, [])
    await mod.handle(ctx)
    expect(agentCalls[0].prompt).toContain('market-pulse')
  })

  test('prompt contains sector-analyst skill keyword', async () => {
    const agentCalls: AgentCall[] = []
    const ctx = makeContext(agentCalls, [])
    await mod.handle(ctx)
    expect(agentCalls[0].prompt).toContain('sector-analyst')
  })

  test('result sent to REPORT_DM', async () => {
    const sendCalls: Array<{ chatId: string; text: string }> = []
    const ctx = makeContext([], sendCalls)
    await mod.handle(ctx)
    expect(sendCalls.some(c => c.chatId === REPORT_DM)).toBe(true)
  })
})

// ── reportModules array ───────────────────────────────────────────────────────

describe('reportModules exports', () => {
  test('exports exactly 3 modules', () => {
    expect(reportModules).toHaveLength(3)
  })

  test('all modules have cron field set', () => {
    for (const mod of reportModules) {
      expect(mod.cron).toBeDefined()
      expect(typeof mod.cron).toBe('string')
    }
  })

  test('all modules have unique names', () => {
    const names = reportModules.map(m => m.name)
    expect(new Set(names).size).toBe(names.length)
  })
})
