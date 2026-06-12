import type { InboundMsg, SendOpts } from '../channels/channel.js'
import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk'

export interface ChannelRegistry {
  send(channel: string, chatId: string, text: string, opts?: SendOpts): Promise<string>
  edit(channel: string, chatId: string, msgId: string, text: string): Promise<void>
  sendTyping(channel: string, chatId: string): Promise<void>
}

// ── Event / Trigger types ─────────────────────────────────────────────────────

/** M6 event classification. */
export type EventType = 'anomaly' | 'stop_hit' | 'regime_shift' | 'thesis_decay' | 'concentration_breach'

/** Structured payload emitted by a Detector. */
export interface EventPayload {
  event: EventType
  /** Stable dedup key, e.g. "stop_hit:US.AVGO" */
  key: string
  /** Human-readable one-liner shown in alert. */
  summary: string
  data?: unknown
}

/** Context passed to Detector.detect(). */
export interface DetectCtx {
  memory: Memory
}

/** Stateless, synchronous portfolio-state watcher. */
export interface Detector {
  name: string
  event: EventType
  detect(ctx: DetectCtx): EventPayload[]
}

/** Discriminated union for what caused a module to run. */
export type Trigger =
  | { kind: 'message'; payload: InboundMsg }
  | { kind: 'cron'; job: string }
  | { kind: 'event'; event: EventType; payload: EventPayload }

// ── Portfolio state types (see D in Batch A spec) ─────────────────────────────

export interface Position {
  code: string
  name: string
  source: string
  qty: number
  avg_cost: number
  price: number
  mv_usd: number
  pl_pct: number
  canon: string
  is_option: boolean
  underlying: string | null
  weight_pct: number
  thesis: string | null
  conviction_score: number | null
  thesis_verdict: string | null
  stop_loss: number | null
}

export interface ReconcileFlag {
  type: string
  ticker: string
  severity: 'low' | 'medium' | 'high'
  detail: string
}

export interface PortfolioState {
  as_of: string
  nav_usd: number
  cash_usd: number
  cash_pct: number
  ibkr_stale: boolean
  positions: Position[]
  reconcile_flags?: ReconcileFlag[]
}

// ── Service interfaces (concrete classes in later batches) ────────────────────

/** Thin wrapper around the Claude Agent SDK `query` loop. */
export interface AgentRunner {
  run(opts: {
    prompt: string
    resume?: string
    cwd?: string
    model?: string
    onText?: (t: string) => void
    /** Optional human-in-the-loop approver for ASK-listed tool calls. */
    approver?: (toolName: string, input: Record<string, unknown>) => Promise<boolean>
    /** Reasoning effort level (省额度: low for chat, high for deep analysis). */
    effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
    /** Override settingSources (e.g. add 'user' for IBKR-connector refresh). */
    settingSources?: ('user' | 'project' | 'local')[]
    /** 非本人 → 禁查主人账户/持仓工具(隐私隔离)。 */
    blockAccount?: boolean
  }): Promise<{ sessionId?: string; text: string }>
}

/**
 * Safety gate for tool calls.
 * `canUseTool` signature matches the SDK's `CanUseTool` type exactly.
 */
export interface Safety {
  canUseTool: CanUseTool
}

/** Lightweight memory / context layer. */
export interface Memory {
  loadPortfolioState(): PortfolioState | null
  riskProfile(): string
  buildContext(): string
}

/** Minimal SQLite persistence interface (bun:sqlite backed in Batch C). */
export interface DB {
  getSession(
    channel: string,
    chatId: string,
  ): { sdkSessionId?: string; model?: string; cwd?: string } | null

  putSession(
    channel: string,
    chatId: string,
    data: { sdkSessionId: string; model?: string; cwd?: string },
  ): void

  audit(row: {
    channel: string
    chatId: string
    user?: string
    kind: 'in' | 'out' | 'tool' | 'error'
    payload: string
  }): void

  getJob(name: string): { cron: string; targetChat: string; lastRun: number | null; lastStatus: string | null } | null
  upsertJob(job: { name: string; cron: string; targetChat: string }): void
  markJobRun(name: string, status: string): void

  /** Returns the last-fired timestamp (ms) for the given alert key, or null. */
  getCooldown(key: string): number | null
  /** Stores the last-fired timestamp for an alert key. */
  setCooldown(key: string, ts: number): void
  /** Decision ledger: open recommendations for reflection to score. */
  openDecisions?(limit?: number): Array<{ id: number; ts: number; symbol: string; direction: string | null; rationale: string | null }>
  /** Record an explicit trade recommendation. */
  recordDecision?(d: { channel?: string; chatId?: string; symbol: string; direction?: string; rationale?: string }): void
  /** Per-model usage summary over last N days (weekly cost report). */
  getUsageSummary?(days: number): Array<{ model: string; calls: number; cost: number; inTok: number; outTok: number; cacheRead: number }>
}

// ── Module context / interface ────────────────────────────────────────────────

export interface ModuleContext {
  trigger: Trigger
  channels: ChannelRegistry
  agent: AgentRunner
  db: DB
  memory: Memory
  safety: Safety
}

export interface Module {
  name: string
  cron?: string
  /** Chat that this module writes to (e.g. REPORT_DM).
   *  When set, runCron uses this as the queue key so cron jobs are serialised
   *  with any live conversation in the same chat (prevents session resume race). */
  targetChat?: string
  events?: EventType[]
  match?(m: InboundMsg): boolean
  handle(ctx: ModuleContext): Promise<void>
}
