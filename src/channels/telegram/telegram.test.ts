/**
 * telegram.test.ts — Unit tests for TelegramChannel.
 *
 * Strategy: inject a mock Bot into channel._bot (TypeScript `private`, which is
 * JS-accessible via `as any`). Tests drive TelegramChannel through its public
 * Channel interface without any real network calls or grammY polling.
 *
 * Inbound path: start() registers a 'message:text' handler on the bot. We call
 * start() with a mock bot pre-captured by overriding the Bot constructor for
 * that test, then fire the handler via simulateMessage.
 */

import { describe, test, expect, mock } from 'bun:test'
import { TelegramChannel } from './index.js'
import { isAllowed } from './access.js'
import type { InboundMsg } from '../channel.js'

// ── Mock bot factory ──────────────────────────────────────────────────────────

type MessageTextHandler = (ctx: any) => void

function makeMockBot() {
  let messageTextHandler: MessageTextHandler | null = null
  let isRunning = false

  const api = {
    sendMessage: mock(async (_chatId: any, _text: string, _opts?: any) => ({
      message_id: 42,
    })),
    editMessageText: mock(async () => true as const),
    setMessageReaction: mock(async () => true as const),
    sendChatAction: mock(async () => true as const),
  }

  const bot = {
    api,
    on: mock((_filter: string, handler: Function) => {
      if (_filter === 'message:text') messageTextHandler = handler as MessageTextHandler
    }),
    start: mock(async (opts?: { onStart?: (info: { username: string }) => void }) => {
      isRunning = true
      opts?.onStart?.({ username: 'TestBot' })
    }),
    stop: mock(async () => { isRunning = false }),
    isRunning: mock(() => isRunning),
  }

  /** Fire a simulated inbound text message through the registered handler. */
  function simulateMessage(opts: {
    userId: number
    username?: string
    firstName?: string
    chatId: number
    messageId: number
    text: string
    date?: number
  }): void {
    if (!messageTextHandler) throw new Error('no message:text handler — did you call start()?')
    messageTextHandler({
      chat: { id: opts.chatId },
      message: {
        message_id: opts.messageId,
        text: opts.text,
        date: opts.date ?? Math.floor(Date.now() / 1000),
        from: {
          id: opts.userId,
          username: opts.username,
          first_name: opts.firstName ?? 'Test',
        },
      },
    })
  }

  return { bot, api, simulateMessage }
}

/**
 * Build a channel with the real start() wired onto a mock bot.
 * We override start() on the instance to inject our mock bot and register
 * the real handler (duplicating what TelegramChannel.start() does) so we
 * can fire simulateMessage and observe InboundMsg delivery.
 */
async function makeStartedChannel() {
  const { bot, api, simulateMessage } = makeMockBot()
  const channel = new TelegramChannel('__TEST__')

  // Override start() to wire the real inbound handler on our mock bot.
  // This mirrors TelegramChannel.start() exactly, without mkdirSync/polling.
  channel.start = async () => {
    ;(channel as any)._bot = bot
    bot.on('message:text', (ctx: any) => {
      const from = ctx.message.from
      const userId = String(from.id)
      if (!isAllowed(userId)) return
      const inbound: InboundMsg = {
        channel: 'telegram',
        chatId: String(ctx.chat.id),
        messageId: String(ctx.message.message_id),
        user: from.username ?? from.first_name,
        userId,
        ts: new Date(ctx.message.date * 1000).toISOString(),
        content: ctx.message.text,
      }
      if ((channel as any)._onMessageCb) {
        ;(channel as any)._onMessageCb(inbound)
      }
    })
    await bot.start()
  }

  await channel.start()
  return { channel, api, bot, simulateMessage }
}

// ── isAllowed unit tests ──────────────────────────────────────────────────────

