/**
 * dispatcher.test.ts — Unit tests for Dispatcher (Batch B + M7).
 *
 * All tests use mock channels + mock agent; no real SDK or network calls.
 */

import { describe, test, expect, afterEach } from 'bun:test'
import { Dispatcher, buildStreamingOnText, formatAgentError, extractDecisions, helpCard, formatLedger } from './dispatcher.js'
import type { QuoteFetcher } from './dispatcher.js'
import { REPORT_DM, STREAM_EDIT_INTERVAL_MS, STREAM_EDIT_MIN_CHARS, HAIKU_MODEL, SONNET_MODEL, OPUS_MODEL } from '../config.js'
import type { ChannelRegistry, AgentRunner, Memory, Safety, DB, Module, ModuleContext, EventPayload } from '../modules/module.js'
import type { InboundMsg } from '../channels/channel.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeInbound(overrides: Partial<InboundMsg> = {}): InboundMsg {
  return {
    channel: 'discord',
    chatId: 'chat-1',
    messageId: 'msg-1',
    user: 'testuser',
    userId: 'uid-1',
    ts: '2026-06-07T00:00:00.000Z',
    content: 'hello',
    ...overrides,
  }
}

interface SendCall {
  channel: string
  chatId: string
  text: string
  opts: { replyTo?: string } | undefined
}

interface EditCall {
  channel: string
  chatId: string
  msgId: string
  text: string
}

function makeRegistry(opts?: {
  sendIds?: string[]
  editThrows?: boolean
  sendTypingThrows?: boolean
  sendThrows?: boolean
}): {
  registry: ChannelRegistry
  calls: SendCall[]
  editCalls: EditCall[]
  typingCalls: Array<{ channel: string; chatId: string }>
} {
  const calls: SendCall[] = []
  const editCalls: EditCall[] = []
  const typingCalls: Array<{ channel: string; chatId: string }> = []
  let sendIdx = 0
  const registry: ChannelRegistry = {
    async send(channel, chatId, text, opts2) {
      if (opts?.sendThrows) throw new Error('send failed')
      calls.push({ channel, chatId, text, opts: opts2 })
      const id = opts?.sendIds?.[sendIdx++] ?? 'sent-msg-id'
      return id
    },
    async edit(channel, chatId, msgId, text) {
      if (opts?.editThrows) throw new Error('edit failed')
      editCalls.push({ channel, chatId, msgId, text })
    },
    async sendTyping(channel, chatId) {
      if (opts?.sendTypingThrows) throw new Error('typing failed')
      typingCalls.push({ channel, chatId })
    },
  }
  return { registry, calls, editCalls, typingCalls }
}

function makeAgent(opts: {
  result?: { sessionId?: string; text: string }
  delayMs?: number
  calls?: Array<{ prompt: string; resume?: string }>
}): AgentRunner {
  const { result = { sessionId: 's1', text: 'reply' }, delayMs = 0, calls } = opts
  return {
    async run({ prompt, resume }) {
      if (calls) calls.push({ prompt, resume })
      if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs))
      return result
    },
  }
}

const passMemory: Memory = {
  loadPortfolioState: () => null,
  riskProfile: () => '',
  buildContext: () => '',
}

const passSafety: Safety = {
  canUseTool: async () => ({ behavior: 'allow' }),
}

const nullDb: DB = {
  getSession: () => null,
  putSession: () => {},
  audit: () => {},
  getJob: () => null,
  upsertJob: () => {},
  markJobRun: () => {},
  getCooldown: () => null,
  setCooldown: () => {},
}

/** Create a tracking DB that records putSession and audit calls. */
function makeTrackingDb(): { db: DB; sessions: Map<string, string>; auditRows: Array<{ kind: string; payload: string }> } {
  const sessions = new Map<string, string>()
  const auditRows: Array<{ kind: string; payload: string }> = []
  const db: DB = {
    getSession: (_channel, chatId) => {
      const id = sessions.get(chatId)
      return id ? { sdkSessionId: id } : null
    },
    putSession: (_channel, chatId, data) => {
      sessions.set(chatId, data.sdkSessionId)
    },
    audit: (row) => {
      auditRows.push({ kind: row.kind, payload: row.payload })
    },
    getJob: () => null,
    upsertJob: () => {},
    markJobRun: () => {},
    getCooldown: () => null,
    setCooldown: () => {},
  }
  return { db, sessions, auditRows }
}

// ── Serial queue: same chatId ─────────────────────────────────────────────────

describe('per-chat serial queue', () => {
  test('same chatId: second message waits for first to complete', async () => {
    const order: number[] = []
    let resolveFirst!: () => void

    const agent: AgentRunner = {
      async run() {
        // First call blocks until resolveFirst() is called
        if (order.length === 0) {
          order.push(1)
          await new Promise<void>(r => { resolveFirst = r })
        } else {
          order.push(2)
        }
        return { sessionId: 's1', text: 'ok' }
      },
    }

    const { registry } = makeRegistry()
    const dispatcher = new Dispatcher([], registry, agent, nullDb, passMemory, passSafety)

    const p1 = dispatcher.dispatch(makeInbound({ chatId: 'same-chat', messageId: 'msg-1' }))
    const p2 = dispatcher.dispatch(makeInbound({ chatId: 'same-chat', messageId: 'msg-2' }))

    // Give event loop a tick — p1 should have started (order=[1]), p2 should be queued
    await new Promise(r => setTimeout(r, 10))
    expect(order).toEqual([1])

    // Unblock first
    resolveFirst()
    await Promise.all([p1, p2])

    expect(order).toEqual([1, 2])
  })

  test('different chatIds run concurrently', async () => {
    const started: string[] = []
    const finished: string[] = []

    const agent: AgentRunner = {
      async run({ prompt }) {
        const id = prompt // we use prompt as a tag
        started.push(id)
        await new Promise(r => setTimeout(r, 20)) // small delay
        finished.push(id)
        return { text: 'ok' }
      },
    }

    const { registry } = makeRegistry()
    const dispatcher = new Dispatcher([], registry, agent, nullDb, passMemory, passSafety)

    const p1 = dispatcher.dispatch(makeInbound({ chatId: 'chat-A', content: 'message one' }))
    const p2 = dispatcher.dispatch(makeInbound({ chatId: 'chat-B', content: 'message two' }))

    await Promise.all([p1, p2])

    // Both started before either finished (concurrent)
    expect(started.length).toBe(2)
    expect(finished.length).toBe(2)
  })
})

// ── Default conversation route ─────────────────────────────────────────────────

describe('default conversation route', () => {
  test('calls agent.run and edits placeholder with response text', async () => {
    const agentCalls: Array<{ prompt: string; resume?: string }> = []
    const agent = makeAgent({ result: { sessionId: 's1', text: 'hi there' }, calls: agentCalls })
    const { registry, calls, editCalls } = makeRegistry({ sendIds: ['placeholder-id'] })

    const dispatcher = new Dispatcher([], registry, agent, nullDb, passMemory, passSafety)
    await dispatcher.dispatch(makeInbound({ chatId: 'chat-1', messageId: 'msg-x', content: 'hello' }))

    expect(agentCalls).toHaveLength(1)
    // Placeholder send
    expect(calls).toHaveLength(1)
    expect(calls[0].text).toBe('💬 稍等…')
    expect(calls[0].opts?.replyTo).toBe('msg-x')
    // Final text via edit
    expect(editCalls).toHaveLength(1)
    expect(editCalls[0].msgId).toBe('placeholder-id')
    expect(editCalls[0].text).toBe('hi there')
  })

  test('stores sessionId after first message', async () => {
    const agent = makeAgent({ result: { sessionId: 'ses-abc', text: 'ok' } })
    const { registry } = makeRegistry()
    const { db } = makeTrackingDb()

    const dispatcher = new Dispatcher([], registry, agent, db, passMemory, passSafety)
    await dispatcher.dispatch(makeInbound({ chatId: 'chat-2' }))

    expect(dispatcher.sessionMapGet('discord', 'chat-2')).toBe('ses-abc')
  })

  test('second message in same chat sends resume from first session', async () => {
    const agentCalls: Array<{ prompt: string; resume?: string }> = []
    const agent = makeAgent({ result: { sessionId: 's1', text: 'reply' }, calls: agentCalls })
    const { registry } = makeRegistry()
    const { db } = makeTrackingDb()

    const dispatcher = new Dispatcher([], registry, agent, db, passMemory, passSafety)

    await dispatcher.dispatch(makeInbound({ chatId: 'chat-3', messageId: 'msg-1' }))
    await dispatcher.dispatch(makeInbound({ chatId: 'chat-3', messageId: 'msg-2' }))

    expect(agentCalls[0].resume).toBeUndefined()
    expect(agentCalls[1].resume).toBe('s1')
  })

  test('edits placeholder with (no response) when agent returns empty text', async () => {
    const agent = makeAgent({ result: { sessionId: 's1', text: '' } })
    const { registry, editCalls } = makeRegistry({ sendIds: ['ph-id'] })

    const dispatcher = new Dispatcher([], registry, agent, nullDb, passMemory, passSafety)
    await dispatcher.dispatch(makeInbound({ chatId: 'chat-4' }))

    expect(editCalls).toHaveLength(1)
    expect(editCalls[0].text).toBe('(no response)')
  })

  test('edits placeholder with error message when agent.run throws', async () => {
    const agent: AgentRunner = {
      async run() { throw new Error('SDK exploded') },
    }
    const { registry, calls, editCalls } = makeRegistry({ sendIds: ['ph-err'] })
    const { db, sessions } = makeTrackingDb()

    const dispatcher = new Dispatcher([], registry, agent, db, passMemory, passSafety)
    await dispatcher.dispatch(makeInbound({ chatId: 'chat-5' }))

    // Placeholder was sent
    expect(calls).toHaveLength(1)
    expect(calls[0].text).toBe('💬 稍等…')
    // Error text via edit on placeholder
    expect(editCalls).toHaveLength(1)
    expect(editCalls[0].msgId).toBe('ph-err')
    expect(editCalls[0].text).toContain('⚠️')
    // session should NOT have been stored
    expect(sessions.has('chat-5')).toBe(false)
  })
})

// ── memory.buildContext injection ─────────────────────────────────────────────

