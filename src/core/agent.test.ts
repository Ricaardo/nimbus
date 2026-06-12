/**
 * agent.test.ts — Unit tests for AgentRunnerImpl.
 *
 * Uses a hand-rolled async iterable to mock the SDK `query` stream.
 * Does NOT connect to the real SDK or make any network calls.
 *
 * Test sections:
 * 1. Legacy inline-loop tests (stream-processing behaviour)
 * 2. Injection-based tests — mock queryFn injected into AgentRunnerImpl to
 *    assert that the correct options are passed through (B1 / N4).
 */

import { describe, test, expect } from 'bun:test'
import type {
  SDKMessage,
  SDKSystemMessage,
  SDKAssistantMessage,
  SDKPartialAssistantMessage,
  SDKResultSuccess,
} from '@anthropic-ai/claude-agent-sdk'
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { AgentRunnerImpl, assertSubscriptionMode } from './agent.js'
import { canUseTool } from './safety.js'

// ── Helpers to build fake SDK messages (including stream_event) ──────────────

function makeInit(sessionId: string): SDKSystemMessage {
  return {
    type: 'system',
    subtype: 'init',
    session_id: sessionId,
    apiKeySource: 'user',
    claude_code_version: '0.3.168',
    cwd: '/test',
    tools: ['Bash', 'Read'],
    mcp_servers: [],
    model: 'claude-sonnet-4-6',
    permissionMode: 'default',
    slash_commands: [],
    output_style: 'text',
    skills: [],
    plugins: [],
    uuid: '00000000-0000-0000-0000-000000000001' as any,
  }
}

function makeAssistant(sessionId: string, text: string): SDKAssistantMessage {
  const betaMessage = {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text }],
    model: 'claude-sonnet-4-6',
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  } as unknown as BetaMessage
  return {
    type: 'assistant',
    message: betaMessage,
    parent_tool_use_id: null,
    session_id: sessionId,
    uuid: '00000000-0000-0000-0000-000000000002' as any,
  }
}

function makeResult(sessionId: string, resultText: string): SDKResultSuccess {
  return {
    type: 'result',
    subtype: 'success',
    result: resultText,
    is_error: false,
    duration_ms: 100,
    duration_api_ms: 80,
    num_turns: 1,
    stop_reason: 'end_turn',
    total_cost_usd: 0,
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      server_tool_use: { web_search_requests: 0 },
    } as any,
    modelUsage: {},
    permission_denials: [],
    session_id: sessionId,
    uuid: '00000000-0000-0000-0000-000000000003' as any,
  }
}

/** Build an async iterable that yields the provided messages in order. */
async function* makeStream(messages: SDKMessage[]): AsyncGenerator<SDKMessage, void> {
  for (const msg of messages) {
    yield msg
  }
}

/** Build a stream_event (SDKPartialAssistantMessage) for a text delta. */
function makeStreamEvent(sessionId: string, text: string): SDKPartialAssistantMessage {
  return {
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text },
    } as any,
    parent_tool_use_id: null,
    session_id: sessionId,
    uuid: '00000000-0000-0000-0000-000000000010' as any,
  }
}

/** Build a non-text stream_event (e.g. message_start — should be ignored). */
function makeStreamEventNonText(sessionId: string): SDKPartialAssistantMessage {
  return {
    type: 'stream_event',
    event: {
      type: 'message_start',
      message: {} as any,
    } as any,
    parent_tool_use_id: null,
    session_id: sessionId,
    uuid: '00000000-0000-0000-0000-000000000011' as any,
  }
}

// ── AgentRunnerImpl — test with injected query ────────────────────────────────

// We cannot mock the module-level `query` import cleanly in ESM, so we
// extract the core logic of AgentRunnerImpl into a testable form by
// duplicating the loop inline and verifying the behaviour.

