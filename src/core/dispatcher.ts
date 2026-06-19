import type { Module, ChannelRegistry, AgentRunner, DB, Memory, Safety, EventType, EventPayload } from '../modules/module.js'
import type { InboundMsg } from '../channels/channel.js'
import { readdirSync, statSync, renameSync, mkdirSync } from 'fs'
import { join } from 'path'
import { WORKSPACE, STREAM_EDIT_INTERVAL_MS, STREAM_EDIT_MIN_CHARS, OUTBOX_DIR, OWNER_IDS } from '../config.js'
import { modelFor } from './models.js'
import { detect as guardrailDetect } from '../modules/guardrail/index.js'
import type { PermissionBroker } from './permission.js'
import { maybeAppendDisclaimer } from './disclaimer.js'
import { classify, type Tier } from './router.js'
import { recallMemories, rememberPreference, recordDecision, nowLine } from './memory.js'
import { kbSearch, formatRecall, kbIngest } from './knowledge.js'
import { extractSymbols } from './symbol.js'
import { fetchQuotes as defaultFetchQuotes } from '../modules/quote/index.js'
import { degradeLevel, applyDegrade } from './budget.js'

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
export function extractDecisions(text: string): { clean: string; decisions: Array<{ symbol: string; direction?: string; rationale?: string; confidence?: string }> } {
  const idx = text.indexOf('===DECISION===')
  if (idx < 0) return { clean: text, decisions: [] }
  const clean = text.slice(0, idx).trimEnd()
  const blob = text.slice(idx + '===DECISION==='.length).trim()
  const out: Array<{ symbol: string; direction?: string; rationale?: string; confidence?: string }> = []
  try {
    const parsed = JSON.parse(blob) as unknown
    const arr = Array.isArray(parsed) ? parsed : [parsed]
    for (const d of arr) {
      const o = d as Record<string, unknown>
      const symbol = typeof o['symbol'] === 'string' ? (o['symbol'] as string) : ''
      if (!symbol) continue
      // confidence 可为字符串(高/中/低)或数字(0~1) → 统一存字符串,供命中率闭环评校准。
      const conf = o['confidence']
      out.push({
        symbol,
        direction: typeof o['direction'] === 'string' ? (o['direction'] as string) : undefined,
        rationale: typeof o['rationale'] === 'string' ? (o['rationale'] as string) : undefined,
        confidence: typeof conf === 'string' ? conf : typeof conf === 'number' ? String(conf) : undefined,
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
  if (/timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|network|fetch failed|socket hang up/i.test(err)) {
    return '⚠️ 网络/上游暂时不稳，刚才那条没跑成。稍等几秒重发一次试试；行情查询（如「NVDA」）不受影响。'
  }
  return '⚠️ 处理出错，已记录。稍后重发一次试试；查行情（如「腾讯」）随时可用。'
}

// ── Local command fast-paths (help / 新话题 / 台账) ─────────────────────────────

/** Normalize a message to a bare command token (strip leading slash + trim). */
function commandOf(content: string): string {
  return content.trim().replace(/^\/+/, '').trim().toLowerCase()
}

const HELP_CMDS = new Set(['help', '帮助', '菜单', '使用说明', '你能做什么', '能做什么', '怎么用', '?', '？'])
const NEW_CMDS = new Set(['new', '新话题', '新对话', '重置', '重置会话', '重新开始', '清空', '清空上下文', '清除上下文', 'reset'])
const LEDGER_CMDS = new Set(['我的建议', '台账', '决策台账', '我的台账', '决策记录', '建议台账', 'my calls'])
const HWM_RESET_CMDS = new Set(['重置高水位', '重置回撤', '重置峰值', 'reset hwm', 'reset drawdown', 'reset peak'])

/** Cici's capability card — concise, mobile-friendly, no tables. */
export function helpCard(): string {
  return [
    '🌙 **Cici · 你的私人投资分析师**',
    '',
    '**直接问就行**，我自动分档：',
    '• 查行情 — 发「NVDA」「腾讯」「00700」秒回报价（不耗额度）',
    '• 深度 — 「NVDA 怎么看」「AAPL 估值」「我该减仓吗」走完整分析',
    '• 闲聊/记事 — 随便聊；「记住 …」存长期偏好',
    '',
    '**指令**',
    '• `帮助` — 这张卡',
    '• `新话题` — 清空上下文重开（换标的时用）',
    '• `我的建议` — 看决策台账（我给过的明确买卖建议）',
    '• `重置高水位` — 出入金后重置回撤告警的峰值基准',
    '',
    '**红线**：我只给【标的/方向/数量/价格】建议，绝不替你下单。',
  ].join('\n')
}

const DIR_LABEL: Record<string, string> = {
  buy: '🟢 买入', long: '🟢 买入', add: '🟢 加仓',
  sell: '🔴 卖出', short: '🔴 卖空', trim: '🟠 减仓', reduce: '🟠 减仓', close: '⚪ 清仓',
  hold: '⚪ 持有', watch: '👀 观望',
}

/** Format the open-decision ledger for the "我的建议/台账" command. */
export function formatLedger(
  rows: Array<{ ts: number; symbol: string; direction: string | null; rationale: string | null }>,
): string {
  if (rows.length === 0) {
    return '📋 台账还是空的 — 我还没给过明确的买卖建议。给你具体方向时会自动留痕，方便日后对照结果。'
  }
  const lines = [`📋 **决策台账** · 未结 ${rows.length} 条`, '']
  for (const r of rows) {
    const date = new Date(r.ts).toISOString().slice(0, 10)
    const dir = r.direction ? (DIR_LABEL[r.direction.toLowerCase()] ?? r.direction) : ''
    lines.push(`• **${r.symbol}** ${dir} · ${date}`)
    if (r.rationale) lines.push(`　${r.rationale}`)
  }
  return lines.join('\n')
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
    // ★隐私隔离:只有主人本人能看持仓/资金/记忆,他人受限。
    const isOwner = OWNER_IDS.includes(inbound.userId)

    // Fast paths (no agent, no quota) — each returns true once it handles the message.
    if (await this.#tryMemoryCapture(inbound, isOwner)) return
    if (await this.#tryCommand(inbound, isOwner)) return
    if (await this.#tryModule(inbound)) return

    // ── Intent classification (M7) ────────────────────────────────────────────
    const { tier, symbols } = classify(inbound.content)

    // L0 fast path: pure quote request with resolvable symbols (no agent).
    // ★ Must run BEFORE the budget gate — L0 quotes are never affected by budget.
    if (tier === 'quote' && symbols.length > 0) {
      await this.#handleQuote(inbound, symbols)
      return
    }

    // ── Budget degrade gate (Phase 3) ─────────────────────────────────────────
    // Only applied to interactive #process; dispatchEvent/runCron are not gated.
    const todayCost = (this.#db as { getTodayCost?: () => number }).getTodayCost?.() ?? 0
    const level = degradeLevel(todayCost)
    const { tier: effTier, blocked } = applyDegrade(tier, level)

    if (blocked) {
      // Level 2: deep analysis paused — short-circuit without calling agent.
      const blockedMsg = '⚠️ 今日额度已达上限，深度分析暂停至明日；行情查询（如「NVDA」）仍可用。'
      const auditHeader = JSON.stringify({ src: 'budget_blocked', tier, level, portfolio_as_of: null, event_key: null })
      this.#db.audit({ channel: inbound.channel, chatId: inbound.chatId, user: inbound.user, kind: 'out', payload: `${auditHeader}\n${blockedMsg}` })
      await this.#channels.send(inbound.channel, inbound.chatId, blockedMsg, { replyTo: inbound.messageId })
      return
    }

    // Tier 只选模型(成本档);思考深度交给 agent.ts 的 adaptive thinking 自行决定。
    const model = effTier === 'opus' ? modelFor('opus') : effTier === 'haiku' ? modelFor('haiku') : modelFor('sonnet')
    const degraded = effTier !== tier
    await this.#runConversation(inbound, isOwner, effTier, model, degraded)
  }

  /** "记住 X" → store a lasting preference (owner-only). Returns true if handled. */
  async #tryMemoryCapture(inbound: InboundMsg, isOwner: boolean): Promise<boolean> {
    const chatId = inbound.chatId
    const cap = /^\s*记住[：:，,]?\s*(.+)/s.exec(inbound.content)
    if (!(cap && cap[1] && cap[1].trim().length >= 2)) return false
    if (!isOwner) {
      await this.#channels.send(inbound.channel, chatId, '🔒 仅主人本人可写入记忆。', { replyTo: inbound.messageId })
      return true
    }
    const pref = cap[1].trim()
    rememberPreference(pref)
    this.#db.audit({ channel: inbound.channel, chatId, user: inbound.user, kind: 'in', payload: `[mem-capture] ${pref}` })
    await this.#channels.send(inbound.channel, chatId, `记住了 ✓ 「${pref.slice(0, 80)}」会长期生效。`, { replyTo: inbound.messageId })
    return true
  }

  /** Local command fast-paths (帮助/新话题/台账) — no agent. Returns true if handled. */
  async #tryCommand(inbound: InboundMsg, isOwner: boolean): Promise<boolean> {
    const chatId = inbound.chatId
    const command = commandOf(inbound.content)

    // 帮助/菜单 → capability card (open to anyone — no private data).
    if (HELP_CMDS.has(command)) {
      await this.#channels.send(inbound.channel, chatId, helpCard(), { replyTo: inbound.messageId })
      return true
    }

    // 新话题/重置 → drop the agent session so the next turn starts fresh.
    if (NEW_CMDS.has(command)) {
      this.#db.clearSession?.(inbound.channel, chatId)
      await this.#channels.send(inbound.channel, chatId, '🆕 已开新话题，上下文已清空。问吧。', { replyTo: inbound.messageId })
      return true
    }

    // 我的建议/台账 → decision ledger. ★Owner-only (主人的决策留痕属隐私).
    if (LEDGER_CMDS.has(command)) {
      if (!isOwner) {
        await this.#channels.send(inbound.channel, chatId, '🔒 决策台账仅主人本人可见。', { replyTo: inbound.messageId })
        return true
      }
      const rows = this.#db.openDecisions?.(20) ?? []
      await this.#channels.send(inbound.channel, chatId, formatLedger(rows), { replyTo: inbound.messageId })
      return true
    }

    // 重置高水位 → 把回撤基准的 NAV 峰值清零(下次 tick 自动以当前 NAV 重新做峰)。
    // ★Owner-only。出入金后想重置回撤基准时用。
    if (HWM_RESET_CMDS.has(command)) {
      if (!isOwner) {
        await this.#channels.send(inbound.channel, chatId, '🔒 仅主人本人可重置回撤基准。', { replyTo: inbound.messageId })
        return true
      }
      this.#db.setKv?.('nav_hwm', '0') // 0 → 下个 tick nav>0 即棘轮回当前 NAV
      await this.#channels.send(inbound.channel, chatId, '🔄 回撤基准已重置，下次刷新会以当前组合市值为新高点。', { replyTo: inbound.messageId })
      return true
    }
    return false
  }

  /** Passive module match (e.g. paper). Returns true if a module handled it. */
  async #tryModule(inbound: InboundMsg): Promise<boolean> {
    const mod = this.#modules.find(m => m.match?.(inbound) ?? false)
    if (!mod) return false
    await mod.handle({
      trigger: { kind: 'message', payload: inbound },
      channels: this.#channels,
      agent: this.#agent,
      db: this.#db,
      memory: this.#memory,
      safety: this.#safety,
    })
    return true
  }

  /** L0 quote fast path — shells out to futu/yfinance directly, no agent. */
  async #handleQuote(inbound: InboundMsg, symbols: string[]): Promise<void> {
    const chatId = inbound.chatId
    const quoteText = await this.#quoteFetcher(symbols)
    const stateForQuoteAudit = this.#memory.loadPortfolioState()
    const quoteAuditHeader = JSON.stringify({ src: 'quote', tier: 'L0', portfolio_as_of: stateForQuoteAudit?.as_of ?? null, event_key: null })
    this.#db.audit({ channel: inbound.channel, chatId, user: inbound.user, kind: 'in', payload: `${quoteAuditHeader}\n${inbound.content}` })
    this.#db.audit({ channel: inbound.channel, chatId, user: inbound.user, kind: 'out', payload: `${quoteAuditHeader}\n${quoteText}` })
    await this.#channels.send(inbound.channel, chatId, quoteText, { replyTo: inbound.messageId })
  }

  /** Assemble the agent prompt: [now] [privacy-guard?] [context] [recall?] [guardrail?] --- [user].
   *  ★隐私隔离:持仓画像/记忆/护栏只对主人本人注入;他人完全不注入。
   *  P0 省额度:持仓上下文只在会话首轮注入(resume 带走),省 token + 利缓存。
   *  Phase 1: haiku tier 永不注入 buildContext(闲聊不需要持仓画像)。 */
  async #buildPrompt(inbound: InboundMsg, isOwner: boolean, prior: string | undefined, tier: Tier): Promise<string> {
    // haiku = 闲聊/问候,不需要持仓画像,永不注入 buildContext。
    const ctxPrefix = isOwner && !prior && tier !== 'haiku' ? this.#memory.buildContext() : ''
    const guardrailInstruction = isOwner ? guardrailDetect(inbound.content) : null
    const recalled = isOwner ? recallMemories(inbound.content) : []
    // 知识层语义召回:只对主人 + 分析档(sonnet/opus,闲聊 haiku 跳过省 sidecar 调用)。
    // 弱依赖:sidecar 挂了返回 [] 不阻塞。
    const kb = isOwner && tier !== 'haiku' ? await kbSearch(inbound.content) : []
    const userLine = `[${inbound.user} @ ${inbound.ts}] ${inbound.content}`

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
    const kbBlock = formatRecall(kb)
    if (kbBlock) parts.push(kbBlock)
    if (guardrailInstruction) parts.push(guardrailInstruction)
    return `${parts.join('\n\n')}\n\n---\n\n${userLine}`
  }

  /** Full agent conversation: prompt build → placeholder/streaming → agent.run →
   *  error handling → decision ledger + outbox → deliver (edit/chunk/send). */
  async #runConversation(inbound: InboundMsg, isOwner: boolean, tier: Tier, model: string, degraded = false): Promise<void> {
    const chatId = inbound.chatId
    const prior = this.#db.getSession(inbound.channel, chatId)?.sdkSessionId
    const prompt = await this.#buildPrompt(inbound, isOwner, prior, tier)

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

    // Tier-aware placeholder sets the right wait expectation up front.
    const placeholderText =
      tier === 'opus' ? '🔬 深度分析中（跑 skill + 真实持仓，约 30–90 秒）…'
      : tier === 'haiku' ? '💬 稍等…'
      : '🔍 正在看…'

    try {
      placeholderId = await this.#channels.send(
        inbound.channel,
        chatId,
        placeholderText,
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

      // Phase 1: 按 tier 注入不同 MCP 白名单(省工具定义 token)。
      // haiku=闲聊:零 MCP,最省。sonnet=分析:tavily。opus=深度:tavily+alpaca。
      const mcpAllow: readonly string[] =
        tier === 'haiku' ? [] :
        tier === 'sonnet' ? ['tavily'] :
        /* opus */ ['tavily', 'alpaca']

      const result = await this.#agent.run({
        prompt,
        resume: prior,
        model,
        onText: streamOnText,
        approver,
        blockAccount: !isOwner, // 非本人:禁查账户/持仓工具
        mcpAllow,
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
    // ★所有主人专属的写入(决策台账 + 知识库自动入库)统一收在这一个 isOwner 闸下,
    //  防未来编辑让两处 owner 检查 desync 而泄露他人内容。
    const { clean, decisions } = extractDecisions(text || '(no response)')
    if (isOwner) {
      for (const d of decisions) {
        recordDecision({ channel: inbound.channel, chatId, symbol: d.symbol, direction: d.direction, rationale: d.rationale, confidence: d.confidence })
      }

      // 知识层自动入库:把主人在分析档(sonnet/opus)产出的实质分析沉淀为可召回资产,
      // 让知识库从真实使用里被动生长(不靠 agent 自觉跑 kb-ingest)。弱依赖,fire-and-forget。
      const body = clean.trim()
      const symbols = extractSymbols(`${inbound.content} ${body}`)
      // 只沉淀:分析档(非闲聊 haiku) + 够长 + 带标的(滤掉查行情/无标的杂问)。
      if (tier !== 'haiku' && body.length >= 400 && symbols.length > 0) {
        const date = new Date().toISOString().slice(0, 10)
        void kbIngest({
          kind: 'analysis',
          ticker: symbols[0],
          title: `对话分析 ${symbols.slice(0, 3).join('/')} ${date}`,
          source_path: `chat:${inbound.channel}:${chatId}:${turnStart}`,
          body,
          meta: { tier, model, symbols, source: 'conversation' },
        })
      }
    }
    const rawText = clean || '(no response)'
    // Apply disclaimer post-processing; append degrade notice when model was downgraded.
    const withDegrade = degraded ? `${rawText}\n\n_(省额度模式：已用更轻量模型)_` : rawText
    const finalText = maybeAppendDisclaimer(withDegrade)

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
