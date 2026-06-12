import { describe, test, expect } from 'bun:test'
import { PermissionBroker, PERMISSION_REPLY_RE } from './permission.js'

describe('PERMISSION_REPLY_RE', () => {
  test('matches y/yes/n/no + 4-char code, case-insensitive', () => {
    expect(PERMISSION_REPLY_RE.test('y ab12')).toBe(true)
    expect(PERMISSION_REPLY_RE.test('YES ab12')).toBe(true)
    expect(PERMISSION_REPLY_RE.test('n cd34')).toBe(true)
    expect(PERMISSION_REPLY_RE.test('NO cd34')).toBe(true)
  })
  test('rejects non-replies', () => {
    expect(PERMISSION_REPLY_RE.test('yes please buy')).toBe(false)
    expect(PERMISSION_REPLY_RE.test('NVDA 行情')).toBe(false)
    expect(PERMISSION_REPLY_RE.test('y toolong')).toBe(false)
  })
})

describe('PermissionBroker', () => {
  function makeBroker(timeoutMs = 5000) {
    const sent: string[] = []
    const broker = new PermissionBroker(async (_ch, _chat, text) => { sent.push(text); return 'mid' }, timeoutMs)
    return { broker, sent }
  }

  test('posts a prompt and resolves true on y <code>', async () => {
    const { broker, sent } = makeBroker()
    const p = broker.request('discord', 'chat-1', 'binance_publish', 'post X')
    // Let the request() send + register pending.
    await new Promise(r => setTimeout(r, 5))
    expect(sent).toHaveLength(1)
    // Extract the code from the prompt (… `y <code>` …).
    const code = sent[0]!.match(/y ([a-z0-9]{4})/)![1]!
    expect(broker.pendingCount).toBe(1)
    expect(broker.tryResolve(`y ${code}`)).toBe(true)
    expect(await p).toBe(true)
    expect(broker.pendingCount).toBe(0)
  })

  test('resolves false on n <code>', async () => {
    const { broker, sent } = makeBroker()
    const p = broker.request('discord', 'chat-1', 'send_email', 'to boss')
    await new Promise(r => setTimeout(r, 5))
    const code = sent[0]!.match(/y ([a-z0-9]{4})/)![1]!
    expect(broker.tryResolve(`n ${code}`)).toBe(true)
    expect(await p).toBe(false)
  })

  test('tryResolve returns false for unknown code / non-reply', async () => {
    const { broker } = makeBroker()
    expect(broker.tryResolve('y zzzz')).toBe(false)
    expect(broker.tryResolve('hello world')).toBe(false)
  })

  test('times out → resolves false', async () => {
    const { broker } = makeBroker(40)
    const p = broker.request('discord', 'chat-1', 'square_post', 'x')
    expect(await p).toBe(false)
    expect(broker.pendingCount).toBe(0)
  })
})