async function runLoop(
  stream: AsyncIterable<SDKMessage>,
  onText?: (t: string) => void,
): Promise<{ sessionId?: string; text: string }> {
  let sessionId: string | undefined
  let accumulatedText = ''
  let resultText: string | undefined

  for await (const message of stream) {
    if (message.type === 'system') {
      const sys = message as SDKSystemMessage
      if (sys.subtype === 'init') {
        sessionId = sys.session_id
      }
    } else if (message.type === 'assistant') {
      const asst = message as SDKAssistantMessage
      const content = asst.message.content
      if (Array.isArray(content)) {
        const parts: string[] = []
        for (const block of content) {
          if (block.type === 'text') {
            parts.push((block as { type: 'text'; text: string }).text)
          }
        }
        const chunk = parts.join('')
        if (chunk) {
          accumulatedText += chunk
          onText?.(chunk)
        }
      }
    } else if (message.type === 'result') {
      const result = message as SDKResultSuccess
      if (result.subtype === 'success') {
        resultText = result.result
      }
    }
  }

  return { sessionId, text: resultText ?? accumulatedText }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AgentRunnerImpl stream processing', () => {
  const SESSION = 'test-session-id-1234'

  test('captures sessionId from system/init', async () => {
    const stream = makeStream([
      makeInit(SESSION),
      makeAssistant(SESSION, 'Hello'),
      makeResult(SESSION, 'Hello'),
    ])
    const result = await runLoop(stream)
    expect(result.sessionId).toBe(SESSION)
  })

  test('accumulates text from assistant messages', async () => {
    const stream = makeStream([
      makeInit(SESSION),
      makeAssistant(SESSION, 'Hello '),
      makeAssistant(SESSION, 'world'),
      makeResult(SESSION, 'Hello world'),
    ])
    const chunks: string[] = []
    const result = await runLoop(stream, t => chunks.push(t))
    expect(chunks).toEqual(['Hello ', 'world'])
  })

  test('result text takes priority over accumulated text', async () => {
    const stream = makeStream([
      makeInit(SESSION),
      makeAssistant(SESSION, 'streaming chunk'),
      makeResult(SESSION, 'final answer'),
    ])
    const result = await runLoop(stream)
    expect(result.text).toBe('final answer')
  })

  test('falls back to accumulated text when result has no result field', async () => {
    // An error result has no .result field — only accumulated text is available
    const errorResult: SDKMessage = {
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      duration_ms: 100,
      duration_api_ms: 80,
      num_turns: 1,
      stop_reason: null,
      total_cost_usd: 0,
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: { web_search_requests: 0 } } as any,
      modelUsage: {},
      permission_denials: [],
      errors: ['test error'],
      session_id: SESSION,
      uuid: '00000000-0000-0000-0000-000000000004' as any,
    } as any
    const stream = makeStream([
      makeInit(SESSION),
      makeAssistant(SESSION, 'partial response'),
      errorResult,
    ])
    const result = await runLoop(stream)
    expect(result.text).toBe('partial response')
  })

  test('onText callback called for each assistant chunk', async () => {
    const stream = makeStream([
      makeInit(SESSION),
      makeAssistant(SESSION, 'chunk1'),
      makeAssistant(SESSION, 'chunk2'),
      makeAssistant(SESSION, 'chunk3'),
      makeResult(SESSION, 'chunk1chunk2chunk3'),
    ])
    const calls: string[] = []
    await runLoop(stream, t => calls.push(t))
    expect(calls).toEqual(['chunk1', 'chunk2', 'chunk3'])
  })

  test('sessionId undefined when no init message', async () => {
    const stream = makeStream([
      makeAssistant(SESSION, 'hello'),
      makeResult(SESSION, 'hello'),
    ])
    const result = await runLoop(stream)
    expect(result.sessionId).toBeUndefined()
  })

  test('empty stream returns empty text and undefined sessionId', async () => {
    const stream = makeStream([])
    const result = await runLoop(stream)
    expect(result.text).toBe('')
    expect(result.sessionId).toBeUndefined()
  })
})

// ── AgentRunnerImpl — injection-based option-wiring tests (B1 / N4) ──────────
//
// These tests inject a mock queryFn into AgentRunnerImpl.run() and assert that
// the correct options are forwarded, without any real network calls.

