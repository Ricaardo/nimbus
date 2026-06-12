// Outbound send helpers — ported from server.ts L398-447 + L654-686.
// No static discord.js import; client is passed as a parameter.

import { mkdirSync, writeFileSync, statSync, realpathSync } from 'fs'
import { join, sep } from 'path'
import { INBOX_DIR, STATE_DIR } from '../../config.js'
import { dmChannelUsers, loadAccess, noteSent } from './access.js'
import type { SendOpts, HistoryEntry } from '../channel.js'

// Type aliases — erased at runtime, so safe without loading discord.js.
type DiscordClient = import('discord.js').Client
type Attachment = import('discord.js').Attachment

const MAX_CHUNK_LIMIT = 2000
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

// Exfil guard — ported from server.ts L165-175. Refuse to upload anything under
// STATE_DIR except inbox/ — i.e. never let a file attachment leak access.json,
// .env (bot token), or pending/approved state out a Discord channel.
function assertSendable(f: string): void {
  let real: string, stateReal: string
  try {
    real = realpathSync(f)
    stateReal = realpathSync(STATE_DIR)
  } catch {
    return // statSync will fail properly; or STATE_DIR absent → nothing to leak
  }
  const inbox = join(stateReal, 'inbox')
  if (real.startsWith(stateReal + sep) && !real.startsWith(inbox + sep)) {
    throw new Error(`refusing to send channel state: ${f}`)
  }
}

// ── chunk ─────────────────────────────────────────────────────────────────────

// Shared channel-agnostic implementation; re-exported here so existing import
// sites (e.g. `import { chunk } from './outbound.js'`) keep working unchanged.
import { chunk } from '../shared/chunk.js'
export { chunk } from '../shared/chunk.js'

// ── Channel fetchers ──────────────────────────────────────────────────────────

export async function fetchTextChannel(client: DiscordClient, id: string) {
  const ch = await client.channels.fetch(id)
  if (!ch || !ch.isTextBased()) {
    throw new Error(`channel ${id} not found or not text-based`)
  }
  return ch
}

// Outbound gate — tools can only target chats the inbound gate would deliver from.
// DM channel ID ≠ user ID, so we inspect the fetched channel's type.
// ChannelType.DM === 1
export async function fetchAllowedChannel(client: DiscordClient, id: string) {
  const ch = await fetchTextChannel(client, id)
  const access = loadAccess()
  if (ch.type === 1 /* ChannelType.DM */) {
    const userId = (ch as any).recipientId ?? dmChannelUsers.get(id)
    if (userId && access.allowFrom.includes(userId)) return ch
  } else {
    const key = ch.isThread() ? (ch as any).parentId ?? ch.id : ch.id
    if (key in access.groups) return ch
  }
  throw new Error(`channel ${id} is not allowlisted — add via /discord:access`)
}

// ── sendReply ─────────────────────────────────────────────────────────────────

/**
 * Send text to a Discord channel, chunking if needed, with optional reply
 * threading and file attachments.
 * Returns the ID of the first sent message.
 */
export async function sendReply(
  client: DiscordClient,
  chatId: string,
  text: string,
  opts?: SendOpts,
): Promise<string> {
  const ch = await fetchAllowedChannel(client, chatId)
  if (!('send' in ch)) throw new Error('channel is not sendable')

  const files = opts?.files ?? []
  for (const f of files) {
    assertSendable(f)
    const st = statSync(f)
    if (st.size > MAX_ATTACHMENT_BYTES) {
      throw new Error(`file too large: ${f} (${(st.size / 1024 / 1024).toFixed(1)}MB, max 25MB)`)
    }
  }
  if (files.length > 10) throw new Error('Discord allows max 10 attachments per message')

  const access = loadAccess()
  const limit = Math.max(1, Math.min(access.textChunkLimit ?? MAX_CHUNK_LIMIT, MAX_CHUNK_LIMIT))
  const mode = access.chunkMode ?? 'length'
  const replyMode = access.replyToMode ?? 'first'
  const chunks = chunk(text, limit, mode)
  const sentIds: string[] = []

  try {
    for (let i = 0; i < chunks.length; i++) {
      const shouldReplyTo =
        opts?.replyTo != null &&
        replyMode !== 'off' &&
        (replyMode === 'all' || i === 0)
      const sent = await (ch as any).send({
        content: chunks[i],
        ...(i === 0 && files.length > 0 ? { files } : {}),
        ...(shouldReplyTo
          ? { reply: { messageReference: opts!.replyTo, failIfNotExists: false } }
          : {}),
      })
      noteSent(sent.id)
      sentIds.push(sent.id)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`reply failed after ${sentIds.length} of ${chunks.length} chunk(s) sent: ${msg}`)
  }

  return sentIds[0]!
}

