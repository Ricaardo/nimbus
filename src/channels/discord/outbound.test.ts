/**
 * outbound.test.ts — Unit tests for new outbound helpers (Batch D).
 *
 * All tests use a mock discord.js client; no real network calls.
 */

import { describe, test, expect, mock } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  editMessage,
  reactToMessage,
  fetchHistory,
  downloadMessageAttachments,
} from './outbound.js'

// ── Fixture setup ─────────────────────────────────────────────────────────────
// fetchAllowedChannel reads loadAccess() from DISCORD_STATE_DIR.
// Point it at the real fixture which has guild channels allowlisted.

const FIXTURE_DIR = join(import.meta.dir, '../../../test/fixtures')

function withFixture<T>(fn: () => Promise<T>): Promise<T> {
  const orig = process.env.DISCORD_STATE_DIR
  process.env.DISCORD_STATE_DIR = FIXTURE_DIR
  return fn().finally(() => {
    if (orig === undefined) delete process.env.DISCORD_STATE_DIR
    else process.env.DISCORD_STATE_DIR = orig
  })
}

// Read the fixture to know which channel IDs are allowlisted.
const fixtureAccess = JSON.parse(readFileSync(join(FIXTURE_DIR, 'access.json'), 'utf8'))
// Pick the first group channel id from the fixture
const ALLOWED_GUILD_ID = Object.keys(fixtureAccess.groups)[0]!

// ── Mock client builder ───────────────────────────────────────────────────────

/**
 * Build a minimal mock discord.js Client.
 * `fetchedMsg` is returned by ch.messages.fetch(msgId).
 * `fetchedMsgs` is a Map returned by ch.messages.fetch({limit}).
 */
function makeClient(opts: {
  channelId: string
  channelType?: number          // 1=DM, 0=guild text
  fetchedMsg?: Record<string, any>
  fetchedMsgs?: Map<string, any>
  botUserId?: string
}) {
  const {
    channelId,
    channelType = 0,
    fetchedMsg,
    fetchedMsgs,
    botUserId = 'bot-id',
  } = opts

  // Build a mock message store that handles both `fetch(id)` and `fetch({limit})`
  const messages = {
    async fetch(arg: string | { limit: number }) {
      if (typeof arg === 'string') {
        if (!fetchedMsg) throw new Error('no fetchedMsg configured')
        return fetchedMsg
      }
      if (!fetchedMsgs) throw new Error('no fetchedMsgs configured')
      return fetchedMsgs
    },
  }

  const channel = {
    id: channelId,
    type: channelType,
    isTextBased: () => true,
    isThread: () => false,
    messages,
    parentId: null as string | null,
  }

  const client = {
    user: { id: botUserId },
    channels: {
      async fetch(_id: string) {
        return channel
      },
    },
  } as any

  return { client, channel, messages }
}

// ── editMessage ───────────────────────────────────────────────────────────────

describe('editMessage', () => {
  test('calls msg.edit and returns edited id', async () => {
    const editSpy = mock(async (text: string) => ({ id: 'edited-id', content: text }))
    const { client } = makeClient({
      channelId: ALLOWED_GUILD_ID,
      fetchedMsg: { id: 'orig-id', edit: editSpy },
    })

    await withFixture(async () => {
      const result = await editMessage(client, ALLOWED_GUILD_ID, 'orig-id', 'new text')
      expect(editSpy).toHaveBeenCalledWith('new text')
      expect(result).toBe('edited-id')
    })
  })

  test('throws when channel is not allowlisted', async () => {
    const { client } = makeClient({ channelId: 'not-allowed' })
    await withFixture(async () => {
      await expect(
        editMessage(client, 'not-allowed', 'msg-1', 'hello'),
      ).rejects.toThrow('not allowlisted')
    })
  })
})

// ── reactToMessage ────────────────────────────────────────────────────────────

describe('reactToMessage', () => {
  test('calls msg.react with the emoji', async () => {
    const reactSpy = mock(async (_emoji: string) => {})
    const { client } = makeClient({
      channelId: ALLOWED_GUILD_ID,
      fetchedMsg: { id: 'msg-r', react: reactSpy },
    })

    await withFixture(async () => {
      await reactToMessage(client, ALLOWED_GUILD_ID, 'msg-r', '👍')
      expect(reactSpy).toHaveBeenCalledWith('👍')
    })
  })

  test('throws when channel is not allowlisted', async () => {
    const { client } = makeClient({ channelId: 'not-allowed' })
    await withFixture(async () => {
      await expect(
        reactToMessage(client, 'not-allowed', 'msg-1', '👍'),
      ).rejects.toThrow('not allowlisted')
    })
  })
})

// ── fetchHistory ──────────────────────────────────────────────────────────────