describe('AgentRunnerImpl — options wiring via injected queryFn', () => {
  const SESSION = 'inject-session-5678'

  /** Builds a mock queryFn that returns a fixed stream and captures the call. */
  function makeMockQuery(messages: SDKMessage[]) {
    let capturedArgs: { prompt: string; options?: Record<string, unknown> } | undefined

    const mockQuery = (args: { prompt: string; options?: Record<string, unknown> }) => {
      capturedArgs = args
      return makeStream(messages)
    }

    return {
      mockQuery: mockQuery as any,
      getCaptured: () => capturedArgs,
    }
  }

  test('settingSources = project + local (Phase 3: dropped user for lean/independent loading)', async () => {
    const { mockQuery, getCaptured } = makeMockQuery([
      makeInit(SESSION),
      makeResult(SESSION, 'ok'),
    ])
    const runner = new AgentRunnerImpl(mockQuery)
    await runner.run({ prompt: 'hello' })
    const opts = getCaptured()?.options as Record<string, unknown> | undefined
    expect(Array.isArray(opts?.['settingSources'])).toBe(true)
    const sources = opts?.['settingSources'] as string[]
    expect(sources).toContain('project')
    expect(sources).toContain('local')
    expect(sources).not.toContain('user')
  })

  test('permissionMode is default', async () => {
    const { mockQuery, getCaptured } = makeMockQuery([
      makeInit(SESSION),
      makeResult(SESSION, 'ok'),
    ])
    const runner = new AgentRunnerImpl(mockQuery)
    await runner.run({ prompt: 'hello' })
    const opts = getCaptured()?.options as Record<string, unknown> | undefined
    expect(opts?.['permissionMode']).toBe('default')
  })

  test('canUseTool is the safety module canUseTool', async () => {
    const { mockQuery, getCaptured } = makeMockQuery([
      makeInit(SESSION),
      makeResult(SESSION, 'ok'),
    ])
    const runner = new AgentRunnerImpl(mockQuery)
    await runner.run({ prompt: 'hello' })
    const opts = getCaptured()?.options as Record<string, unknown> | undefined
    expect(opts?.['canUseTool']).toBe(canUseTool)
  })

  test('options contain no API key fields', async () => {
    const { mockQuery, getCaptured } = makeMockQuery([
      makeInit(SESSION),
      makeResult(SESSION, 'ok'),
    ])
    const runner = new AgentRunnerImpl(mockQuery)
    await runner.run({ prompt: 'hello' })
    const opts = getCaptured()?.options as Record<string, unknown> | undefined
    expect(opts).toBeDefined()
    expect(Object.keys(opts!)).not.toContain('apiKey')
    expect(Object.keys(opts!)).not.toContain('ANTHROPIC_API_KEY')
  })

  test('stream consumed correctly — sessionId and text returned', async () => {
    const chunks: string[] = []
    const { mockQuery } = makeMockQuery([
      makeInit(SESSION),
      makeAssistant(SESSION, 'hello '),
      makeAssistant(SESSION, 'world'),
      makeResult(SESSION, 'hello world'),
    ])
    const runner = new AgentRunnerImpl(mockQuery)
    const result = await runner.run({ prompt: 'hi', onText: t => chunks.push(t) })
    expect(result.sessionId).toBe(SESSION)
    expect(result.text).toBe('hello world')
    expect(chunks).toEqual(['hello ', 'world'])
  })
})

// ── assertSubscriptionMode ────────────────────────────────────────────────────

describe('assertSubscriptionMode', () => {
  test('only warns (does not exit) when ANTHROPIC_API_KEY is set', () => {
    const originalKey = process.env['ANTHROPIC_API_KEY']
    const stderrChunks: string[] = []
    const origWrite = process.stderr.write.bind(process.stderr)
    process.stderr.write = (chunk: any, ...rest: any[]) => {
      if (typeof chunk === 'string') stderrChunks.push(chunk)
      return origWrite(chunk, ...rest)
    }

    try {
      process.env['ANTHROPIC_API_KEY'] = 'test-key-abc'
      // Must not throw or call process.exit
      expect(() => assertSubscriptionMode()).not.toThrow()
      expect(stderrChunks.some(s => s.includes('WARNING'))).toBe(true)
    } finally {
      process.stderr.write = origWrite
      if (originalKey === undefined) {
        delete process.env['ANTHROPIC_API_KEY']
      } else {
        process.env['ANTHROPIC_API_KEY'] = originalKey
      }
    }
  })

  test('does not warn when ANTHROPIC_API_KEY is absent', () => {
    const originalKey = process.env['ANTHROPIC_API_KEY']
    const stderrChunks: string[] = []
    const origWrite = process.stderr.write.bind(process.stderr)
    process.stderr.write = (chunk: any, ...rest: any[]) => {
      if (typeof chunk === 'string') stderrChunks.push(chunk)
      return origWrite(chunk, ...rest)
    }

    try {
      delete process.env['ANTHROPIC_API_KEY']
      assertSubscriptionMode()
      expect(stderrChunks.filter(s => s.includes('WARNING'))).toHaveLength(0)
    } finally {
      process.stderr.write = origWrite
      if (originalKey !== undefined) {
        process.env['ANTHROPIC_API_KEY'] = originalKey
      }
    }
  })
})

