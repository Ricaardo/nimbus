import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs'
import { randomBytes } from 'crypto'
import { ACCESS_FILE, STATE_DIR } from '../../config.js'

// ── Types ─────────────────────────────────────────────────────────────────────

type PendingEntry = {
  senderId: string
  chatId: string // DM channel ID — where to send the approval confirm
  createdAt: number
  expiresAt: number
  replies: number
}

type GroupPolicy = {
  requireMention: boolean
  allowFrom: string[]
}

export type Access = {
  dmPolicy: 'pairing' | 'allowlist' | 'disabled'
  allowFrom: string[]
  /** Keyed on channel ID (snowflake), not guild ID. One entry per guild channel. */
  groups: Record<string, GroupPolicy>
  pending: Record<string, PendingEntry>
  mentionPatterns?: string[]
  ackReaction?: string
  replyToMode?: 'off' | 'first' | 'all'
  textChunkLimit?: number
  chunkMode?: 'length' | 'newline'
}

export function defaultAccess(): Access {
  return {
    dmPolicy: 'pairing',
    allowFrom: [],
    groups: {},
    pending: {},
  }
}

// ── File I/O ──────────────────────────────────────────────────────────────────

export function readAccessFile(): Access {
  try {
    const raw = readFileSync(ACCESS_FILE, 'utf8')
    const parsed = JSON.parse(raw) as Partial<Access>
    return {
      dmPolicy: parsed.dmPolicy ?? 'pairing',
      allowFrom: parsed.allowFrom ?? [],
      groups: parsed.groups ?? {},
      pending: parsed.pending ?? {},
      mentionPatterns: parsed.mentionPatterns,
      ackReaction: parsed.ackReaction,
      replyToMode: parsed.replyToMode,
      textChunkLimit: parsed.textChunkLimit,
      chunkMode: parsed.chunkMode,
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return defaultAccess()
    try { renameSync(ACCESS_FILE, `${ACCESS_FILE}.corrupt-${Date.now()}`) } catch {}
    process.stderr.write(`discord: access.json is corrupt, moved aside. Starting fresh.\n`)
    return defaultAccess()
  }
}

export function saveAccess(a: Access): void {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 })
  const tmp = ACCESS_FILE + '.tmp'
  writeFileSync(tmp, JSON.stringify(a, null, 2) + '\n', { mode: 0o600 })
  renameSync(tmp, ACCESS_FILE)
}

export function pruneExpired(a: Access): boolean {
  const now = Date.now()
  let changed = false
  for (const [code, p] of Object.entries(a.pending)) {
    if (p.expiresAt < now) {
      delete a.pending[code]
      changed = true
    }
  }
  return changed
}

/** Simplified loadAccess: always reads the file (no STATIC mode in M0). */
export function loadAccess(): Access {
  return readAccessFile()
}

// ── Shared state — single instances, imported by index.ts and outbound.ts ────

// DM channel ID → user ID, captured on inbound (msg.author.id is always present).
// Lets the outbound gate authorize DM replies even when the gateway-cached DM
// channel has no recipientId. Mirrors the upstream official fix (no REST refetch).
export const dmChannelUsers = new Map<string, string>()

// Track message IDs we recently sent, so reply-to-bot in guild channels
// counts as a mention without needing fetchReference().
export const recentSentIds = new Set<string>()
const RECENT_SENT_CAP = 200

export function noteSent(id: string): void {
  recentSentIds.add(id)
  if (recentSentIds.size > RECENT_SENT_CAP) {
    // Sets iterate in insertion order — this drops the oldest.
    const first = recentSentIds.values().next().value
    if (first) recentSentIds.delete(first)
  }
}

// ── Gate / isMentioned ────────────────────────────────────────────────────────

export type GateResult =
  | { action: 'deliver'; access: Access }
  | { action: 'drop' }
  | { action: 'pair'; code: string; isResend: boolean }

// gate and isMentioned accept a Message-shaped object via type-only import
// so that access.ts has no runtime discord.js dependency itself.
type MsgLike = import('discord.js').Message

export async function gate(msg: MsgLike, botUserId?: string): Promise<GateResult> {
  const access = loadAccess()
  const pruned = pruneExpired(access)
  if (pruned) saveAccess(access)

  if (access.dmPolicy === 'disabled') return { action: 'drop' }

  const senderId = msg.author.id
  // import type is erased at runtime; ChannelType.DM === 1
  const DM_TYPE = 1
  const isDM = msg.channel.type === DM_TYPE

  if (isDM) {
    if (access.allowFrom.includes(senderId)) return { action: 'deliver', access }
    if (access.dmPolicy === 'allowlist') return { action: 'drop' }

    // pairing mode — check for existing non-expired code for this sender
    for (const [code, p] of Object.entries(access.pending)) {
      if (p.senderId === senderId) {
        if ((p.replies ?? 1) >= 2) return { action: 'drop' }
        p.replies = (p.replies ?? 1) + 1
        saveAccess(access)
        return { action: 'pair', code, isResend: true }
      }
    }
    // Cap pending at 3. Extra attempts are silently dropped.
    if (Object.keys(access.pending).length >= 3) return { action: 'drop' }

    const code = randomBytes(3).toString('hex') // 6 hex chars
    const now = Date.now()
    access.pending[code] = {
      senderId,
      chatId: msg.channelId,
      createdAt: now,
      expiresAt: now + 60 * 60 * 1000, // 1h
      replies: 1,
    }
    saveAccess(access)
    return { action: 'pair', code, isResend: false }
  }

  // Guild channel gate. Key on channel ID (not guild ID).
  const channelId = msg.channel.isThread()
    ? (msg.channel as any).parentId ?? msg.channelId
    : msg.channelId
  const policy = access.groups[channelId]
  if (!policy) return { action: 'drop' }
  const groupAllowFrom = policy.allowFrom ?? []
  const requireMention = policy.requireMention ?? true
  if (groupAllowFrom.length > 0 && !groupAllowFrom.includes(senderId)) {
    return { action: 'drop' }
  }
  if (requireMention && !(await isMentioned(msg, access.mentionPatterns, botUserId))) {
    return { action: 'drop' }
  }
  return { action: 'deliver', access }
}

export async function isMentioned(
  msg: MsgLike,
  extraPatterns?: string[],
  botUserId?: string,
): Promise<boolean> {
  // Check @mention via mentions collection (works when botUserId is set)
  if (botUserId) {
    if (msg.mentions.users?.has(botUserId)) return true
  }

  // Reply to one of our messages counts as an implicit mention.
  const refId = msg.reference?.messageId
  if (refId) {
    if (recentSentIds.has(refId)) return true
    // Fallback: fetch the referenced message and check authorship.
    try {
      const ref = await msg.fetchReference()
      if (ref.author.id === botUserId) return true
    } catch {}
  }

  const text = msg.content
  for (const rawPat of extraPatterns ?? []) {
    try {
      // Strip Python/PCRE-style inline flag (?i) — JS uses the `i` flag arg.
      const pat = rawPat.replace(/^\(\?[a-z]+\)/, '')
      if (new RegExp(pat, 'i').test(text)) return true
    } catch {}
  }
  return false
}
