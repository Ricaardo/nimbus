import { describe, test, expect, beforeEach } from 'bun:test'
import { join } from 'path'
import { chunk } from './outbound.js'
import {
  readAccessFile,
  gate,
  isMentioned,
  recentSentIds,
  noteSent,
  dmChannelUsers,
} from './access.js'

// ── Test helpers ──────────────────────────────────────────────────────────────

// Point DISCORD_STATE_DIR at fixture for all access tests
const FIXTURE_DIR = join(import.meta.dir, '../../test/fixtures')

function withFixture<T>(fn: () => T): T {
  const orig = process.env.DISCORD_STATE_DIR
  process.env.DISCORD_STATE_DIR = FIXTURE_DIR
  try {
    return fn()
  } finally {
    if (orig === undefined) delete process.env.DISCORD_STATE_DIR
    else process.env.DISCORD_STATE_DIR = orig
  }
}

// Build a minimal Message-like mock for gate/isMentioned tests.
// ChannelType.DM = 1, guild text = 0
function makeDmMsg(senderId: string, content = 'hello') {
  return {
    author: { id: senderId, bot: false, username: 'user' },
    channelId: 'dm-channel-1',
    channel: { type: 1, isThread: () => false },
    content,
    mentions: { users: { has: () => false } },
    reference: undefined,
    fetchReference: async () => { throw new Error('no ref') },
    attachments: { values: () => [][Symbol.iterator]() },
    createdAt: new Date(),
  } as any
}

function makeGuildMsg(
  senderId: string,
  channelId: string,
  content = 'hello',
  mentionedBotId?: string,
) {
  return {
    author: { id: senderId, bot: false, username: 'user' },
    channelId,
    channel: { type: 0, isThread: () => false },
    content,
    mentions: {
      users: {
        has: (uid: string) => uid === mentionedBotId,
      },
    },
    reference: undefined,
    fetchReference: async () => { throw new Error('no ref') },
    attachments: { values: () => [][Symbol.iterator]() },
    createdAt: new Date(),
  } as any
}

// ── chunk tests ───────────────────────────────────────────────────────────────

describe('chunk', () => {
  test('short text returns single chunk', () => {
    expect(chunk('hello', 2000, 'length')).toEqual(['hello'])
  })

  test('exact limit returns single chunk', () => {
    const s = 'a'.repeat(2000)
    expect(chunk(s, 2000, 'length')).toHaveLength(1)
  })

  test('over limit hard-cuts', () => {
    const s = 'a'.repeat(2500)
    const parts = chunk(s, 2000, 'length')
    expect(parts.length).toBe(2)
    expect(parts[0]!.length).toBe(2000)
    expect(parts[1]!.length).toBe(500)
  })

  test('newline mode prefers paragraph boundary', () => {
    const first = 'a'.repeat(800)
    const second = 'b'.repeat(800)
    // text = 800 a's + "\n\n" + 800 b's + " " + 800 c's, total >> 1700
    const text = first + '\n\n' + second + ' ' + 'c'.repeat(800)
    const parts = chunk(text, 1700, 'newline')
    // Should split at or near the paragraph boundary (para index 800 is > 1700/2=850? No: 800 > 850 is false)
    // Actually 800 > 850 is false, so it won't use para. Let's use a wider limit.
    // Rebuild: 1200 a's + "\n\n" + 1200 b's, limit 1500 → para at 1200 > 750 → split there.
    const text2 = 'a'.repeat(1200) + '\n\n' + 'b'.repeat(1200)
    const parts2 = chunk(text2, 1500, 'newline')
    expect(parts2.length).toBeGreaterThanOrEqual(2)
    // parts2[0] ends at index 1200 (para position) — slice(0, 1200) = 1200 a's
    expect(parts2[0]!).toBe('a'.repeat(1200))
  })

  test('newline mode falls back to hard cut when no boundary', () => {
    const s = 'a'.repeat(4000)
    const parts = chunk(s, 2000, 'newline')
    expect(parts.length).toBe(2)
    expect(parts[0]!.length).toBe(2000)
  })
})

// ── gate tests ────────────────────────────────────────────────────────────────

