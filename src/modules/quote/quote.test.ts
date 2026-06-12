/**
 * quote.test.ts — Unit tests for fetchQuotes (M7 L0 fast path).
 *
 * Uses injectable spawnFn and tcpCheck to avoid real network/process calls.
 */

import { describe, test, expect } from 'bun:test'
import { fetchQuotes } from './index.js'
import type { SpawnFn, TcpCheckFn } from './index.js'
import { EventEmitter } from 'events'
import type { ChildProcess } from 'child_process'

// ── Mock builders ─────────────────────────────────────────────────────────────

/**
 * Create a fake SpawnFn that returns a mocked ChildProcess.
 * Uses EventEmitter to simulate stdout/stderr/close events.
 */
function makeSpawn(opts: {
  stdout?: string
  exitCode?: number
  delay?: number
}): SpawnFn {
  const { stdout = '', exitCode = 0, delay = 0 } = opts

  return (_cmd: string, _args: string[], _options: { stdio: string[] }): ChildProcess => {
    const base = new EventEmitter()
    const stdoutEE = new EventEmitter()
    const stderrEE = new EventEmitter()

    const proc = Object.assign(base, {
      stdout: stdoutEE,
      stderr: stderrEE,
      stdin: null,
      kill: () => true,
    }) as unknown as ChildProcess

    // Emit output asynchronously
    setTimeout(() => {
      if (stdout) stdoutEE.emit('data', Buffer.from(stdout))
      base.emit('close', exitCode)
    }, delay)

    return proc
  }
}

const tcpOk: TcpCheckFn = async () => true
const tcpDown: TcpCheckFn = async () => false

// ── Futu path (OpenD up) ──────────────────────────────────────────────────────

describe('fetchQuotes — futu path (OpenD up)', () => {
  test('single symbol: parses JSON and returns formatted line', async () => {
    const futuJson = JSON.stringify({
      data: [{
        code: 'US.NVDA',
        name: '英伟达',
        last_price: 130.50,
        prev_close: 128.00,
        volume: 45000000,
        turnover: 5870000000,
        bid: 130.45,
        ask: 130.55,
      }],
    })

    const result = await fetchQuotes(['US.NVDA'], makeSpawn({ stdout: futuJson }), tcpOk)

    expect(result).toContain('英伟达')
    expect(result).toContain('US.NVDA')
    expect(result).toContain('130.50')
    expect(result).toContain('%')
  })

  test('multiple symbols: returns one line per symbol', async () => {
    const futuJson = JSON.stringify({
      data: [
        { code: 'US.AAPL', name: '苹果', last_price: 200.00, prev_close: 198.00, volume: 10000000 },
        { code: 'HK.00700', name: '腾讯', last_price: 380.00, prev_close: 375.00, volume: 5000000 },
      ],
    })

    const result = await fetchQuotes(['US.AAPL', 'HK.00700'], makeSpawn({ stdout: futuJson }), tcpOk)

    expect(result).toContain('苹果')
    expect(result).toContain('腾讯')
    // Two lines
    expect(result.split('\n')).toHaveLength(2)
  })

  test('zero change (prev_close same as last) → +0.00%', async () => {
    const futuJson = JSON.stringify({
      data: [{ code: 'US.TSLA', name: '特斯拉', last_price: 250.00, prev_close: 250.00, volume: 1000 }],
    })
    const result = await fetchQuotes(['US.TSLA'], makeSpawn({ stdout: futuJson }), tcpOk)
    expect(result).toContain('+0.00%')
  })

  test('script exit code ≠ 0 → falls through to fallback', async () => {
    const fallbackJson = JSON.stringify({ price: 99.99, name: 'Test Co' })
    // First call (futu) returns exit 1, second call (fallback) returns ok
    let callCount = 0
    const multiSpawn: SpawnFn = (cmd, args, options) => {
      callCount++
      if (callCount === 1) {
        return makeSpawn({ stdout: '', exitCode: 1 })(cmd, args, options)
      }
      return makeSpawn({ stdout: fallbackJson })(cmd, args, options)
    }

    const result = await fetchQuotes(['US.NVDA'], multiSpawn, tcpOk)
    // Should have used fallback
    expect(callCount).toBe(2)
    expect(result).toContain('99.99')
  })

  test('empty data array → not-found message', async () => {
    const futuJson = JSON.stringify({ data: [] })
    const result = await fetchQuotes(['US.XXX'], makeSpawn({ stdout: futuJson }), tcpOk)
    expect(result).toContain('⚠️')
  })

  test('invalid JSON → error message', async () => {
    const result = await fetchQuotes(['US.NVDA'], makeSpawn({ stdout: 'not json' }), tcpOk)
    expect(result).toContain('⚠️')
  })
})

// ── Fallback path (OpenD down) ────────────────────────────────────────────────

describe('fetchQuotes — fallback path (OpenD down)', () => {
  test('OpenD down: uses fallback script', async () => {
    const fallbackJson = JSON.stringify({ price: 55.50, name: 'Fallback Co' })
    const result = await fetchQuotes(['US.TEST'], makeSpawn({ stdout: fallbackJson }), tcpDown)

    expect(result).toContain('55.5')
  })

  test('OpenD down + fallback also fails → error text', async () => {
    const result = await fetchQuotes(['US.FAIL'], makeSpawn({ stdout: '', exitCode: 1 }), tcpDown)
    expect(result).toContain('⚠️')
  })

  test('OpenD down + fallback non-JSON first line output → uses raw line', async () => {
    const result = await fetchQuotes(['US.RAW'], makeSpawn({ stdout: 'NVDA: $130.50\n', exitCode: 0 }), tcpDown)
    // raw first line used
    expect(result).toContain('130.50')
  })
})

// ── Edge cases ────────────────────────────────────────────────────────────────

describe('fetchQuotes — edge cases', () => {
  test('empty symbols array → error message', async () => {
    const result = await fetchQuotes([], makeSpawn({}), tcpOk)
    expect(result).toContain('⚠️')
  })

  test('negative change → minus sign in output', async () => {
    const futuJson = JSON.stringify({
      data: [{ code: 'US.NVDA', name: '英伟达', last_price: 120.00, prev_close: 130.00, volume: 1000 }],
    })
    const result = await fetchQuotes(['US.NVDA'], makeSpawn({ stdout: futuJson }), tcpOk)
    expect(result).toContain('-')
  })
})