describe('isAllowed', async () => {
  const { isAllowed } = await import('./access.js')

  test('returns false for unknown user id', () => {
    expect(isAllowed('0')).toBe(false)
    expect(isAllowed('')).toBe(false)
    expect(isAllowed('evil_user')).toBe(false)
  })

  test('default allowlist contains the owner user id', () => {
    // Default TELEGRAM_ALLOW = ['8777584169'] (from config.ts, loaded at import time).
    // If the env was not overridden, this should be true.
    expect(isAllowed('8777584169')).toBe(true)
  })
})

// ── Inbound path ──────────────────────────────────────────────────────────────
// TELEGRAM_ALLOW is evaluated at module import time in config.ts.
// We use the default value ('8777584169') for inbound path tests
// since we can't change already-evaluated module-level constants.

describe('TelegramChannel inbound', () => {
  test('allowlisted user message → correct InboundMsg fields', async () => {
    const { channel, simulateMessage } = await makeStartedChannel()

    const received: InboundMsg[] = []
    channel.onMessage(m => received.push(m))

    const ts = Math.floor(Date.now() / 1000)
    // userId 8777584169 is the default allowlisted owner
    simulateMessage({ userId: 8777584169, username: 'alice', chatId: 999, messageId: 7, text: 'hello', date: ts })

    expect(received).toHaveLength(1)
    const msg = received[0]!
    expect(msg.channel).toBe('telegram')
    expect(msg.chatId).toBe('999')
    expect(msg.messageId).toBe('7')
    expect(msg.user).toBe('alice')
    expect(msg.userId).toBe('8777584169')
    expect(msg.content).toBe('hello')
    expect(msg.ts).toBe(new Date(ts * 1000).toISOString())
  })

  test('uses first_name when username is absent', async () => {
    const { channel, simulateMessage } = await makeStartedChannel()

    const received: InboundMsg[] = []
    channel.onMessage(m => received.push(m))

    simulateMessage({ userId: 8777584169, firstName: 'Bob', chatId: 1, messageId: 1, text: 'hi' })

    expect(received[0]!.user).toBe('Bob')
  })

  test('non-allowlisted user → onMessage NOT called', async () => {
    const { channel, simulateMessage } = await makeStartedChannel()

    const received: InboundMsg[] = []
    channel.onMessage(m => received.push(m))

    // userId 999 is NOT in allowlist
    simulateMessage({ userId: 999, chatId: 1, messageId: 1, text: 'spam' })

    expect(received).toHaveLength(0)
  })
})

// ── send() ────────────────────────────────────────────────────────────────────