describe('memory.buildContext is injected into prompt', () => {
  test('prompt contains context prefix keywords', async () => {
    const agentCalls: Array<{ prompt: string; resume?: string }> = []
    const agent = makeAgent({ result: { text: 'ok' }, calls: agentCalls })
    const { registry } = makeRegistry()

    const richMemory: Memory = {
      loadPortfolioState: () => null,
      riskProfile: () => '',
      buildContext: () => '【风险画像】\n• 仓位：几乎满仓，现金 <10%',
    }

    const dispatcher = new Dispatcher([], registry, agent, nullDb, richMemory, passSafety)
    await dispatcher.dispatch(makeInbound({ chatId: 'ctx-test', content: 'NVDA?', userId: '1086665220723855560' }))

    expect(agentCalls).toHaveLength(1)
    expect(agentCalls[0].prompt).toContain('【风险画像】')
    expect(agentCalls[0].prompt).toContain('NVDA?')
  })

  test('prompt contains separator when context is non-empty', async () => {
    const agentCalls: Array<{ prompt: string; resume?: string }> = []
    const agent = makeAgent({ result: { text: 'ok' }, calls: agentCalls })
    const { registry } = makeRegistry()

    const richMemory: Memory = {
      loadPortfolioState: () => null,
      riskProfile: () => '',
      buildContext: () => 'some context',
    }

    const dispatcher = new Dispatcher([], registry, agent, nullDb, richMemory, passSafety)
    await dispatcher.dispatch(makeInbound({ chatId: 'ctx-sep', content: 'hello' }))

    expect(agentCalls[0].prompt).toContain('---')
  })

  test('always injects current-time line (agent time concept)', async () => {
    const agentCalls: Array<{ prompt: string; resume?: string }> = []
    const agent = makeAgent({ result: { text: 'ok' }, calls: agentCalls })
    const { registry } = makeRegistry()

    const dispatcher = new Dispatcher([], registry, agent, nullDb, passMemory, passSafety)
    await dispatcher.dispatch(makeInbound({ chatId: 'ctx-empty', content: 'hello' }))

    // nowLine is always prepended → time marker present + user message present.
    expect(agentCalls[0].prompt).toContain('【当前时间】')
    expect(agentCalls[0].prompt).toContain('hello')
  })
})

// ── Module match takes priority ───────────────────────────────────────────────

describe('module dispatch', () => {
  test('matching module handles instead of default route', async () => {
    const agentCalls: Array<{ prompt: string }> = []
    const agent: AgentRunner = {
      async run(o) {
        agentCalls.push({ prompt: o.prompt })
        return { text: 'agent reply' }
      },
    }

    let moduleCalled = false
    const mod: Module = {
      name: 'test-mod',
      match: () => true,
      async handle() { moduleCalled = true },
    }

    const { registry } = makeRegistry()
    const dispatcher = new Dispatcher([mod], registry, agent, nullDb, passMemory, passSafety)
    await dispatcher.dispatch(makeInbound())

    expect(moduleCalled).toBe(true)
    expect(agentCalls).toHaveLength(0)
  })

  test('non-matching module falls through to default route', async () => {
    const agentCalls: Array<{ prompt: string }> = []
    const agent: AgentRunner = {
      async run(o) {
        agentCalls.push({ prompt: o.prompt })
        return { text: 'default' }
      },
    }

    const mod: Module = {
      name: 'no-match',
      match: () => false,
      async handle() {},
    }

    const { registry } = makeRegistry()
    const dispatcher = new Dispatcher([mod], registry, agent, nullDb, passMemory, passSafety)
    await dispatcher.dispatch(makeInbound())

    expect(agentCalls).toHaveLength(1)
  })
})

// ── DB integration: audit + putSession ───────────────────────────────────────

describe('DB integration', () => {
  test('audit in and out rows are written on successful dispatch', async () => {
    const agent = makeAgent({ result: { sessionId: 's1', text: 'response text' } })
    const { registry } = makeRegistry()
    const { db, auditRows } = makeTrackingDb()

    const dispatcher = new Dispatcher([], registry, agent, db, passMemory, passSafety)
    await dispatcher.dispatch(makeInbound({ content: 'user message', user: 'alice' }))

    const inRow = auditRows.find(r => r.kind === 'in')
    const outRow = auditRows.find(r => r.kind === 'out')

    expect(inRow).toBeDefined()
    expect(inRow!.payload).toContain('user message')
    expect(outRow).toBeDefined()
    expect(outRow!.payload).toContain('response text')
  })

  test('audit error row is written when agent throws', async () => {
    const agent: AgentRunner = {
      async run() { throw new Error('network error') },
    }
    const { registry } = makeRegistry()
    const { db, auditRows } = makeTrackingDb()

    const dispatcher = new Dispatcher([], registry, agent, db, passMemory, passSafety)
    await dispatcher.dispatch(makeInbound())

    const errRow = auditRows.find(r => r.kind === 'error')
    expect(errRow).toBeDefined()
    expect(errRow!.payload).toContain('network error')
  })

  test('putSession is called with returned sessionId', async () => {
    const agent = makeAgent({ result: { sessionId: 'db-session-1', text: 'ok' } })
    const { registry } = makeRegistry()
    const { db, sessions } = makeTrackingDb()

    const dispatcher = new Dispatcher([], registry, agent, db, passMemory, passSafety)
    await dispatcher.dispatch(makeInbound({ chatId: 'chat-db', channel: 'discord' }))

    expect(sessions.get('chat-db')).toBe('db-session-1')
  })

  test('second dispatch resumes from DB-stored session', async () => {
    const agentCalls: Array<{ prompt: string; resume?: string }> = []
    const agent = makeAgent({ result: { sessionId: 'db-sess', text: 'ok' }, calls: agentCalls })
    const { registry } = makeRegistry()
    const { db } = makeTrackingDb()

    const dispatcher = new Dispatcher([], registry, agent, db, passMemory, passSafety)
    await dispatcher.dispatch(makeInbound({ chatId: 'chat-resume', messageId: 'msg-1' }))
    await dispatcher.dispatch(makeInbound({ chatId: 'chat-resume', messageId: 'msg-2' }))

    expect(agentCalls[0].resume).toBeUndefined()
    expect(agentCalls[1].resume).toBe('db-sess')
  })
})

// ── Progress feedback (Batch D) ───────────────────────────────────────────────

describe('progress feedback', () => {
  test('placeholder is sent before agent runs', async () => {
    const order: string[] = []
    let resolveAgent!: () => void

    const agent: AgentRunner = {
      async run() {
        order.push('agent-start')
        await new Promise<void>(r => { resolveAgent = r })
        order.push('agent-end')
        return { text: 'done' }
      },
    }

    const { registry, calls } = makeRegistry({ sendIds: ['ph-1'] })
    const dispatcher = new Dispatcher([], registry, agent, nullDb, passMemory, passSafety)

    const p = dispatcher.dispatch(makeInbound({ chatId: 'pf-1' }))
    // Give a tick for the send to fire
    await new Promise(r => setTimeout(r, 5))

    expect(calls.length).toBeGreaterThanOrEqual(1)
    expect(calls[0].text).toBe('💬 稍等…')
    expect(order).toContain('agent-start')

    resolveAgent()
    await p
  })

  test('final answer ≤2000: edit placeholder', async () => {
    const agent = makeAgent({ result: { text: 'short answer' } })
    const { registry, calls, editCalls } = makeRegistry({ sendIds: ['ph-2'] })

    const dispatcher = new Dispatcher([], registry, agent, nullDb, passMemory, passSafety)
    await dispatcher.dispatch(makeInbound({ chatId: 'pf-2' }))

    expect(calls).toHaveLength(1) // only placeholder
    expect(editCalls).toHaveLength(1)
    expect(editCalls[0].msgId).toBe('ph-2')
    expect(editCalls[0].text).toBe('short answer')
  })

  test('final answer >2000: edit placeholder with chunk[0], send remaining chunks', async () => {
    const longText = 'A'.repeat(2001) + '\n\n' + 'B'.repeat(100)
    const agent = makeAgent({ result: { text: longText } })
    const { registry, calls, editCalls } = makeRegistry({ sendIds: ['ph-3'] })

    const dispatcher = new Dispatcher([], registry, agent, nullDb, passMemory, passSafety)
    await dispatcher.dispatch(makeInbound({ chatId: 'pf-3' }))

    // placeholder send + at least 1 extra chunk send
    expect(calls.length).toBeGreaterThanOrEqual(2)
    expect(calls[0].text).toBe('💬 稍等…')
    // edit for first chunk
    expect(editCalls.length).toBeGreaterThanOrEqual(1)
    expect(editCalls[0].msgId).toBe('ph-3')
  })

  test('agent error: edit placeholder with error text', async () => {
    const agent: AgentRunner = {
      async run() { throw new Error('boom') },
    }
    const { registry, calls, editCalls } = makeRegistry({ sendIds: ['ph-err'] })

    const dispatcher = new Dispatcher([], registry, agent, nullDb, passMemory, passSafety)
    await dispatcher.dispatch(makeInbound({ chatId: 'pf-err' }))

    expect(calls[0].text).toBe('💬 稍等…')
    expect(editCalls[0].text).toContain('⚠️')
  })

  test('degradation: if initial send fails, falls back to plain send of final answer', async () => {
    const agent = makeAgent({ result: { text: 'fallback answer' } })
    const { registry, calls, editCalls } = makeRegistry({ sendThrows: true })

    // Override: first send throws, subsequent sends work
    let sendCount = 0
    const fallbackRegistry: ChannelRegistry = {
      async send(_ch, _cid, text, opts) {
        sendCount++
        if (sendCount === 1) throw new Error('send failed')
        calls.push({ channel: _ch, chatId: _cid, text, opts })
        return 'fallback-id'
      },
      async edit(_ch, _cid, msgId, text) {
        editCalls.push({ channel: _ch, chatId: _cid, msgId, text })
      },
      async sendTyping() {},
    }

    const dispatcher = new Dispatcher([], fallbackRegistry, agent, nullDb, passMemory, passSafety)
    await dispatcher.dispatch(makeInbound({ chatId: 'pf-fallback' }))

    // After placeholder fails, final answer sent as new message
    expect(calls.length).toBeGreaterThanOrEqual(1)
    expect(calls.find(c => c.text === 'fallback answer')).toBeDefined()
  })

  test('degradation: if edit fails, falls back to send of final answer', async () => {
    const agent = makeAgent({ result: { text: 'edit-fallback' } })
    const { registry, calls, editCalls } = makeRegistry({ sendIds: ['ph-ef'], editThrows: true })

    const dispatcher = new Dispatcher([], registry, agent, nullDb, passMemory, passSafety)
    await dispatcher.dispatch(makeInbound({ chatId: 'pf-edit-fallback' }))

    // placeholder was sent
    expect(calls[0].text).toBe('💬 稍等…')
    // edit was attempted (and threw)
    expect(editCalls).toHaveLength(0) // the registry throws before pushing
    // fallback: final answer sent as a new message
    const finalCall = calls.find(c => c.text === 'edit-fallback')
    expect(finalCall).toBeDefined()
  })
})