describe('gate (allowlist mode)', () => {
  const OWNER_ID = '1086665220723855560'
  const STRANGER_ID = '9999999999999999999'
  const GUILD_CH_MENTION = '1086665896547864579'   // requireMention: true
  const GUILD_CH_NO_MENTION = '1484554871800725624' // requireMention: false

  test('DM from allowlisted user → deliver', async () => {
    const result = await withFixture(() => gate(makeDmMsg(OWNER_ID)))
    expect(result.action).toBe('deliver')
  })

  test('DM from non-allowlist user → drop (allowlist policy)', async () => {
    const result = await withFixture(() => gate(makeDmMsg(STRANGER_ID)))
    expect(result.action).toBe('drop')
  })

  test('guild channel: no policy → drop', async () => {
    const result = await withFixture(() =>
      gate(makeGuildMsg(OWNER_ID, 'unknown-channel-id', 'hello'))
    )
    expect(result.action).toBe('drop')
  })

  test('guild channel requireMention=true, no mention → drop', async () => {
    const result = await withFixture(() =>
      gate(makeGuildMsg(OWNER_ID, GUILD_CH_MENTION, 'hello'))
    )
    expect(result.action).toBe('drop')
  })

  test('guild channel requireMention=true, pattern match "cici" → deliver', async () => {
    const result = await withFixture(() =>
      gate(makeGuildMsg(OWNER_ID, GUILD_CH_MENTION, 'cici what is NVDA?'))
    )
    expect(result.action).toBe('deliver')
  })

  test('guild channel requireMention=false → deliver without mention', async () => {
    const result = await withFixture(() =>
      gate(makeGuildMsg(OWNER_ID, GUILD_CH_NO_MENTION, 'morning update'))
    )
    expect(result.action).toBe('deliver')
  })

  test('guild channel requireMention=true, wrong user in allowFrom → drop', async () => {
    const result = await withFixture(() =>
      gate(makeGuildMsg(STRANGER_ID, GUILD_CH_MENTION, 'cici hello'))
    )
    expect(result.action).toBe('drop')
  })
})

// ── isMentioned tests ─────────────────────────────────────────────────────────

describe('isMentioned', () => {
  beforeEach(() => {
    recentSentIds.clear()
    dmChannelUsers.clear()
  })

  test('recentSentIds hit → true', async () => {
    const msgId = 'recent-msg-id'
    noteSent(msgId)
    const msg = {
      author: { id: 'u1' },
      content: 'hello',
      channel: { type: 0 },
      mentions: { users: { has: () => false } },
      reference: { messageId: msgId },
      fetchReference: async () => { throw new Error('no fetch') },
    } as any
    const result = await isMentioned(msg, [], 'bot-id')
    expect(result).toBe(true)
  })

  test('pattern "(?i)^cici\\b" matches', async () => {
    const msg = {
      author: { id: 'u1' },
      content: 'Cici what do you think?',
      channel: { type: 0 },
      mentions: { users: { has: () => false } },
      reference: undefined,
      fetchReference: async () => { throw new Error('no ref') },
    } as any
    const result = await isMentioned(msg, ['(?i)^cici\\b'], 'bot-id')
    expect(result).toBe(true)
  })

  test('pattern "(?i)\\bcici\\b" matches mid-sentence', async () => {
    const msg = {
      author: { id: 'u1' },
      content: 'hey cici look at this',
      channel: { type: 0 },
      mentions: { users: { has: () => false } },
      reference: undefined,
      fetchReference: async () => { throw new Error('no ref') },
    } as any
    const result = await isMentioned(msg, ['(?i)\\bcici\\b'], 'bot-id')
    expect(result).toBe(true)
  })

  test('no mention → false', async () => {
    const msg = {
      author: { id: 'u1' },
      content: 'what time is it',
      channel: { type: 0 },
      mentions: { users: { has: () => false } },
      reference: undefined,
      fetchReference: async () => { throw new Error('no ref') },
    } as any
    const result = await isMentioned(msg, ['(?i)^cici\\b', '(?i)\\bcici\\b'], 'bot-id')
    expect(result).toBe(false)
  })
})