// ── downloadAttachment ────────────────────────────────────────────────────────

export async function downloadAttachment(att: Attachment): Promise<string> {
  if (att.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`attachment too large: ${(att.size / 1024 / 1024).toFixed(1)}MB, max ${MAX_ATTACHMENT_BYTES / 1024 / 1024}MB`)
  }
  const res = await fetch(att.url)
  const buf = Buffer.from(await res.arrayBuffer())
  const name = att.name ?? `${att.id}`
  const rawExt = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : 'bin'
  const ext = rawExt.replace(/[^a-zA-Z0-9]/g, '') || 'bin'
  const path = `${INBOX_DIR}/${Date.now()}-${att.id}.${ext}`
  mkdirSync(INBOX_DIR, { recursive: true })
  writeFileSync(path, buf)
  return path
}

export function safeAttName(att: Attachment): string {
  return (att.name ?? att.id).replace(/[\[\]\r\n;]/g, '_')
}

// ── editMessage ───────────────────────────────────────────────────────────────

/** Edit a message already sent by the bot. Returns the edited message id. */
export async function editMessage(
  client: DiscordClient,
  chatId: string,
  msgId: string,
  text: string,
): Promise<string> {
  const ch = await fetchAllowedChannel(client, chatId)
  const msg = await (ch as any).messages.fetch(msgId)
  const edited = await msg.edit(text)
  return edited.id as string
}

// ── react ─────────────────────────────────────────────────────────────────────

/** Add an emoji reaction to a message. */
export async function reactToMessage(
  client: DiscordClient,
  chatId: string,
  msgId: string,
  emoji: string,
): Promise<void> {
  const ch = await fetchAllowedChannel(client, chatId)
  const msg = await (ch as any).messages.fetch(msgId)
  await msg.react(emoji)
}

// ── fetchHistory ──────────────────────────────────────────────────────────────

// Re-export so callers can import the type from here or from channel.ts.
export type { HistoryEntry }

/**
 * Fetch up to `limit` recent messages (capped at 100) from a channel.
 * Returns oldest-first structured array.
 */
export async function fetchHistory(
  client: DiscordClient,
  chatId: string,
  limit: number,
): Promise<HistoryEntry[]> {
  const ch = await fetchAllowedChannel(client, chatId)
  const safeLimit = Math.min(limit, 100)
  const msgs = await (ch as any).messages.fetch({ limit: safeLimit })
  const me = client.user?.id
  const arr = [...msgs.values()].reverse() as any[]
  return arr.map(m => ({
    id: m.id as string,
    author: (m.author.id === me ? 'me' : m.author.username) as string,
    ts: (m.createdAt as Date).toISOString(),
    content: (m.content as string).replace(/[\r\n]+/g, ' ⏎ '),
    attachments: (m.attachments.size as number),
  }))
}

// ── download ──────────────────────────────────────────────────────────────────

/** Download all attachments from a message. Returns array of local paths. */
export async function downloadMessageAttachments(
  client: DiscordClient,
  chatId: string,
  msgId: string,
): Promise<string[]> {
  const ch = await fetchAllowedChannel(client, chatId)
  const msg = await (ch as any).messages.fetch(msgId)
  const paths: string[] = []
  for (const att of msg.attachments.values()) {
    const path = await downloadAttachment(att as Attachment)
    paths.push(path)
  }
  return paths
}
