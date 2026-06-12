import type { Module, ChannelRegistry, AgentRunner, DB, Memory, Safety, EventType, EventPayload } from '../modules/module.js'
import type { InboundMsg } from '../channels/channel.js'
import { readdirSync, statSync, renameSync, mkdirSync } from 'fs'
import { join } from 'path'
import { WORKSPACE, STREAM_EDIT_INTERVAL_MS, STREAM_EDIT_MIN_CHARS, OUTBOX_DIR, OWNER_IDS } from '../config.js'
import { modelFor } from './models.js'
import { detect as guardrailDetect } from '../modules/guardrail/index.js'
import type { PermissionBroker } from './permission.js'
import { maybeAppendDisclaimer } from './disclaimer.js'
import { classify } from './router.js'
import { recallMemories, rememberPreference, recordDecision, nowLine } from './memory.js'
import { fetchQuotes as defaultFetchQuotes } from '../modules/quote/index.js'

/** Injectable quote fetcher — defaults to real fetchQuotes; override in tests. */
export type QuoteFetcher = (symbols: string[]) => Promise<string>

// ── Streaming throttle helper ─────────────────────────────────────────────────

const MAX_EDIT = 2000

/**
 * Build a throttled onText callback for streaming incremental edits to a
 * Discord placeholder message.
 *
 * Throttle strategy: only edit when BOTH conditions hold:
 *   1. At least STREAM_EDIT_INTERVAL_MS ms have elapsed since the last edit.
 *   2. At least STREAM_EDIT_MIN_CHARS new characters have accumulated since
 *      the last edit.
 *
 * On any edit error (e.g. Discord 429), sets a flag that disables all
 * subsequent streaming edits for this turn — the final answer edit/send
 * (existing logic) still runs normally.
 *
 * @param editFn   The channel edit function to call.
 * @param channel  Channel identifier forwarded to editFn.
 * @param chatId   Chat identifier forwarded to editFn.
 * @param msgId    ID of the placeholder message to edit.
 * @param nowFn    Injectable clock (default: Date.now) — used in tests.
 * @returns  { onText, getAccumulated }
 *   - onText: pass to agent.run as the onText callback.
 *   - getAccumulated: returns the full text accumulated so far (not throttled).
 */
export function buildStreamingOnText(
  editFn: (channel: string, chatId: string, msgId: string, text: string) => Promise<void>,
  channel: string,
  chatId: string,
  msgId: string,
  nowFn: () => number = Date.now,
): { onText: (delta: string) => void; getAccumulated: () => string } {
  let accumulated = ''
  let lastEditAt = 0
  let lastEditedLen = 0
  let disabled = false

  const onText = (delta: string): void => {
    accumulated += delta

    if (disabled) return

    const now = nowFn()
    const newChars = accumulated.length - lastEditedLen
    const elapsed = now - lastEditAt

    if (elapsed >= STREAM_EDIT_INTERVAL_MS && newChars >= STREAM_EDIT_MIN_CHARS) {
      lastEditAt = now
      lastEditedLen = accumulated.length

      // Truncate to Discord limit for the streaming preview.
      const preview = accumulated.length <= MAX_EDIT
        ? accumulated
        : accumulated.slice(0, MAX_EDIT)

      // Fire-and-forget; catch errors to disable further streaming edits.
      editFn(channel, chatId, msgId, preview).catch(() => {
        disabled = true
      })
    }
  }

  const getAccumulated = (): string => accumulated

  return { onText, getAccumulated }
}

// ── Null-object stubs used until Batch B wires the real services ──────────────

const stubAgent: AgentRunner = {
  run() { throw new Error('AgentRunner not wired yet') },
}

const stubDb: DB = {
  getSession() { return null },
  putSession() {},
  audit() {},
  getJob() { return null },
  upsertJob() {},
  markJobRun() {},
  getCooldown() { return null },
  setCooldown() {},
}