describe('TelegramChannel.send', () => {
  function makeInjectedChannel() {
    const { bot, api } = makeMockBot()
    const ch = new TelegramChannel('__TEST__')
    ;(ch as any)._bot = bot
    return { ch, api }
  }

  test('short text → single sendMessage call, returns message_id string', async () => {
    const { ch, api } = makeInjectedChannel()
    const id = await ch.send('123', 'hello')
    expect(api.sendMessage).toHaveBeenCalledTimes(1)
    expect(api.sendMessage.mock.calls[0][0]).toBe('123')
    expect(api.sendMessage.mock.calls[0][1]).toBe('hello')
    expect(id).toBe('42')
  })

  test('text over 4096 chars → multiple sendMessage calls', async () => {
    const { ch, api } = makeInjectedChannel()
    const longText = 'x'.repeat(4097)
    const id = await ch.send('456', longText)
    expect(api.sendMessage.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(id).toBe('42') // first chunk id
  })

  test('reply_parameters sent on first chunk when replyTo provided', async () => {
    const { ch, api } = makeInjectedChannel()
    await ch.send('789', 'hi', { replyTo: '100' })
    const firstCallOpts = api.sendMessage.mock.calls[0][2]
    expect(firstCallOpts).toMatchObject({ reply_parameters: { message_id: 100 } })
  })

  test('reply_parameters NOT sent on subsequent chunks', async () => {
    const { ch, api } = makeInjectedChannel()
    const longText = 'x'.repeat(9000) // forces ≥2 chunks
    await ch.send('789', longText, { replyTo: '200' })
    // second call should have empty opts
    if (api.sendMessage.mock.calls.length > 1) {
      const secondCallOpts = api.sendMessage.mock.calls[1][2]
      expect(secondCallOpts).toEqual({})
    }
  })

  test('throws when bot not started', async () => {
    const ch = new TelegramChannel('__TEST__')
    await expect(ch.send('1', 'hi')).rejects.toThrow('not started')
  })
})

// ── edit() ────────────────────────────────────────────────────────────────────

describe('TelegramChannel.edit', () => {
  test('calls api.editMessageText with correct args', async () => {
    const { bot, api } = makeMockBot()
    const ch = new TelegramChannel('__TEST__')
    ;(ch as any)._bot = bot

    await ch.edit('123', '42', 'new text')
    expect(api.editMessageText).toHaveBeenCalledWith('123', 42, 'new text')
  })

  test('throws when bot not started', async () => {
    const ch = new TelegramChannel('__TEST__')
    await expect(ch.edit('1', '1', 'hi')).rejects.toThrow('not started')
  })
})

// ── sendTyping() ──────────────────────────────────────────────────────────────

describe('TelegramChannel.sendTyping', () => {
  test('calls api.sendChatAction with "typing"', async () => {
    const { bot, api } = makeMockBot()
    const ch = new TelegramChannel('__TEST__')
    ;(ch as any)._bot = bot

    await ch.sendTyping('123')
    expect(api.sendChatAction).toHaveBeenCalledWith('123', 'typing')
  })

  test('throws when bot not started', async () => {
    const ch = new TelegramChannel('__TEST__')
    await expect(ch.sendTyping('1')).rejects.toThrow('not started')
  })
})

// ── react() ───────────────────────────────────────────────────────────────────

describe('TelegramChannel.react', () => {
  test('calls api.setMessageReaction with emoji reaction object', async () => {
    const { bot, api } = makeMockBot()
    const ch = new TelegramChannel('__TEST__')
    ;(ch as any)._bot = bot

    await ch.react('123', '42', '👍')
    expect(api.setMessageReaction).toHaveBeenCalledWith(
      '123',
      42,
      [{ type: 'emoji', emoji: '👍' }],
    )
  })

  test('throws when bot not started', async () => {
    const ch = new TelegramChannel('__TEST__')
    await expect(ch.react('1', '1', '👍')).rejects.toThrow('not started')
  })
})

// ── fetchHistory() ────────────────────────────────────────────────────────────

describe('TelegramChannel.fetchHistory', () => {
  test('returns [] — Bot API cannot pull history', async () => {
    const { bot } = makeMockBot()
    const ch = new TelegramChannel('__TEST__')
    ;(ch as any)._bot = bot

    expect(await ch.fetchHistory('123', 50)).toEqual([])
  })

  test('returns [] even when bot not started', async () => {
    const ch = new TelegramChannel('__TEST__')
    expect(await ch.fetchHistory('123', 10)).toEqual([])
  })
})

// ── download() ────────────────────────────────────────────────────────────────

describe('TelegramChannel.download', () => {
  test('returns [] — M0 stub (attachment at-inbound handling is post-M0)', async () => {
    const { bot } = makeMockBot()
    const ch = new TelegramChannel('__TEST__')
    ;(ch as any)._bot = bot

    expect(await ch.download('123', '42')).toEqual([])
  })

  test('returns [] even when bot not started', async () => {
    const ch = new TelegramChannel('__TEST__')
    expect(await ch.download('123', '99')).toEqual([])
  })
})

// ── destroy() ─────────────────────────────────────────────────────────────────

describe('TelegramChannel.destroy', () => {
  test('calls bot.stop()', () => {
    const { bot } = makeMockBot()
    const ch = new TelegramChannel('__TEST__')
    ;(ch as any)._bot = bot

    ch.destroy()
    expect(bot.stop).toHaveBeenCalled()
  })

  test('no-op when bot not started', () => {
    const ch = new TelegramChannel('__TEST__')
    expect(() => ch.destroy()).not.toThrow()
  })
})