// ── Guardrail injection ───────────────────────────────────────────────────────

describe('guardrail injection', () => {
  test('triggered keyword: prompt contains guardrail instruction with pre-mortem', async () => {
    const agentCalls: Array<{ prompt: string }> = []
    const agent: AgentRunner = {
      async run(o) {
        agentCalls.push({ prompt: o.prompt })
        return { text: 'ok' }
      },
    }
    const { registry } = makeRegistry()
    const dispatcher = new Dispatcher([], registry, agent, nullDb, passMemory, passSafety)

    await dispatcher.dispatch(makeInbound({ content: 'SOXL 抄底时机', userId: '1086665220723855560' }))

    expect(agentCalls).toHaveLength(1)
    expect(agentCalls[0].prompt).toContain('强提醒')
    expect(agentCalls[0].prompt).toContain('弱点')
    expect(agentCalls[0].prompt).toContain('护栏提示')
  })

  test('triggered keyword: prompt still contains user message', async () => {
    const agentCalls: Array<{ prompt: string }> = []
    const agent: AgentRunner = {
      async run(o) {
        agentCalls.push({ prompt: o.prompt })
        return { text: 'ok' }
      },
    }
    const { registry } = makeRegistry()
    const dispatcher = new Dispatcher([], registry, agent, nullDb, passMemory, passSafety)

    await dispatcher.dispatch(makeInbound({ content: '满仓买 NVDA' }))

    // User message must still be in the prompt
    expect(agentCalls[0].prompt).toContain('满仓买 NVDA')
  })

  test('clean message: prompt does NOT contain guardrail instruction', async () => {
    const agentCalls: Array<{ prompt: string }> = []
    const agent: AgentRunner = {
      async run(o) {
        agentCalls.push({ prompt: o.prompt })
        return { text: 'ok' }
      },
    }
    const { registry } = makeRegistry()
    const dispatcher = new Dispatcher([], registry, agent, nullDb, passMemory, passSafety)

    await dispatcher.dispatch(makeInbound({ content: 'NVDA 怎么样' }))

    expect(agentCalls[0].prompt).not.toContain('护栏触发')
    expect(agentCalls[0].prompt).not.toContain('pre-mortem')
  })

  test('guardrail not injected when module match handles the message', async () => {
    const agentCalls: Array<{ prompt: string }> = []
    const agent: AgentRunner = {
      async run(o) {
        agentCalls.push({ prompt: o.prompt })
        return { text: 'ok' }
      },
    }

    let moduleCalled = false
    const mod: Module = {
      name: 'guard-mod',
      match: () => true,
      async handle() { moduleCalled = true },
    }

    const { registry } = makeRegistry()
    const dispatcher = new Dispatcher([mod], registry, agent, nullDb, passMemory, passSafety)
    await dispatcher.dispatch(makeInbound({ content: 'SOXL 梭哈' }))

    // Module handled it — agent was not called at all
    expect(moduleCalled).toBe(true)
    expect(agentCalls).toHaveLength(0)
  })
})

// ── runCron: real module path ──────────────────────────────────────────────────

describe('Dispatcher.runCron', () => {
  test('calls module.handle with trigger.kind === cron', async () => {
    const triggers: Array<{ kind: string }> = []
    const mod: Module = {
      name: 'report:morning',
      targetChat: REPORT_DM,
      async handle(ctx: ModuleContext) {
        triggers.push({ kind: ctx.trigger.kind })
      },
    }
    const { registry } = makeRegistry()
    const dispatcher = new Dispatcher([mod], registry, makeAgent({}), nullDb, passMemory, passSafety)

    await dispatcher.runCron('report:morning')

    expect(triggers).toHaveLength(1)
    expect(triggers[0].kind).toBe('cron')
  })

  test('no-op with stderr when module name not found', async () => {
    const { registry } = makeRegistry()
    const dispatcher = new Dispatcher([], registry, makeAgent({}), nullDb, passMemory, passSafety)

    // Should resolve (not reject) even for unknown name
    await expect(dispatcher.runCron('no-such-module')).resolves.toBeUndefined()
  })

  test('B1: cron with targetChat=REPORT_DM serialises with DM dispatch on same key', async () => {
    // Track concurrent in-flight count to ensure it never exceeds 1 for REPORT_DM
    let inflight = 0
    let maxConcurrent = 0

    const slowMod: Module = {
      name: 'report:morning',
      targetChat: REPORT_DM,
      async handle() {
        inflight++
        maxConcurrent = Math.max(maxConcurrent, inflight)
        await new Promise(r => setTimeout(r, 20))
        inflight--
      },
    }

    // The cron module is also registered as a match-all module for dispatch testing.
    // Use a separate slow dispatch handler via a custom agent.
    let dmInflight = 0
    const slowAgent: AgentRunner = {
      async run() {
        inflight++
        dmInflight++
        maxConcurrent = Math.max(maxConcurrent, inflight)
        await new Promise(r => setTimeout(r, 20))
        inflight--
        dmInflight--
        return { text: 'ok' }
      },
    }

    const { registry } = makeRegistry({ sendIds: ['ph-b1'] })
    const dispatcher = new Dispatcher([slowMod], registry, slowAgent, nullDb, passMemory, passSafety)

    // Fire a DM dispatch (chatId = REPORT_DM) and a cron concurrently
    const p1 = dispatcher.dispatch(makeInbound({ chatId: REPORT_DM, content: 'hello' }))
    const p2 = dispatcher.runCron('report:morning')

    await Promise.all([p1, p2])

    // Both completed, but never ran truly simultaneously on the same queue key
    expect(maxConcurrent).toBeLessThanOrEqual(1)
  })
})

// ── Dispatcher.drain ───────────────────────────────────────────────────────────

describe('Dispatcher.drain (B3)', () => {
  test('drain resolves only after in-flight dispatch completes', async () => {
    const order: string[] = []
    let resolveTask!: () => void

    const agent: AgentRunner = {
      async run() {
        order.push('task-start')
        await new Promise<void>(r => { resolveTask = r })
        order.push('task-end')
        return { text: 'done' }
      },
    }

    const { registry } = makeRegistry({ sendIds: ['ph-drain'] })
    const dispatcher = new Dispatcher([], registry, agent, nullDb, passMemory, passSafety)

    // Start a slow dispatch
    void dispatcher.dispatch(makeInbound({ chatId: 'drain-chat' }))

    // Give it a tick to start
    await new Promise(r => setTimeout(r, 5))
    expect(order).toContain('task-start')
    expect(order).not.toContain('task-end')

    // Start drain (should wait for the running task)
    const drainDone = dispatcher.drain()
    let drainResolved = false
    void drainDone.then(() => { drainResolved = true })

    // Drain should not have resolved yet
    await new Promise(r => setTimeout(r, 5))
    expect(drainResolved).toBe(false)

    // Unblock the task
    resolveTask()
    await drainDone

    expect(drainResolved).toBe(true)
    expect(order).toContain('task-end')
  })

  test('drain resolves immediately when no tasks are in flight', async () => {
    const { registry } = makeRegistry()
    const dispatcher = new Dispatcher([], registry, makeAgent({}), nullDb, passMemory, passSafety)

    await expect(dispatcher.drain()).resolves.toBeUndefined()
  })
})

// ── Dispatcher.dispatchEvent (M6 Batch 1) ────────────────────────────────────

describe('Dispatcher.dispatchEvent', () => {
  function makeEventPayload(overrides: Partial<EventPayload> = {}): EventPayload {
    return {
      event: 'stop_hit',
      key: 'stop_hit:AVGO',
      summary: 'AVGO 止损触发',
      ...overrides,
    }
  }

  test('routes to module subscribing to the event type', async () => {
    const handled: Array<{ event: string }> = []
    const alertMod: Module = {
      name: 'alerts',
      events: ['stop_hit', 'concentration_breach', 'thesis_decay'],
      targetChat: REPORT_DM,
      async handle(ctx: ModuleContext) {
        if (ctx.trigger.kind === 'event') {
          handled.push({ event: ctx.trigger.event })
        }
      },
    }

    const { registry } = makeRegistry()
    const dispatcher = new Dispatcher([alertMod], registry, makeAgent({}), nullDb, passMemory, passSafety)

    await dispatcher.dispatchEvent(makeEventPayload({ event: 'stop_hit' }), REPORT_DM)

    expect(handled).toHaveLength(1)
    expect(handled[0].event).toBe('stop_hit')
  })

  test('no-op with stderr when no module subscribes to the event', async () => {
    const { registry } = makeRegistry()
    const dispatcher = new Dispatcher([], registry, makeAgent({}), nullDb, passMemory, passSafety)

    await expect(
      dispatcher.dispatchEvent(makeEventPayload({ event: 'thesis_decay' }), REPORT_DM),
    ).resolves.toBeUndefined()
  })

  test('event goes into targetChat queue (serialised with DM dispatch)', async () => {
    let inflight = 0
    let maxConcurrent = 0

    const slowAlertMod: Module = {
      name: 'alerts',
      events: ['stop_hit'],
      targetChat: REPORT_DM,
      async handle() {
        inflight++
        maxConcurrent = Math.max(maxConcurrent, inflight)
        await new Promise(r => setTimeout(r, 20))
        inflight--
      },
    }

    const slowAgent: AgentRunner = {
      async run() {
        inflight++
        maxConcurrent = Math.max(maxConcurrent, inflight)
        await new Promise(r => setTimeout(r, 20))
        inflight--
        return { text: 'ok' }
      },
    }

    const { registry } = makeRegistry({ sendIds: ['ph-ev'] })
    const dispatcher = new Dispatcher([slowAlertMod], registry, slowAgent, nullDb, passMemory, passSafety)

    // Fire a DM dispatch and an event dispatch concurrently on the same REPORT_DM key
    const p1 = dispatcher.dispatch(makeInbound({ chatId: REPORT_DM, content: 'hello' }))
    const p2 = dispatcher.dispatchEvent(makeEventPayload(), REPORT_DM)

    await Promise.all([p1, p2])
    expect(maxConcurrent).toBeLessThanOrEqual(1)
  })

  test('event trigger bypasses guardrail (module handles without guardrail check)', async () => {
    // The guardrail is only applied in #process (message route).
    // Event route goes directly to module.handle.
    const agentCalls: Array<{ prompt: string }> = []
    const alertMod: Module = {
      name: 'alerts',
      events: ['stop_hit'],
      targetChat: REPORT_DM,
      async handle(ctx: ModuleContext) {
        if (ctx.trigger.kind === 'event') {
          // Module calls agent directly — no guardrail injected upstream
          const result = await ctx.agent.run({ prompt: ctx.trigger.payload.summary })
          agentCalls.push({ prompt: result.text })
        }
      },
    }

    const mockAgent: AgentRunner = {
      async run(opts) {
        return { text: `handled:${opts.prompt}` }
      },
    }

    const { registry } = makeRegistry()
    const dispatcher = new Dispatcher([alertMod], registry, mockAgent, nullDb, passMemory, passSafety)
    await dispatcher.dispatchEvent(makeEventPayload({ summary: 'AVGO 止损' }), REPORT_DM)

    // Agent was called by module directly (not via #process, so no guardrail prefix)
    expect(agentCalls).toHaveLength(1)
    expect(agentCalls[0].prompt).toBe('handled:AVGO 止损')
  })

  test('concentration_breach event routes to alerts module', async () => {
    const handled: EventPayload[] = []
    const alertMod: Module = {
      name: 'alerts',
      events: ['stop_hit', 'concentration_breach', 'thesis_decay'],
      targetChat: REPORT_DM,
      async handle(ctx: ModuleContext) {
        if (ctx.trigger.kind === 'event') handled.push(ctx.trigger.payload)
      },
    }

    const { registry } = makeRegistry()
    const dispatcher = new Dispatcher([alertMod], registry, makeAgent({}), nullDb, passMemory, passSafety)

    const payload = makeEventPayload({ event: 'concentration_breach', key: 'concentration_breach:semis' })
    await dispatcher.dispatchEvent(payload, REPORT_DM)

    expect(handled).toHaveLength(1)
    expect(handled[0].event).toBe('concentration_breach')
  })
})