// ── AgentRunnerImpl — stream_event (partial messages) handling (M6 Batch 2) ──

describe('AgentRunnerImpl — stream_event partial messages (M6 Batch 2)', () => {
  const SESSION = 'partial-session-9999'

  test('stream_event text deltas are forwarded to onText', async () => {
    const deltas: string[] = []
    const { mockQuery } = makeMockQueryWithPartial([
      makeInit(SESSION),
      makeStreamEvent(SESSION, 'Hello '),
      makeStreamEvent(SESSION, 'world'),
      makeAssistant(SESSION, 'Hello world'),
      makeResult(SESSION, 'Hello world'),
    ])
    const runner = new AgentRunnerImpl(mockQuery)
    await runner.run({ prompt: 'hi', onText: d => deltas.push(d) })
    expect(deltas).toContain('Hello ')
    expect(deltas).toContain('world')
  })

  test('non-text stream_event (message_start) is silently ignored', async () => {
    const deltas: string[] = []
    const { mockQuery } = makeMockQueryWithPartial([
      makeInit(SESSION),
      makeStreamEventNonText(SESSION),
      makeStreamEvent(SESSION, 'Hi'),
      makeAssistant(SESSION, 'Hi'),
      makeResult(SESSION, 'Hi'),
    ])
    const runner = new AgentRunnerImpl(mockQuery)
    await runner.run({ prompt: 'hey', onText: d => deltas.push(d) })
    // Only the text delta should arrive, not the non-text event
    expect(deltas).toEqual(['Hi'])
  })

  test('stream_event deltas suppress per-message onText on assistant message', async () => {
    // When stream_events are emitted, the assistant message should NOT re-trigger onText.
    const deltas: string[] = []
    const { mockQuery } = makeMockQueryWithPartial([
      makeInit(SESSION),
      makeStreamEvent(SESSION, 'tok1'),
      makeStreamEvent(SESSION, 'tok2'),
      makeAssistant(SESSION, 'tok1tok2'),  // should NOT call onText again
      makeResult(SESSION, 'tok1tok2'),
    ])
    const runner = new AgentRunnerImpl(mockQuery)
    await runner.run({ prompt: 'test', onText: d => deltas.push(d) })
    // Deltas should be only from stream_event, not duplicated by assistant message
    expect(deltas).toEqual(['tok1', 'tok2'])
  })

  test('no stream_events → onText fires per assistant message (fallback)', async () => {
    // Without any stream_event, original per-message behavior must be preserved.
    const deltas: string[] = []
    const { mockQuery } = makeMockQueryWithPartial([
      makeInit(SESSION),
      makeAssistant(SESSION, 'chunk1'),
      makeAssistant(SESSION, 'chunk2'),
      makeResult(SESSION, 'chunk1chunk2'),
    ])
    const runner = new AgentRunnerImpl(mockQuery)
    await runner.run({ prompt: 'fallback', onText: d => deltas.push(d) })
    expect(deltas).toEqual(['chunk1', 'chunk2'])
  })

  test('final text value comes from result message, not stream_event accumulation', async () => {
    const { mockQuery } = makeMockQueryWithPartial([
      makeInit(SESSION),
      makeStreamEvent(SESSION, 'tok1'),
      makeStreamEvent(SESSION, 'tok2'),
      makeAssistant(SESSION, 'tok1tok2'),
      makeResult(SESSION, 'final-result-text'),
    ])
    const runner = new AgentRunnerImpl(mockQuery)
    const result = await runner.run({ prompt: 'test' })
    expect(result.text).toBe('final-result-text')
  })

  test('includePartialMessages option is set to true', async () => {
    let capturedOptions: Record<string, unknown> | undefined
    const mockQuery = (args: { prompt: string; options?: Record<string, unknown> }) => {
      capturedOptions = args.options
      return makeStream([makeInit(SESSION), makeResult(SESSION, 'ok')])
    }
    const runner = new AgentRunnerImpl(mockQuery as any)
    await runner.run({ prompt: 'test' })
    expect(capturedOptions?.['includePartialMessages']).toBe(true)
  })
})

// ── Helper: mock query that supports stream_event messages ────────────────────

function makeMockQueryWithPartial(messages: SDKMessage[]) {
  const mockQuery = (_args: { prompt: string; options?: Record<string, unknown> }) => {
    return makeStream(messages)
  }
  return { mockQuery: mockQuery as any }
}