const stubMemory: Memory = {
  loadPortfolioState() { return null },
  riskProfile() { return '' },
  buildContext() { return '' },
}

const stubSafety: Safety = {
  canUseTool: async () => ({ behavior: 'allow' }),
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Turn an agent error into a user-facing message. Subscription usage/session
 * limits get a clear explanation + a reminder that L0 quotes still work
 * (they don't consume the model quota). Everything else stays generic.
 */
/** Parse a trailing ===DECISION=== JSON block (one or array) → ledger rows,
 *  and return the text with the block stripped (so users don't see machine JSON). */
export function extractDecisions(text: string): { clean: string; decisions: Array<{ symbol: string; direction?: string; rationale?: string }> } {
  const idx = text.indexOf('===DECISION===')
  if (idx < 0) return { clean: text, decisions: [] }
  const clean = text.slice(0, idx).trimEnd()
  const blob = text.slice(idx + '===DECISION==='.length).trim()
  const out: Array<{ symbol: string; direction?: string; rationale?: string }> = []
  try {
    const parsed = JSON.parse(blob) as unknown
    const arr = Array.isArray(parsed) ? parsed : [parsed]
    for (const d of arr) {
      const o = d as Record<string, unknown>
      const symbol = typeof o['symbol'] === 'string' ? (o['symbol'] as string) : ''
      if (!symbol) continue
      out.push({
        symbol,
        direction: typeof o['direction'] === 'string' ? (o['direction'] as string) : undefined,
        rationale: typeof o['rationale'] === 'string' ? (o['rationale'] as string) : undefined,
      })
    }
  } catch { /* malformed → just strip, store nothing */ }
  return { clean, decisions: out }
}

/** Short one-line summary of a tool input for an approval prompt. */
export function summarizeToolInput(input: Record<string, unknown>): string {
  const cmd = input['command'] ?? input['file_path'] ?? input['url'] ?? input['path']
  let s = cmd != null ? String(cmd) : JSON.stringify(input)
  s = s.replace(/\s+/g, ' ').trim()
  return s.length > 200 ? s.slice(0, 200) + '…' : s
}

export function formatAgentError(err: string): string {
  if (/session limit|usage limit|hit your (session|usage) limit|rate limit|overloaded|resets/i.test(err)) {
    const m = err.match(/resets\s+([^\n.]+)/i)
    const when = m ? `（${m[1]!.trim()} 恢复）` : ''
    return `⚠️ Claude 订阅额度已用满${when}，深度分析暂不可用。\n` +
      `行情查询仍可用（不走额度）：直接发「NVDA 行情」「腾讯股价」这类即可。`
  }
  return '⚠️ 处理出错，已记录'
}

export class Dispatcher {
  readonly #modules: Module[]
  readonly #channels: ChannelRegistry
  readonly #agent: AgentRunner
  readonly #db: DB
  readonly #memory: Memory
  readonly #safety: Safety
  readonly #quoteFetcher: QuoteFetcher
  readonly #broker?: PermissionBroker

  /** Per-chat serial queue: ensures messages within the same chat are processed
   *  one-at-a-time (prevents session-resume race), while different chats run
   *  concurrently. */
  readonly #queue = new Map<string, Promise<void>>()

  constructor(
    modules: Module[],
    channels: ChannelRegistry,
    agent: AgentRunner = stubAgent,
    db: DB = stubDb,
    memory: Memory = stubMemory,
    safety: Safety = stubSafety,
    quoteFetcher: QuoteFetcher = defaultFetchQuotes,
    broker?: PermissionBroker,
  ) {
    this.#modules = modules
    this.#channels = channels
    this.#agent = agent
    this.#db = db
    this.#memory = memory
    this.#safety = safety
    this.#quoteFetcher = quoteFetcher
    this.#broker = broker
  }

  /** Enqueue inbound message for per-chat serial processing. */
  dispatch(inbound: InboundMsg): Promise<void> {
    const chatId = inbound.chatId

    // Permission replies (y/n <code>) JUMP THE QUEUE — the in-flight agent run
    // holding this chat's slot is blocked waiting on the approval. Resolve it
    // immediately instead of enqueuing behind that same run (would deadlock).
    if (this.#broker?.tryResolve(inbound.content)) {
      return Promise.resolve()
    }
    const prev = this.#queue.get(chatId) ?? Promise.resolve()
    const next = prev
      .then(() => this.#process(inbound))
      .catch(err => {
        process.stderr.write(`nimbus: dispatcher process error: ${err}\n`)
      })
      .finally(() => {
        // Only remove if we are still the tail; a newer message may have replaced us.
        if (this.#queue.get(chatId) === next) {
          this.#queue.delete(chatId)
        }
      })
    this.#queue.set(chatId, next)
    return next
  }

  /** Process a single inbound message. Module-matched or default conversation. */
  /** Deliver any charts/files the agent wrote to OUTBOX during this turn
   *  (mtime ≥ since), then archive to OUTBOX/sent/. Enables data-plotting work. */
  async #flushOutbox(channel: string, chatId: string, since: number): Promise<void> {
    let names: string[]
    try { names = readdirSync(OUTBOX_DIR) } catch { return }
    const sentDir = join(OUTBOX_DIR, 'sent')
    for (const name of names) {
      if (name === 'sent') continue
      const full = join(OUTBOX_DIR, name)
      try {
        const st = statSync(full)
        if (!st.isFile() || st.mtimeMs < since) continue
        await this.#channels.send(channel, chatId, `📎 ${name}`, { files: [full] })
        try { mkdirSync(sentDir, { recursive: true }); renameSync(full, join(sentDir, `${Date.now()}-${name}`)) } catch { /* ignore archive fail */ }
      } catch { /* skip unreadable / send fail */ }
    }
  }

  async #process(inbound: InboundMsg): Promise<void> {
    const chatId = inbound.chatId
    // ★隐私隔离:只有主人本人能看持仓/资金/记忆,他人受限。
    const isOwner = OWNER_IDS.includes(inbound.userId)

    // ── Memory capture fast-path (Phase 2) ─────────────────────────────────────
    // "记住 X" → store a lasting preference. ONLY the owner can write memory.
    const cap = /^\s*记住[：:，,]?\s*(.+)/s.exec(inbound.content)
    if (cap && cap[1] && cap[1].trim().length >= 2) {
      if (!isOwner) {
        await this.#channels.send(inbound.channel, chatId, '🔒 仅主人本人可写入记忆。', { replyTo: inbound.messageId })
        return
      }
      const pref = cap[1].trim()
      rememberPreference(pref)
      this.#db.audit({ channel: inbound.channel, chatId, user: inbound.user, kind: 'in', payload: `[mem-capture] ${pref}` })
      await this.#channels.send(inbound.channel, chatId, `记住了 ✓ 「${pref.slice(0, 80)}」会长期生效。`, { replyTo: inbound.messageId })
      return
    }

    // ── Module dispatch ───────────────────────────────────────────────────────
    const mod = this.#modules.find(m => m.match?.(inbound) ?? false)
    if (mod) {
      await mod.handle({
        trigger: { kind: 'message', payload: inbound },
        channels: this.#channels,
        agent: this.#agent,
        db: this.#db,
        memory: this.#memory,
        safety: this.#safety,
      })
      return
    }

    // ── Intent classification (M7) ────────────────────────────────────────────
    const { tier, symbols } = classify(inbound.content)

    // L0 fast path: pure quote request with resolvable symbols.
    // Does NOT invoke the agent — just shells out to futu/yfinance directly.
    if (tier === 'quote' && symbols.length > 0) {
      const quoteText = await this.#quoteFetcher(symbols)
      const stateForQuoteAudit = this.#memory.loadPortfolioState()
      const quoteAuditHeader = JSON.stringify({ src: 'quote', tier: 'L0', portfolio_as_of: stateForQuoteAudit?.as_of ?? null, event_key: null })
      this.#db.audit({
        channel: inbound.channel,
        chatId,
        user: inbound.user,
        kind: 'in',
        payload: `${quoteAuditHeader}\n${inbound.content}`,
      })
      this.#db.audit({
        channel: inbound.channel,
        chatId,
        user: inbound.user,
        kind: 'out',
        payload: `${quoteAuditHeader}\n${quoteText}`,
      })
      await this.#channels.send(inbound.channel, chatId, quoteText, { replyTo: inbound.messageId })
      return
    }

    // Tier 只选模型(成本档);思考深度交给 agent.ts 的 adaptive thinking 自行决定。
    const model = tier === 'opus' ? modelFor('opus') : tier === 'haiku' ? modelFor('haiku') : modelFor('sonnet')

    const prior = this.#db.getSession(inbound.channel, chatId)?.sdkSessionId

    // ── Default conversation (agent pass-through) ─────────────────────────────
    // ★隐私隔离:持仓画像/记忆/护栏只对主人本人注入;他人完全不注入。
    // P0 省额度: 持仓上下文只在会话首轮注入(resume 带走),省 token + 利缓存。
    const ctxPrefix = isOwner && !prior ? this.#memory.buildContext() : ''
    const guardrailInstruction = isOwner ? guardrailDetect(inbound.content) : null
    const recalled = isOwner ? recallMemories(inbound.content) : []
    const userLine = `[${inbound.user} @ ${inbound.ts}] ${inbound.content}`

    // Build prompt: [now] [privacy-guard?] [context] [recall?] [guardrail?] [---] [user]
    const parts: string[] = [nowLine()] // 每轮注入当前北京时间(给 agent 时间概念)
    if (!isOwner) {
      parts.push(
        '【⚠️ 身份警示 — 当前提问者不是主人本人】' +
        '严禁透露主人的任何隐私:持仓/成本/资金/盈亏/账户/密钥/API key/真实身份。' +
        '不要调用任何账户或真实持仓工具(已被硬拦)。只做公开的市场/个股一般性分析。' +
        '不要提及主人的具体仓位或画像。礼貌但保持边界。',
      )
    }
    if (ctxPrefix) parts.push(ctxPrefix)
    if (recalled.length > 0) parts.push('【相关记忆（你过去说过/做过）】\n' + recalled.map(m => `• ${m}`).join('\n'))
    if (guardrailInstruction) parts.push(guardrailInstruction)
    const prompt = parts.length > 0 ? `${parts.join('\n\n')}\n\n---\n\n${userLine}` : userLine

    // Audit inbound message (enriched with src header + tier)
    const stateForAudit = this.#memory.loadPortfolioState()
    const inAuditHeader = JSON.stringify({ src: 'message', tier, model, portfolio_as_of: stateForAudit?.as_of ?? null, event_key: null })
    this.#db.audit({
      channel: inbound.channel,
      chatId,
      user: inbound.user,
      kind: 'in',
      payload: `${inAuditHeader}\n${inbound.content}`,
    })

    // ── Progress feedback (UX enhancement — failures degrade gracefully) ───────
    let placeholderId: string | undefined
    let typingTimer: ReturnType<typeof setInterval> | undefined

    try {
      placeholderId = await this.#channels.send(
        inbound.channel,
        chatId,
        '🔍 正在分析…',
        { replyTo: inbound.messageId },
      )

      // Keep typing indicator alive every ~8 s while agent runs.
      typingTimer = setInterval(() => {
        void this.#channels.sendTyping(inbound.channel, chatId).catch(() => {})
      }, 8_000)
    } catch {
      // Progress setup failed — fall back to plain send at the end.
      placeholderId = undefined
    }

    const stopTyping = () => {
      if (typingTimer !== undefined) {
        clearInterval(typingTimer)
        typingTimer = undefined
      }
    }

    // ── Streaming onText setup (default conversation only) ───────────────────
    // Build a throttled onText that fires incremental edits to the placeholder.
    // Only active when a placeholder was successfully created.
    let streamOnText: ((delta: string) => void) | undefined
    if (placeholderId) {
      const { onText: throttledOnText } = buildStreamingOnText(
        (ch, cid, mid, txt) => this.#channels.edit(ch, cid, mid, txt),
        inbound.channel,
        chatId,
        placeholderId,
        Date.now,
      )
      streamOnText = throttledOnText
    }

    // Mark turn start so we can send any chart/file the agent drops in OUTBOX.
    const turnStart = Date.now()
    let sessionId: string | undefined
    let text = ''
    try {
      // Approver: routes ASK-listed tool calls to the user over this chat.
      const approver = this.#broker
        ? (toolName: string, input: Record<string, unknown>) => {
            const summary = summarizeToolInput(input)
            return this.#broker!.request(inbound.channel, chatId, toolName, summary)
          }
        : undefined

      const result = await this.#agent.run({
        prompt,
        resume: prior,
        model,
        onText: streamOnText,
        approver,
        blockAccount: !isOwner, // 非本人:禁查账户/持仓工具
      })
      sessionId = result.sessionId
      text = result.text
    } catch (err) {
      stopTyping()
      process.stderr.write(`nimbus: agent.run error: ${err}\n`)
      this.#db.audit({
        channel: inbound.channel,
        chatId,
        user: inbound.user,
        kind: 'error',
        payload: String(err),
      })
      const errText = formatAgentError(String(err))
      if (placeholderId) {
        try {
          await this.#channels.edit(inbound.channel, chatId, placeholderId, errText)
          return
        } catch {
          // edit failed — fall through to send a new message
        }
      }
      await this.#channels.send(inbound.channel, chatId, errText, { replyTo: inbound.messageId })
      return
    }

    stopTyping()

    // Send any charts/files the agent dropped in OUTBOX during this turn.
    await this.#flushOutbox(inbound.channel, chatId, turnStart)

    if (sessionId) {
      this.#db.putSession(inbound.channel, chatId, { sdkSessionId: sessionId, model, cwd: WORKSPACE })
    }

    // Decision ledger: strip + record any ===DECISION=== block the agent appended.
    // ★只记录主人本人的决策(他人对话不进台账/记忆)。
    const { clean, decisions } = extractDecisions(text || '(no response)')
    if (isOwner) {
      for (const d of decisions) {
        recordDecision({ channel: inbound.channel, chatId, symbol: d.symbol, direction: d.direction, rationale: d.rationale })
      }
    }
    const rawText = clean || '(no response)'
    // Apply disclaimer post-processing
    const finalText = maybeAppendDisclaimer(rawText)

    // Audit outbound message (enriched with src header + tier)
    const outAuditHeader = JSON.stringify({ src: 'message', tier, model, portfolio_as_of: stateForAudit?.as_of ?? null, event_key: null })
    this.#db.audit({
      channel: inbound.channel,
      chatId,
      kind: 'out',
      payload: `${outAuditHeader}\n${finalText}`,
    })

    // ── Send / edit final answer ───────────────────────────────────────────────
    if (!placeholderId) {
      // Progress setup failed — plain send
      await this.#channels.send(inbound.channel, chatId, finalText, { replyTo: inbound.messageId })
      return
    }

    if (finalText.length <= MAX_EDIT) {
      try {
        await this.#channels.edit(inbound.channel, chatId, placeholderId, finalText)
        return
      } catch {
        // edit failed — fall through to send a new message
      }
    } else {
      // Long reply: edit placeholder with first chunk, send rest as new messages.
      const { chunk } = await import('../channels/discord/outbound.js')
      const chunks = chunk(finalText, MAX_EDIT, 'newline')
      try {
        await this.#channels.edit(inbound.channel, chatId, placeholderId, chunks[0]!)
        for (let i = 1; i < chunks.length; i++) {
          await this.#channels.send(inbound.channel, chatId, chunks[i]!, {})
        }
        return
      } catch {
        // edit failed — fall through to send a new message
      }
    }

    // Final fallback: send as a new reply
    await this.#channels.send(inbound.channel, chatId, finalText, { replyTo: inbound.messageId })
  }

  /**
   * Enqueue a cron-triggered job for the matching module.
   * Uses the module's own chatId (REPORT_DM) as the queue key so cron jobs
   * are serialised with any live conversation in the same DM.
   */
  runCron(moduleName: string): Promise<void> {
    const mod = this.#modules.find(m => m.name === moduleName)
    if (!mod) {
      process.stderr.write(`nimbus: runCron: no module named "${moduleName}"\n`)
      return Promise.resolve()
    }

    // If the module declares a targetChat, use it as the queue key so this cron
    // job is serialised with any live conversation in the same chat (B1 fix).
    // Otherwise fall back to a module-scoped key that is isolated from DMs.
    const queueKey = mod.targetChat ?? `cron:${moduleName}`
    const prev = this.#queue.get(queueKey) ?? Promise.resolve()
    const next = prev
      .then(() => mod.handle({
        trigger: { kind: 'cron', job: moduleName },
        channels: this.#channels,
        agent: this.#agent,
        db: this.#db,
        memory: this.#memory,
        safety: this.#safety,
      }))
      .catch(err => {
        process.stderr.write(`nimbus: cron job ${moduleName} error: ${err}\n`)
      })
      .finally(() => {
        if (this.#queue.get(queueKey) === next) {
          this.#queue.delete(queueKey)
        }
      })
    this.#queue.set(queueKey, next)
    return next
  }

  /**
   * Enqueue an event-sourced alert payload for the matching module.
   * Event alerts bypass the guardrail (system-generated, not user input).
   * Uses targetChat (REPORT_DM) as the queue key to serialise with DM messages.
   */
  dispatchEvent(payload: EventPayload, targetChat: string): Promise<void> {
    // Find first module that subscribes to this event type
    const mod = this.#modules.find(m => m.events?.includes(payload.event as EventType))
    if (!mod) {
      process.stderr.write(`nimbus: dispatchEvent: no module for event "${payload.event}"\n`)
      return Promise.resolve()
    }

    const queueKey = mod.targetChat ?? targetChat
    const prev = this.#queue.get(queueKey) ?? Promise.resolve()
    const next = prev
      .then(() => mod.handle({
        trigger: { kind: 'event', event: payload.event as EventType, payload },
        channels: this.#channels,
        agent: this.#agent,
        db: this.#db,
        memory: this.#memory,
        safety: this.#safety,
      }))
      .catch(err => {
        process.stderr.write(`nimbus: dispatchEvent ${payload.event} error: ${err}\n`)
      })
      .finally(() => {
        if (this.#queue.get(queueKey) === next) {
          this.#queue.delete(queueKey)
        }
      })
    this.#queue.set(queueKey, next)
    return next
  }

  /**
   * Wait for all in-flight queue promises to settle, then resolve.
   * Call from shutdown before closing the DB so in-progress agent callbacks
   * (putSession / audit / markJobRun) have a chance to complete (B3 fix).
   *
   * A timeout can be layered by the caller (see main.ts).
   */
  async drain(): Promise<void> {
    // Snapshot current tail promises and await them all.
    // New entries arriving after the snapshot are ignored (shutdown is imminent).
    const pending = [...this.#queue.values()]
    await Promise.allSettled(pending)
  }

  // ── Exposed for tests ─────────────────────────────────────────────────────
  /** Returns the sdkSessionId stored in DB for the given chatId on the 'discord' channel.
   *  Kept for test compatibility; reads from DB rather than an in-memory map. */
  sessionMapGet(channel: string, chatId: string): string | undefined {
    return this.#db.getSession(channel, chatId)?.sdkSessionId
  }
}