// ── Audit enrich header (M6 Batch 1) ─────────────────────────────────────────

describe('Audit enrich header', () => {
  test('inbound audit payload contains src:message header', async () => {
    const agent = makeAgent({ result: { text: 'ok' } })
    const { registry } = makeRegistry()
    const { db, auditRows } = makeTrackingDb()

    const dispatcher = new Dispatcher([], registry, agent, db, passMemory, passSafety)
    await dispatcher.dispatch(makeInbound({ content: 'test message' }))

    const inRow = auditRows.find(r => r.kind === 'in')
    expect(inRow).toBeDefined()
    expect(inRow!.payload).toContain('"src":"message"')
    expect(inRow!.payload).toContain('test message')
  })

  test('outbound audit payload contains src:message header', async () => {
    const agent = makeAgent({ result: { text: 'reply text' } })
    const { registry } = makeRegistry()
    const { db, auditRows } = makeTrackingDb()

    const dispatcher = new Dispatcher([], registry, agent, db, passMemory, passSafety)
    await dispatcher.dispatch(makeInbound({ content: 'hello' }))

    const outRow = auditRows.find(r => r.kind === 'out')
    expect(outRow).toBeDefined()
    expect(outRow!.payload).toContain('"src":"message"')
  })

  test('inbound audit header contains portfolio_as_of when state available', async () => {
    const agent = makeAgent({ result: { text: 'ok' } })
    const { registry } = makeRegistry()
    const { db, auditRows } = makeTrackingDb()

    const richMemory: Memory = {
      loadPortfolioState: () => ({
        as_of: '2026-06-07 10:00',
        nav_usd: 22000,
        cash_usd: 1800,
        cash_pct: 8.2,
        ibkr_stale: false,
        positions: [],
      }),
      riskProfile: () => '',
      buildContext: () => '',
    }

    const dispatcher = new Dispatcher([], registry, agent, db, richMemory, passSafety)
    await dispatcher.dispatch(makeInbound({ content: 'hello' }))

    const inRow = auditRows.find(r => r.kind === 'in')
    expect(inRow!.payload).toContain('2026-06-07 10:00')
  })
})

// ── Disclaimer post-processing (M6 Batch 1) ──────────────────────────────────

describe('Dispatcher: disclaimer post-processing', () => {
  test('investment response gets disclaimer appended', async () => {
    const agent = makeAgent({ result: { text: 'AVGO 建议止损在 380 USD，方向：卖出' } })
    const { registry, editCalls } = makeRegistry({ sendIds: ['ph-disc'] })

    const dispatcher = new Dispatcher([], registry, agent, nullDb, passMemory, passSafety)
    await dispatcher.dispatch(makeInbound({ chatId: 'disc-1', content: 'AVGO 建议？' }))

    const editText = editCalls[0]?.text ?? ''
    expect(editText).toContain('AVGO')
    expect(editText).toContain('非投资建议')
  })

  test('casual response does NOT get disclaimer', async () => {
    const agent = makeAgent({ result: { text: '你好！有什么可以帮你？' } })
    const { registry, editCalls } = makeRegistry({ sendIds: ['ph-casual'] })

    const dispatcher = new Dispatcher([], registry, agent, nullDb, passMemory, passSafety)
    await dispatcher.dispatch(makeInbound({ chatId: 'casual-1', content: '你好' }))

    const editText = editCalls[0]?.text ?? ''
    // casual response text without investment keywords — no disclaimer
    expect(editText).not.toContain('非投资建议')
  })
})

// ── buildStreamingOnText throttle logic (M6 Batch 2) ────────────────────────

describe('buildStreamingOnText — throttle logic', () => {
  /** Build a controllable fake clock */
  function makeClock(start = 0) {
    let now = start
    return {
      tick: (ms: number) => { now += ms },
      now: () => now,
    }
  }

  test('no edit when elapsed time is below threshold', async () => {
    const editCalls: string[] = []
    const clock = makeClock(0)
    const { onText } = buildStreamingOnText(
      async (_ch, _cid, _mid, txt) => { editCalls.push(txt) },
      'discord', 'chat-1', 'msg-1', clock.now,
    )

    // Advance time by less than STREAM_EDIT_INTERVAL_MS
    clock.tick(STREAM_EDIT_INTERVAL_MS - 1)

    // Send enough chars to exceed char threshold
    const bigChunk = 'x'.repeat(STREAM_EDIT_MIN_CHARS + 10)
    onText(bigChunk)

    // Allow any pending microtasks to settle
    await new Promise(r => setTimeout(r, 10))
    expect(editCalls).toHaveLength(0)
  })

  test('no edit when char count is below threshold', async () => {
    const editCalls: string[] = []
    const clock = makeClock(0)
    const { onText } = buildStreamingOnText(
      async (_ch, _cid, _mid, txt) => { editCalls.push(txt) },
      'discord', 'chat-1', 'msg-1', clock.now,
    )

    // Advance time well past threshold
    clock.tick(STREAM_EDIT_INTERVAL_MS + 500)

    // Send fewer chars than threshold
    const smallChunk = 'x'.repeat(STREAM_EDIT_MIN_CHARS - 1)
    onText(smallChunk)

    await new Promise(r => setTimeout(r, 10))
    expect(editCalls).toHaveLength(0)
  })

  test('edit fires when BOTH time and char thresholds are met', async () => {
    const editCalls: string[] = []
    const clock = makeClock(0)
    const { onText } = buildStreamingOnText(
      async (_ch, _cid, _mid, txt) => { editCalls.push(txt) },
      'discord', 'chat-1', 'msg-1', clock.now,
    )

    clock.tick(STREAM_EDIT_INTERVAL_MS + 100)
    const chunk = 'x'.repeat(STREAM_EDIT_MIN_CHARS + 5)
    onText(chunk)

    await new Promise(r => setTimeout(r, 10))
    expect(editCalls).toHaveLength(1)
    expect(editCalls[0]).toBe(chunk)
  })

  test('second edit does not fire until both thresholds are met again', async () => {
    const editCalls: string[] = []
    const clock = makeClock(0)
    const { onText } = buildStreamingOnText(
      async (_ch, _cid, _mid, txt) => { editCalls.push(txt) },
      'discord', 'chat-1', 'msg-1', clock.now,
    )

    // First qualifying edit
    clock.tick(STREAM_EDIT_INTERVAL_MS + 100)
    onText('x'.repeat(STREAM_EDIT_MIN_CHARS + 5))
    await new Promise(r => setTimeout(r, 10))
    expect(editCalls).toHaveLength(1)

    // Add more chars but do NOT advance time
    onText('y'.repeat(STREAM_EDIT_MIN_CHARS + 5))
    await new Promise(r => setTimeout(r, 10))
    // Should still be only 1 edit because time hasn't advanced
    expect(editCalls).toHaveLength(1)

    // Advance time past threshold again and add more chars
    clock.tick(STREAM_EDIT_INTERVAL_MS + 100)
    onText('z'.repeat(STREAM_EDIT_MIN_CHARS + 5))
    await new Promise(r => setTimeout(r, 10))
    expect(editCalls).toHaveLength(2)
  })

  test('edit text is truncated to 2000 chars when accumulated text is longer', async () => {
    const editCalls: string[] = []
    const clock = makeClock(0)
    const { onText } = buildStreamingOnText(
      async (_ch, _cid, _mid, txt) => { editCalls.push(txt) },
      'discord', 'chat-1', 'msg-1', clock.now,
    )

    clock.tick(STREAM_EDIT_INTERVAL_MS + 100)
    // Send more than 2000 chars
    onText('a'.repeat(2100))
    await new Promise(r => setTimeout(r, 10))
    expect(editCalls).toHaveLength(1)
    expect(editCalls[0].length).toBe(2000)
  })

  test('edit errors disable subsequent streaming edits (degradation)', async () => {
    let editCount = 0
    const clock = makeClock(0)
    const { onText } = buildStreamingOnText(
      async () => {
        editCount++
        throw new Error('429 rate limited')
      },
      'discord', 'chat-1', 'msg-1', clock.now,
    )

    // First qualifying call — throws
    clock.tick(STREAM_EDIT_INTERVAL_MS + 100)
    onText('x'.repeat(STREAM_EDIT_MIN_CHARS + 5))
    await new Promise(r => setTimeout(r, 20))
    expect(editCount).toBe(1)

    // Subsequent qualifying calls — should be silently skipped (disabled flag)
    clock.tick(STREAM_EDIT_INTERVAL_MS + 100)
    onText('y'.repeat(STREAM_EDIT_MIN_CHARS + 5))
    await new Promise(r => setTimeout(r, 20))
    expect(editCount).toBe(1) // no additional edit calls
  })

  test('getAccumulated returns full text regardless of throttle', () => {
    const clock = makeClock(0)
    const { onText, getAccumulated } = buildStreamingOnText(
      async () => {},
      'discord', 'chat-1', 'msg-1', clock.now,
    )

    // Time is 0 — no edit should fire (below threshold)
    onText('hello ')
    onText('world')
    expect(getAccumulated()).toBe('hello world')
  })
})