describe('fetchHistory', () => {
  test('returns structured array oldest-first', async () => {
    // Discord returns newest-first; fetchHistory reverses.
    const msgs = new Map([
      ['msg-2', {
        id: 'msg-2',
        author: { id: 'user-b', username: 'bob' },
        createdAt: new Date('2026-06-07T00:00:02Z'),
        content: 'world',
        attachments: { size: 0, values: () => [][Symbol.iterator]() },
      }],
      ['msg-1', {
        id: 'msg-1',
        author: { id: 'user-a', username: 'alice' },
        createdAt: new Date('2026-06-07T00:00:01Z'),
        content: 'hello',
        attachments: { size: 1, values: () => [][Symbol.iterator]() },
      }],
    ])
    const { client } = makeClient({ channelId: ALLOWED_GUILD_ID, fetchedMsgs: msgs })

    await withFixture(async () => {
      const history = await fetchHistory(client, ALLOWED_GUILD_ID, 10)
      // reversed: msg-1 first (oldest)
      expect(history[0].id).toBe('msg-1')
      expect(history[0].author).toBe('alice')
      expect(history[0].attachments).toBe(1)
      expect(history[1].id).toBe('msg-2')
      expect(history[1].author).toBe('bob')
      expect(history[1].attachments).toBe(0)
    })
  })

  test('caps limit at 100', async () => {
    let capturedLimit = 0
    const msgs = new Map()
    const { client, channel } = makeClient({ channelId: ALLOWED_GUILD_ID, fetchedMsgs: msgs })
    // Override messages.fetch to capture the limit argument
    ;(channel as any).messages.fetch = async (arg: any) => {
      if (typeof arg === 'object') capturedLimit = arg.limit
      return msgs
    }

    await withFixture(async () => {
      await fetchHistory(client, ALLOWED_GUILD_ID, 999)
      expect(capturedLimit).toBe(100)
    })
  })

  test('replaces bot id with "me"', async () => {
    const msgs = new Map([
      ['msg-bot', {
        id: 'msg-bot',
        author: { id: 'bot-id', username: 'Nimbus' },
        createdAt: new Date('2026-06-07T00:00:00Z'),
        content: 'I am a bot',
        attachments: { size: 0, values: () => [][Symbol.iterator]() },
      }],
    ])
    const { client } = makeClient({ channelId: ALLOWED_GUILD_ID, fetchedMsgs: msgs, botUserId: 'bot-id' })

    await withFixture(async () => {
      const history = await fetchHistory(client, ALLOWED_GUILD_ID, 5)
      expect(history[0].author).toBe('me')
    })
  })

  test('throws when channel is not allowlisted', async () => {
    const { client } = makeClient({ channelId: 'not-allowed' })
    await withFixture(async () => {
      await expect(
        fetchHistory(client, 'not-allowed', 10),
      ).rejects.toThrow('not allowlisted')
    })
  })
})

// ── downloadMessageAttachments ────────────────────────────────────────────────

describe('downloadMessageAttachments', () => {
  test('returns empty array when message has no attachments', async () => {
    const { client } = makeClient({
      channelId: ALLOWED_GUILD_ID,
      fetchedMsg: {
        id: 'msg-no-att',
        attachments: { values: () => [][Symbol.iterator]() },
      },
    })

    await withFixture(async () => {
      const paths = await downloadMessageAttachments(client, ALLOWED_GUILD_ID, 'msg-no-att')
      expect(paths).toEqual([])
    })
  })

  test('calls downloadAttachment for each attachment and returns paths', async () => {
    // Use a tiny real-content attachment so downloadAttachment actually writes it.
    // We provide fake att objects with a tiny data URL-style url.
    const tinyPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    )

    const att1 = {
      id: 'att-1',
      name: 'image.png',
      size: tinyPng.length,
      contentType: 'image/png',
      url: `data:image/png;base64,${tinyPng.toString('base64')}`,
    }

    // fetchedMsg with 1 attachment
    const { client } = makeClient({
      channelId: ALLOWED_GUILD_ID,
      fetchedMsg: {
        id: 'msg-with-att',
        attachments: {
          values: () => [att1][Symbol.iterator](),
        },
      },
    })

    // Stub fetch globally to handle data URLs (the real downloadAttachment uses `fetch`)
    const originalFetch = global.fetch
    ;(global as any).fetch = async (url: string) => {
      // decode base64 data URL
      const base64 = url.split(',')[1]!
      const buf = Buffer.from(base64, 'base64')
      return {
        arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      }
    }

    try {
      await withFixture(async () => {
        const paths = await downloadMessageAttachments(client, ALLOWED_GUILD_ID, 'msg-with-att')
        expect(paths).toHaveLength(1)
        expect(paths[0]).toMatch(/\.png$/)
      })
    } finally {
      ;(global as any).fetch = originalFetch
    }
  })

  test('throws when channel is not allowlisted', async () => {
    const { client } = makeClient({ channelId: 'not-allowed' })
    await withFixture(async () => {
      await expect(
        downloadMessageAttachments(client, 'not-allowed', 'msg-1'),
      ).rejects.toThrow('not allowlisted')
    })
  })
})