// ── Dispatcher streaming integration (M6 Batch 2) ────────────────────────────

describe('Dispatcher streaming integration', () => {
  test('streaming onText calls edit before agent completes', async () => {
    const editCalls: EditCall[] = []
    let resolveAgent!: () => void

    // Agent that uses onText to stream deltas, then resolves
    const streamingAgent: AgentRunner = {
      async run({ onText }) {
        onText?.('streaming preview text with enough chars to trigger edit if time passes')
        await new Promise<void>(r => { resolveAgent = r })
        return { sessionId: 's1', text: 'final text' }
      },
    }

    const registry: ChannelRegistry = {
      async send(_ch, _cid, text) {
        if (text.startsWith('🔍') || text.startsWith('🔬') || text.startsWith('💬')) return 'ph-stream'
        return 'other-id'
      },
      async edit(_ch, _cid, msgId, text) {
        editCalls.push({ channel: _ch, chatId: _cid, msgId, text })
      },
      async sendTyping() {},
    }

    const dispatcher = new Dispatcher([], registry, streamingAgent, nullDb, passMemory, passSafety)
    const p = dispatcher.dispatch(makeInbound({ chatId: 'stream-chat' }))

    // Give a tick for the agent to start and call onText
    await new Promise(r => setTimeout(r, 5))

    resolveAgent()
    await p

    // The final edit should always have happened (terminal edit)
    const finalEdit = editCalls.find(e => e.text === 'final text')
    expect(finalEdit).toBeDefined()
  })
})

// ── M7: Three-tier routing ────────────────────────────────────────────────────

/** Mock quote fetcher — injected into Dispatcher for M7 tests to avoid spawning python. */
const mockQuoteFetcher: QuoteFetcher = async (symbols: string[]) => `MOCK_QUOTE: ${symbols.join(',')}`

describe('M7: tier routing — L0 quote', () => {
  test('quote message with ticker → calls quoteFetcher, NOT agent', async () => {
    const agentCalls: string[] = []
    const agent: AgentRunner = {
      async run({ prompt }) {
        agentCalls.push(prompt)
        return { text: 'agent reply' }
      },
    }

    const { registry, calls } = makeRegistry()
    const dispatcher = new Dispatcher([], registry, agent, nullDb, passMemory, passSafety, mockQuoteFetcher)

    await dispatcher.dispatch(makeInbound({ content: 'NVDA 现价多少', chatId: 'q-chat' }))

    // Agent should NOT have been called
    expect(agentCalls).toHaveLength(0)
    // Quote result was sent (via channels.send, not edit)
    const quoteMsg = calls.find(c => c.text.includes('MOCK_QUOTE'))
    expect(quoteMsg).toBeDefined()
    expect(quoteMsg?.text).toContain('US.NVDA')
  })

  test('quote message without resolvable symbol → falls through to agent (sonnet)', async () => {
    const agentCalls: Array<{ model?: string }> = []
    const agent: AgentRunner = {
      async run({ model }) {
        agentCalls.push({ model })
        return { text: 'agent reply' }
      },
    }

    const { registry } = makeRegistry()
    const dispatcher = new Dispatcher([], registry, agent, nullDb, passMemory, passSafety, mockQuoteFetcher)

    // No resolvable symbol/name → should fall through to sonnet
    await dispatcher.dispatch(makeInbound({ content: '这家公司股价多少', chatId: 'q-fallback' }))

    expect(agentCalls).toHaveLength(1)
    expect(agentCalls[0].model).toBe(SONNET_MODEL)
  })
})

describe('M7: tier routing — L2 opus model', () => {
  test('deep analysis keyword → agent.run receives opus model', async () => {
    const agentCalls: Array<{ model?: string }> = []
    const agent: AgentRunner = {
      async run({ model }) {
        agentCalls.push({ model })
        return { text: 'deep analysis' }
      },
    }

    const { registry } = makeRegistry()
    const dispatcher = new Dispatcher([], registry, agent, nullDb, passMemory, passSafety, mockQuoteFetcher)

    await dispatcher.dispatch(makeInbound({ content: 'NVDA 深度分析', chatId: 'opus-chat' }))

    expect(agentCalls).toHaveLength(1)
    expect(agentCalls[0].model).toBe(OPUS_MODEL)
  })

  test('该不该买 → opus model', async () => {
    const agentCalls: Array<{ model?: string }> = []
    const agent: AgentRunner = {
      async run({ model }) { agentCalls.push({ model }); return { text: 'ok' } },
    }
    const { registry } = makeRegistry()
    const dispatcher = new Dispatcher([], registry, agent, nullDb, passMemory, passSafety, mockQuoteFetcher)

    await dispatcher.dispatch(makeInbound({ content: 'NVDA 该不该买', chatId: 'opus-buy' }))

    expect(agentCalls[0].model).toBe(OPUS_MODEL)
  })
})

describe('M7: tier routing — model by tier', () => {
  test('casual greeting → agent.run receives haiku model (P0)', async () => {
    const agentCalls: Array<{ model?: string }> = []
    const agent: AgentRunner = {
      async run({ model }) {
        agentCalls.push({ model })
        return { text: 'hello!' }
      },
    }

    const { registry } = makeRegistry()
    const dispatcher = new Dispatcher([], registry, agent, nullDb, passMemory, passSafety, mockQuoteFetcher)

    await dispatcher.dispatch(makeInbound({ content: '你好', chatId: 'haiku-chat' }))

    expect(agentCalls).toHaveLength(1)
    expect(agentCalls[0].model).toBe(HAIKU_MODEL)
  })

  test('news request → sonnet model', async () => {
    const agentCalls: Array<{ model?: string }> = []
    const agent: AgentRunner = {
      async run({ model }) { agentCalls.push({ model }); return { text: 'news' } },
    }
    const { registry } = makeRegistry()
    const dispatcher = new Dispatcher([], registry, agent, nullDb, passMemory, passSafety, mockQuoteFetcher)

    await dispatcher.dispatch(makeInbound({ content: '今天有什么市场新闻', chatId: 'news-chat' }))

    expect(agentCalls[0].model).toBe(SONNET_MODEL)
  })
})

describe('M7: audit header includes tier + model', () => {
  test('opus message: audit header contains tier:opus and opus model', async () => {
    const agent = makeAgent({ result: { text: 'analysis' } })
    const { registry } = makeRegistry()
    const { db, auditRows } = makeTrackingDb()

    const dispatcher = new Dispatcher([], registry, agent, db, passMemory, passSafety, mockQuoteFetcher)
    await dispatcher.dispatch(makeInbound({ content: 'NVDA 估值分析', chatId: 'audit-opus' }))

    const inRow = auditRows.find(r => r.kind === 'in')
    expect(inRow?.payload).toContain('"tier":"opus"')
    expect(inRow?.payload).toContain(OPUS_MODEL)
  })

  test('sonnet message: audit header contains tier:sonnet and sonnet model', async () => {
    const agent = makeAgent({ result: { text: 'hi' } })
    const { registry } = makeRegistry()
    const { db, auditRows } = makeTrackingDb()

    const dispatcher = new Dispatcher([], registry, agent, db, passMemory, passSafety, mockQuoteFetcher)
    await dispatcher.dispatch(makeInbound({ content: '今天有什么市场新闻', chatId: 'audit-sonnet' }))

    const inRow = auditRows.find(r => r.kind === 'in')
    expect(inRow?.payload).toContain('"tier":"sonnet"')
    expect(inRow?.payload).toContain(SONNET_MODEL)
  })

  test('quote message: audit header contains src:quote and tier:L0', async () => {
    const { registry } = makeRegistry()
    const { db, auditRows } = makeTrackingDb()
    const agent = makeAgent({ result: { text: '' } })

    const dispatcher = new Dispatcher([], registry, agent, db, passMemory, passSafety, mockQuoteFetcher)
    await dispatcher.dispatch(makeInbound({ content: 'NVDA 现价', chatId: 'audit-quote' }))

    const inRow = auditRows.find(r => r.kind === 'in')
    expect(inRow?.payload).toContain('"src":"quote"')
    expect(inRow?.payload).toContain('"tier":"L0"')
  })
})

// ── Phase 1: tier-aware mcpAllow and haiku context suppression ───────────────

describe('Phase 1: tier-aware mcpAllow', () => {
  /** Capture the mcpAllow passed to agent.run. */
  function makeMcpCapture() {
    const captured: Array<{ tier: string; mcpAllow?: readonly string[] }> = []
    const agent: AgentRunner = {
      async run(o) {
        // tier is not passed here directly; we record mcpAllow
        captured.push({ tier: '', mcpAllow: o.mcpAllow })
        return { text: 'ok' }
      },
    }
    return { agent, captured }
  }

  test('haiku tier → mcpAllow is []', async () => {
    const { agent, captured } = makeMcpCapture()
    const { registry } = makeRegistry()
    const d = new Dispatcher([], registry, agent, nullDb, passMemory, passSafety, mockQuoteFetcher)
    await d.dispatch(makeInbound({ content: '你好', chatId: 'mcp-haiku' }))
    expect(captured).toHaveLength(1)
    expect(captured[0]!.mcpAllow).toEqual([])
  })

  test('sonnet tier → mcpAllow is ["tavily"]', async () => {
    const { agent, captured } = makeMcpCapture()
    const { registry } = makeRegistry()
    const d = new Dispatcher([], registry, agent, nullDb, passMemory, passSafety, mockQuoteFetcher)
    // 今天市场新闻 → sonnet
    await d.dispatch(makeInbound({ content: '今天有什么市场新闻', chatId: 'mcp-sonnet' }))
    expect(captured).toHaveLength(1)
    expect(captured[0]!.mcpAllow).toEqual(['tavily'])
  })

  test('opus tier → mcpAllow is ["tavily","alpaca"]', async () => {
    const { agent, captured } = makeMcpCapture()
    const { registry } = makeRegistry()
    const d = new Dispatcher([], registry, agent, nullDb, passMemory, passSafety, mockQuoteFetcher)
    // 深度分析 → opus
    await d.dispatch(makeInbound({ content: 'NVDA 深度分析', chatId: 'mcp-opus' }))
    expect(captured).toHaveLength(1)
    expect(captured[0]!.mcpAllow).toEqual(['tavily', 'alpaca'])
  })
})

describe('Phase 1: haiku tier suppresses buildContext', () => {
  const CONTEXT_MARKER = '【主人画像'

  /** Memory that returns a recognizable marker in buildContext. */
  const richMemory: Memory = {
    loadPortfolioState: () => null,
    riskProfile: () => '',
    buildContext: () => `${CONTEXT_MARKER}】\n• NVDA 44%`,
  }

  test('haiku (闲聊) — prompt does NOT contain buildContext marker', async () => {
    const prompts: string[] = []
    const agent: AgentRunner = { async run(o) { prompts.push(o.prompt); return { text: 'ok' } } }
    const { registry } = makeRegistry()
    const d = new Dispatcher([], registry, agent, nullDb, richMemory, passSafety, mockQuoteFetcher)
    await d.dispatch(makeInbound({ content: '你好', chatId: 'ctx-haiku', userId: '1086665220723855560' }))
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).not.toContain(CONTEXT_MARKER)
  })

  test('sonnet (分析) — first turn prompt DOES contain buildContext marker', async () => {
    const prompts: string[] = []
    const agent: AgentRunner = { async run(o) { prompts.push(o.prompt); return { sessionId: 's1', text: 'ok' } } }
    const { registry } = makeRegistry()
    const d = new Dispatcher([], registry, agent, nullDb, richMemory, passSafety, mockQuoteFetcher)
    await d.dispatch(makeInbound({ content: '今天有什么市场新闻', chatId: 'ctx-sonnet', userId: '1086665220723855560' }))
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain(CONTEXT_MARKER)
  })

  test('opus (深度) — first turn prompt DOES contain buildContext marker', async () => {
    const prompts: string[] = []
    const agent: AgentRunner = { async run(o) { prompts.push(o.prompt); return { sessionId: 's1', text: 'ok' } } }
    const { registry } = makeRegistry()
    const d = new Dispatcher([], registry, agent, nullDb, richMemory, passSafety, mockQuoteFetcher)
    await d.dispatch(makeInbound({ content: 'NVDA 深度分析', chatId: 'ctx-opus', userId: '1086665220723855560' }))
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain(CONTEXT_MARKER)
  })

  test('haiku — resume is preserved (闲聊连续性)', async () => {
    const runCalls: Array<{ resume?: string }> = []
    const agent: AgentRunner = {
      async run(o) {
        runCalls.push({ resume: o.resume })
        return { sessionId: 'h-ses', text: 'ok' }
      },
    }
    const { registry } = makeRegistry()
    const { db } = makeTrackingDb()
    const d = new Dispatcher([], registry, agent, db, richMemory, passSafety, mockQuoteFetcher)
    // First turn
    await d.dispatch(makeInbound({ content: '你好', chatId: 'haiku-resume' }))
    // Second turn
    await d.dispatch(makeInbound({ content: '再问一个', chatId: 'haiku-resume' }))
    expect(runCalls).toHaveLength(2)
    expect(runCalls[0]!.resume).toBeUndefined()
    expect(runCalls[1]!.resume).toBe('h-ses') // resume preserved on haiku
  })
})

describe('Phase 0-2: reports / opportunity no putSession', () => {
  test('reports runReport does not call putSession', async () => {
    const { reportModules } = await import('../modules/reports/index.js')
    const mod = reportModules.find(m => m.name === 'report:morning')!
    const putSessionCalls: unknown[] = []
    const db: DB = {
      ...nullDb,
      putSession: (...args) => { putSessionCalls.push(args) },
    }
    const agent: AgentRunner = {
      async run() { return { sessionId: 'rep-ses', text: 'report text' } },
    }
    const channels: ChannelRegistry = {
      async send() { return 'msg-id' },
      async edit() {},
      async sendTyping() {},
    }
    const ctx = {
      trigger: { kind: 'cron' as const, job: 'report:morning' },
      channels,
      agent,
      db,
      memory: passMemory,
      safety: passSafety,
    }
    await mod.handle(ctx)
    expect(putSessionCalls).toHaveLength(0)
  })

  test('reports runReport does not call getSession (no resume)', async () => {
    const { reportModules } = await import('../modules/reports/index.js')
    const mod = reportModules.find(m => m.name === 'report:morning')!
    const getSessionCalls: unknown[] = []
    const db: DB = {
      ...nullDb,
      getSession: (...args) => { getSessionCalls.push(args); return null },
    }
    const agent: AgentRunner = {
      async run(o) {
        // Must not have resume set
        expect(o.resume).toBeUndefined()
        return { sessionId: 'rep-ses', text: 'text' }
      },
    }
    const channels: ChannelRegistry = {
      async send() { return 'msg-id' },
      async edit() {},
      async sendTyping() {},
    }
    const ctx = {
      trigger: { kind: 'cron' as const, job: 'report:morning' },
      channels,
      agent,
      db,
      memory: passMemory,
      safety: passSafety,
    }
    await mod.handle(ctx)
    expect(getSessionCalls).toHaveLength(0)
  })

  test('opportunity scan does not call putSession', async () => {
    const { opportunityModules } = await import('../modules/opportunity/index.js')
    const mod = opportunityModules.find(m => m.name === 'opportunity:scan')!
    const putSessionCalls: unknown[] = []
    const db: DB = {
      ...nullDb,
      putSession: (...args) => { putSessionCalls.push(args) },
    }
    const agent: AgentRunner = {
      async run() { return { sessionId: 'opp-ses', text: 'opportunity text' } },
    }
    const channels: ChannelRegistry = {
      async send() { return 'msg-id' },
      async edit() {},
      async sendTyping() {},
    }
    const ctx = {
      trigger: { kind: 'cron' as const, job: 'opportunity:scan' },
      channels,
      agent,
      db,
      memory: passMemory,
      safety: passSafety,
    }
    await mod.handle(ctx)
    expect(putSessionCalls).toHaveLength(0)
  })
})

describe('formatAgentError', () => {
  test('session limit → clear quota message with reset time + L0 hint', () => {
    const msg = formatAgentError("Claude Code returned an error result: You've hit your session limit · resets 2am (Asia/Shanghai)")
    expect(msg).toContain('额度已用满')
    expect(msg).toContain('2am')
    expect(msg).toContain('行情查询仍可用')
  })

  test('generic error → generic message', () => {
    expect(formatAgentError('Error: boom')).toContain('处理出错')
  })

  test('network error → retry hint + quote-still-works note', () => {
    const msg = formatAgentError('Error: fetch failed (ETIMEDOUT)')
    expect(msg).toContain('⚠️')
    expect(msg).toContain('网络')
  })
})

describe('extractDecisions', () => {
  test('strips ===DECISION=== block and parses single object', () => {
    const { clean, decisions } = extractDecisions('建议买入 NVDA。\n===DECISION=== {"symbol":"NVDA","direction":"buy","rationale":"催化"}')
    expect(clean).toBe('建议买入 NVDA。')
    expect(decisions).toHaveLength(1)
    expect(decisions[0]!.symbol).toBe('NVDA')
    expect(decisions[0]!.direction).toBe('buy')
  })
  test('parses array of decisions', () => {
    const { decisions } = extractDecisions('x\n===DECISION=== [{"symbol":"A"},{"symbol":"B","direction":"sell"}]')
    expect(decisions.map(d => d.symbol)).toEqual(['A', 'B'])
  })
  test('no block → unchanged, no decisions', () => {
    const { clean, decisions } = extractDecisions('普通分析,没有建议')
    expect(clean).toBe('普通分析,没有建议')
    expect(decisions).toHaveLength(0)
  })
  test('malformed JSON → strip, store nothing', () => {
    const { clean, decisions } = extractDecisions('ok\n===DECISION=== {not json}')
    expect(clean).toBe('ok')
    expect(decisions).toHaveLength(0)
  })
})

describe('privacy isolation by sender identity', () => {
  test('non-owner: no portfolio context, no memory, blockAccount=true, privacy warning', async () => {
    const calls: Array<any> = []
    const agent: AgentRunner = { async run(o) { calls.push(o); return { text: 'ok' } } }
    const mem: Memory = { loadPortfolioState: () => null, riskProfile: () => '', buildContext: () => '【持仓摘要】NVDA 44%' }
    const { registry } = makeRegistry()
    const d = new Dispatcher([], registry, agent, nullDb, mem, passSafety)
    // 非本人 userId
    await d.dispatch(makeInbound({ userId: 'stranger-999', content: 'NVDA 怎么样', chatId: 'pc-1' }))
    expect(calls).toHaveLength(1)
    expect(calls[0].blockAccount).toBe(true)
    expect(calls[0].prompt).toContain('不是主人本人')
    expect(calls[0].prompt).not.toContain('持仓摘要')   // 持仓画像未注入
  })
  test('owner: gets portfolio context + blockAccount=false', async () => {
    const calls: Array<any> = []
    const agent: AgentRunner = { async run(o) { calls.push(o); return { text: 'ok' } } }
    const mem: Memory = { loadPortfolioState: () => null, riskProfile: () => '', buildContext: () => '【持仓摘要】NVDA 44%' }
    const { registry } = makeRegistry()
    const d = new Dispatcher([], registry, agent, nullDb, mem, passSafety)
    await d.dispatch(makeInbound({ userId: '1086665220723855560', content: 'NVDA 怎么样', chatId: 'pc-2' }))
    expect(calls[0].blockAccount).toBe(false)
    expect(calls[0].prompt).toContain('持仓摘要')
    expect(calls[0].prompt).not.toContain('不是主人本人')
  })
})

// ── Local command fast-paths (help / 新话题 / 台账) ─────────────────────────────

const OWNER_ID = '1086665220723855560'

describe('helpCard / formatLedger (pure)', () => {
  test('helpCard mentions key capabilities + 红线', () => {
    const c = helpCard()
    expect(c).toContain('Cici')
    expect(c).toContain('新话题')
    expect(c).toContain('我的建议')
    expect(c).toContain('绝不替你下单')
  })

  test('formatLedger empty → friendly empty state', () => {
    expect(formatLedger([])).toContain('台账还是空的')
  })

  test('formatLedger renders rows with symbol + direction label + date', () => {
    const ts = Date.parse('2026-05-01T12:00:00Z')
    const out = formatLedger([{ ts, symbol: 'NVDA', direction: 'buy', rationale: 'AI 需求强' }])
    expect(out).toContain('NVDA')
    expect(out).toContain('买入')
    expect(out).toContain('2026-05-01')
    expect(out).toContain('AI 需求强')
  })
})

describe('command fast-paths', () => {
  function agentSpy(): { agent: AgentRunner; calls: string[] } {
    const calls: string[] = []
    return { calls, agent: { async run({ prompt }) { calls.push(prompt); return { text: 'x' } } } }
  }

  test('帮助 → sends help card, no agent', async () => {
    const { agent, calls: aCalls } = agentSpy()
    const { registry, calls } = makeRegistry()
    const d = new Dispatcher([], registry, agent, nullDb, passMemory, passSafety)
    await d.dispatch(makeInbound({ content: '帮助', chatId: 'h-1' }))
    expect(aCalls).toHaveLength(0)
    expect(calls[0]!.text).toContain('Cici')
  })

  test('/help with leading slash also works', async () => {
    const { agent, calls: aCalls } = agentSpy()
    const { registry, calls } = makeRegistry()
    const d = new Dispatcher([], registry, agent, nullDb, passMemory, passSafety)
    await d.dispatch(makeInbound({ content: '/help', chatId: 'h-2' }))
    expect(aCalls).toHaveLength(0)
    expect(calls[0]!.text).toContain('Cici')
  })

  test('新话题 → clears session + confirms, no agent', async () => {
    const cleared: Array<{ ch: string; chat: string }> = []
    const db: DB = { ...nullDb, clearSession: (ch, chat) => { cleared.push({ ch, chat }) } }
    const { agent, calls: aCalls } = agentSpy()
    const { registry, calls } = makeRegistry()
    const d = new Dispatcher([], registry, agent, db, passMemory, passSafety)
    await d.dispatch(makeInbound({ content: '新话题', chatId: 'n-1' }))
    expect(aCalls).toHaveLength(0)
    expect(cleared).toEqual([{ ch: 'discord', chat: 'n-1' }])
    expect(calls[0]!.text).toContain('新话题')
  })

  test('我的建议 (owner) → sends ledger from openDecisions', async () => {
    const db: DB = { ...nullDb, openDecisions: () => [{ id: 1, ts: Date.parse('2026-04-02T00:00:00Z'), symbol: 'AVGO', direction: 'sell', rationale: '估值高', confidence: null }] }
    const { agent, calls: aCalls } = agentSpy()
    const { registry, calls } = makeRegistry()
    const d = new Dispatcher([], registry, agent, db, passMemory, passSafety)
    await d.dispatch(makeInbound({ content: '台账', chatId: 'l-1', userId: OWNER_ID }))
    expect(aCalls).toHaveLength(0)
    expect(calls[0]!.text).toContain('AVGO')
    expect(calls[0]!.text).toContain('卖出')
  })

  test('重置高水位 (owner) → clears nav_hwm to 0, confirms', async () => {
    const kv: Record<string, string> = { nav_hwm: '25000' }
    const db: DB = { ...nullDb, getKv: k => kv[k] ?? null, setKv: (k, v) => { kv[k] = v } }
    const { agent, calls: aCalls } = agentSpy()
    const { registry, calls } = makeRegistry()
    const d = new Dispatcher([], registry, agent, db, passMemory, passSafety)
    await d.dispatch(makeInbound({ content: '重置高水位', chatId: 'hwm-1', userId: OWNER_ID }))
    expect(aCalls).toHaveLength(0)
    expect(kv['nav_hwm']).toBe('0')
    expect(calls[0]!.text).toContain('回撤基准已重置')
  })

  test('重置高水位 (non-owner) → locked, hwm untouched', async () => {
    const kv: Record<string, string> = { nav_hwm: '25000' }
    const db: DB = { ...nullDb, getKv: k => kv[k] ?? null, setKv: (k, v) => { kv[k] = v } }
    const { agent, calls: aCalls } = agentSpy()
    const { registry, calls } = makeRegistry()
    const d = new Dispatcher([], registry, agent, db, passMemory, passSafety)
    await d.dispatch(makeInbound({ content: '重置高水位', chatId: 'hwm-2', userId: 'stranger' }))
    expect(aCalls).toHaveLength(0)
    expect(kv['nav_hwm']).toBe('25000')
    expect(calls[0]!.text).toContain('🔒')
  })

  test('我的建议 (non-owner) → locked, no ledger', async () => {
    const db: DB = { ...nullDb, openDecisions: () => [{ id: 1, ts: Date.now(), symbol: 'AVGO', direction: 'sell', rationale: 'secret', confidence: null }] }
    const { agent, calls: aCalls } = agentSpy()
    const { registry, calls } = makeRegistry()
    const d = new Dispatcher([], registry, agent, db, passMemory, passSafety)
    await d.dispatch(makeInbound({ content: '我的建议', chatId: 'l-2', userId: 'stranger' }))
    expect(aCalls).toHaveLength(0)
    expect(calls[0]!.text).toContain('🔒')
    expect(calls[0]!.text).not.toContain('AVGO')
  })

  test('bare ticker → quote path (not a command, not the agent)', async () => {
    const { agent, calls: aCalls } = agentSpy()
    const { registry, calls } = makeRegistry()
    const d = new Dispatcher([], registry, agent, nullDb, passMemory, passSafety, mockQuoteFetcher)
    await d.dispatch(makeInbound({ content: 'NVDA', chatId: 'bt-1' }))
    expect(aCalls).toHaveLength(0)
    expect(calls.find(c => c.text.includes('MOCK_QUOTE'))).toBeDefined()
  })
})

// ── Phase 3: budget degrade gate ─────────────────────────────────────────────

/** Helper: build a DB stub with a getTodayCost override. */
function makeDbWithCost(todayCost: number): DB & { getTodayCost: () => number } {
  return {
    ...nullDb,
    getTodayCost: () => todayCost,
  }
}

describe('Phase 3: budget degrade gate — level 2 blocks opus/sonnet', () => {
  // DAILY_COST_BUDGET_USD=5; level 2 kicks in at cost >= 5
  const budgetExceededCost = 5.5

  test('level 2: opus request is blocked — no agent.run, sends budget message', async () => {
    const agentCalls: string[] = []
    const agent: AgentRunner = {
      async run({ prompt }) { agentCalls.push(prompt); return { text: 'deep analysis' } },
    }
    const { registry, calls } = makeRegistry()
    const db = makeDbWithCost(budgetExceededCost)
    const d = new Dispatcher([], registry, agent, db, passMemory, passSafety, mockQuoteFetcher)

    await d.dispatch(makeInbound({ content: 'NVDA 深度分析', chatId: 'bud-opus-l2' }))

    // Agent must NOT have been called
    expect(agentCalls).toHaveLength(0)
    // A budget message was sent
    const budgetMsg = calls.find(c => c.text.includes('额度已达上限'))
    expect(budgetMsg).toBeDefined()
    expect(budgetMsg?.text).toContain('行情查询')
  })

  test('level 2: sonnet request is blocked — no agent.run, sends budget message', async () => {
    const agentCalls: string[] = []
    const agent: AgentRunner = {
      async run({ prompt }) { agentCalls.push(prompt); return { text: 'reply' } },
    }
    const { registry, calls } = makeRegistry()
    const db = makeDbWithCost(budgetExceededCost)
    const d = new Dispatcher([], registry, agent, db, passMemory, passSafety, mockQuoteFetcher)

    // 今天有什么市场新闻 → sonnet tier
    await d.dispatch(makeInbound({ content: '今天有什么市场新闻', chatId: 'bud-sonnet-l2' }))

    expect(agentCalls).toHaveLength(0)
    const budgetMsg = calls.find(c => c.text.includes('额度已达上限'))
    expect(budgetMsg).toBeDefined()
  })

  test('level 2: haiku request still runs (not blocked)', async () => {
    const agentCalls: string[] = []
    const agent: AgentRunner = {
      async run({ prompt }) { agentCalls.push(prompt); return { text: 'hi' } },
    }
    const { registry } = makeRegistry()
    const db = makeDbWithCost(budgetExceededCost)
    const d = new Dispatcher([], registry, agent, db, passMemory, passSafety, mockQuoteFetcher)

    // 你好 → haiku tier
    await d.dispatch(makeInbound({ content: '你好', chatId: 'bud-haiku-l2' }))

    // Agent should still run
    expect(agentCalls).toHaveLength(1)
  })

  test('level 2: L0 quote is NEVER affected (handled before gate)', async () => {
    const agentCalls: string[] = []
    const agent: AgentRunner = {
      async run({ prompt }) { agentCalls.push(prompt); return { text: 'agent reply' } },
    }
    const { registry, calls } = makeRegistry()
    const db = makeDbWithCost(budgetExceededCost)
    const d = new Dispatcher([], registry, agent, db, passMemory, passSafety, mockQuoteFetcher)

    // NVDA 现价 → quote tier with symbol → L0 fast path
    await d.dispatch(makeInbound({ content: 'NVDA 现价多少', chatId: 'bud-quote-l2' }))

    // Agent should NOT run (L0 handles it), and quote result should appear
    expect(agentCalls).toHaveLength(0)
    const quoteMsg = calls.find(c => c.text.includes('MOCK_QUOTE'))
    expect(quoteMsg).toBeDefined()
  })

  test('level 2: blocked request is audited (kind=out)', async () => {
    const agent: AgentRunner = {
      async run() { return { text: 'should not run' } },
    }
    const { registry } = makeRegistry()
    const { db: trackingDb, auditRows } = makeTrackingDb()
    const dbWithCost = { ...trackingDb, getTodayCost: () => budgetExceededCost }
    const d = new Dispatcher([], registry, agent, dbWithCost, passMemory, passSafety, mockQuoteFetcher)

    await d.dispatch(makeInbound({ content: 'NVDA 估值分析', chatId: 'bud-audit-l2' }))

    const outRow = auditRows.find(r => r.kind === 'out')
    expect(outRow).toBeDefined()
    expect(outRow?.payload).toContain('budget_blocked')
  })
})

describe('Phase 3: budget degrade gate — level 1 downgrades tier', () => {
  // L1 threshold at cost >= 4.0 (budget=5, ratio=0.8)
  const level1Cost = 4.5

  test('level 1: opus request uses sonnet model (downgraded)', async () => {
    const agentCalls: Array<{ model?: string }> = []
    const agent: AgentRunner = {
      async run({ model }) { agentCalls.push({ model }); return { text: 'reply' } },
    }
    const { registry } = makeRegistry()
    const db = makeDbWithCost(level1Cost)
    const d = new Dispatcher([], registry, agent, db, passMemory, passSafety, mockQuoteFetcher)

    // 深度分析 → opus tier → should be downgraded to sonnet
    await d.dispatch(makeInbound({ content: 'NVDA 深度分析', chatId: 'bud-l1-opus' }))

    expect(agentCalls).toHaveLength(1)
    expect(agentCalls[0]!.model).toBe(SONNET_MODEL)
  })

  test('level 1: downgraded response includes degrade notice', async () => {
    const agent: AgentRunner = {
      async run() { return { text: 'analysis result' } },
    }
    const { registry, editCalls } = makeRegistry({ sendIds: ['ph-l1'] })
    const db = makeDbWithCost(level1Cost)
    const d = new Dispatcher([], registry, agent, db, passMemory, passSafety, mockQuoteFetcher)

    await d.dispatch(makeInbound({ content: 'NVDA 深度分析', chatId: 'bud-l1-notice' }))

    const finalText = editCalls[0]?.text ?? ''
    expect(finalText).toContain('省额度模式')
  })

  test('level 1: haiku tier remains haiku (no further downgrade)', async () => {
    const agentCalls: Array<{ model?: string }> = []
    const agent: AgentRunner = {
      async run({ model }) { agentCalls.push({ model }); return { text: 'hi' } },
    }
    const { registry } = makeRegistry()
    const db = makeDbWithCost(level1Cost)
    const d = new Dispatcher([], registry, agent, db, passMemory, passSafety, mockQuoteFetcher)

    await d.dispatch(makeInbound({ content: '你好', chatId: 'bud-l1-haiku' }))

    expect(agentCalls).toHaveLength(1)
    expect(agentCalls[0]!.model).toBe(HAIKU_MODEL)
  })
})

describe('Phase 3: budget degrade gate — alert events bypass gate', () => {
  // Even at level 2 cost, dispatchEvent must not be gated
  const budgetExceededCost = 5.5

  test('dispatchEvent at level 2 still triggers alert module', async () => {
    const handled: string[] = []
    const alertMod: Module = {
      name: 'alerts',
      events: ['stop_hit', 'concentration_breach', 'thesis_decay'],
      targetChat: REPORT_DM,
      async handle(ctx: ModuleContext) {
        if (ctx.trigger.kind === 'event') handled.push(ctx.trigger.event)
      },
    }
    const { registry } = makeRegistry()
    const db = makeDbWithCost(budgetExceededCost)
    const d = new Dispatcher([alertMod], registry, makeAgent({}), db, passMemory, passSafety, mockQuoteFetcher)

    await d.dispatchEvent({ event: 'stop_hit', key: 'stop_hit:AVGO', summary: 'AVGO 止损' }, REPORT_DM)

    expect(handled).toHaveLength(1)
    expect(handled[0]).toBe('stop_hit')
  })
})

describe('Phase 3: budget degrade gate — getTodayCost absent (stubDb)', () => {
  test('DB without getTodayCost → level=0, normal flow', async () => {
    const agentCalls: Array<{ model?: string }> = []
    const agent: AgentRunner = {
      async run({ model }) { agentCalls.push({ model }); return { text: 'ok' } },
    }
    const { registry } = makeRegistry()
    // nullDb does NOT have getTodayCost → optional chain returns 0 → level 0
    const d = new Dispatcher([], registry, agent, nullDb, passMemory, passSafety, mockQuoteFetcher)

    await d.dispatch(makeInbound({ content: 'NVDA 深度分析', chatId: 'bud-stub-db' }))

    // Should run with opus model (no degradation)
    expect(agentCalls).toHaveLength(1)
    expect(agentCalls[0]!.model).toBe(OPUS_MODEL)
  })
})

// ── 知识层召回:隐私边界 + 弱依赖(Tier 2) ──────────────────────────────────────
describe('knowledge recall — 隐私边界 + 弱依赖', () => {
  const realFetch = globalThis.fetch
  let searchCalls: number
  let ingestCalls: Array<Record<string, unknown>>
  // 受控 fetch:记录 /search 与 /ingest 调用,/search 返回一条高分结果,/ingest 记录 body 后回 ok。
  function installFetch(opts: { searchThrows?: boolean } = {}): void {
    searchCalls = 0
    ingestCalls = []
    // @ts-expect-error — 测试替身
    globalThis.fetch = async (url: string, init?: { body?: string }) => {
      const u = String(url)
      if (u.includes('/search')) {
        searchCalls++
        if (opts.searchThrows) throw new Error('kb down')
        return { ok: true, json: async () => ({ results: [
          { artifact_id: 1, kind: 'thesis', ticker: 'NVDA', title: 'NVDA 旧论点', created_at: 1781835681, source_path: null, score: 0.6, snippet: 'CUDA 护城河' },
        ] }) }
      }
      if (u.includes('/ingest')) {
        ingestCalls.push(init?.body ? JSON.parse(init.body) : {})
      }
      return { ok: true, json: async () => ({ artifact_id: 1, chunks: 1, ok: true }) }
    }
  }
  afterEach(() => { globalThis.fetch = realFetch })

  // 长分析回复(≥400字,含 NVDA)→ 触发自动入库;短回复/无标的不触发。
  const LONG_NVDA = '对 NVDA 的深度分析。' + '数据中心 GPU 需求强劲,CUDA 软件生态构成护城河。'.repeat(20)

  test('主人 + 分析档 → 注入历史研究召回块', async () => {
    installFetch()
    const agentCalls: Array<{ prompt: string }> = []
    const agent = makeAgent({ result: { text: 'x' }, calls: agentCalls })
    const { registry } = makeRegistry()
    const d = new Dispatcher([], registry, agent, nullDb, passMemory, passSafety)
    await d.dispatch(makeInbound({ content: 'NVDA 深度分析', chatId: 'kb-owner', userId: OWNER_ID }))
    expect(searchCalls).toBe(1)
    expect(agentCalls[0]!.prompt).toContain('历史研究召回')
    expect(agentCalls[0]!.prompt).toContain('CUDA 护城河')
  })

  test('非主人 → 不召回(不调 kbSearch,隐私边界)', async () => {
    installFetch()
    const agentCalls: Array<{ prompt: string }> = []
    const agent = makeAgent({ result: { text: 'x' }, calls: agentCalls })
    const { registry } = makeRegistry()
    const d = new Dispatcher([], registry, agent, nullDb, passMemory, passSafety)
    await d.dispatch(makeInbound({ content: 'NVDA 深度分析', chatId: 'kb-other', userId: 'uid-stranger' }))
    expect(searchCalls).toBe(0)
    expect(agentCalls[0]!.prompt).not.toContain('历史研究召回')
  })

  test('haiku 闲聊 → 不召回(省 sidecar 调用)', async () => {
    installFetch()
    const agentCalls: Array<{ prompt: string }> = []
    const agent = makeAgent({ result: { text: 'x' }, calls: agentCalls })
    const { registry } = makeRegistry()
    const d = new Dispatcher([], registry, agent, nullDb, passMemory, passSafety)
    await d.dispatch(makeInbound({ content: '你好啊', chatId: 'kb-haiku', userId: OWNER_ID }))
    expect(searchCalls).toBe(0)
  })

  test('sidecar 挂了 → 消息照常处理(弱依赖不阻断)', async () => {
    installFetch({ searchThrows: true })
    const agentCalls: Array<{ prompt: string }> = []
    const agent = makeAgent({ result: { text: 'x' }, calls: agentCalls })
    const { registry, calls } = makeRegistry()
    const d = new Dispatcher([], registry, agent, nullDb, passMemory, passSafety)
    await d.dispatch(makeInbound({ content: 'NVDA 深度分析', chatId: 'kb-down', userId: OWNER_ID }))
    // kbSearch 抛错被吞 → agent 仍跑、回复仍发出
    expect(agentCalls).toHaveLength(1)
    expect(calls.length).toBeGreaterThan(0)
  })

  // ── 自动入库写路径(隐私敏感:主人内容才进持久库) ──────────────────────────
  test('主人 + 分析档 + 长回复带标的 → 自动入库(kind=analysis,body=clean)', async () => {
    installFetch()
    const agent = makeAgent({ result: { text: LONG_NVDA }, calls: [] })
    const { registry } = makeRegistry()
    const d = new Dispatcher([], registry, agent, nullDb, passMemory, passSafety)
    await d.dispatch(makeInbound({ content: 'NVDA 深度分析', chatId: 'ing-owner', userId: OWNER_ID }))
    await new Promise(r => setTimeout(r, 20)) // 自动入库是 fire-and-forget(void),等微任务 flush
    expect(ingestCalls).toHaveLength(1)
    expect(ingestCalls[0]!.kind).toBe('analysis')
    expect(String(ingestCalls[0]!.ticker)).toContain('NVDA') // 归一形式 US.NVDA
    expect(String(ingestCalls[0]!.body)).toContain('护城河')
  })

  test('非主人 + 长回复 → 不入库(他人内容绝不进持久库)', async () => {
    installFetch()
    const agent = makeAgent({ result: { text: LONG_NVDA }, calls: [] })
    const { registry } = makeRegistry()
    const d = new Dispatcher([], registry, agent, nullDb, passMemory, passSafety)
    await d.dispatch(makeInbound({ content: 'NVDA 深度分析', chatId: 'ing-other', userId: 'uid-stranger' }))
    expect(ingestCalls).toHaveLength(0)
  })

  test('主人但短回复 → 不入库(滤掉查行情/闲聊)', async () => {
    installFetch()
    const agent = makeAgent({ result: { text: 'NVDA 现价 $210' }, calls: [] })
    const { registry } = makeRegistry()
    const d = new Dispatcher([], registry, agent, nullDb, passMemory, passSafety)
    await d.dispatch(makeInbound({ content: 'NVDA 多少钱', chatId: 'ing-short', userId: OWNER_ID }))
    expect(ingestCalls).toHaveLength(0)
  })
})
