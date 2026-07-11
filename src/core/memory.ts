/**
 * memory.ts — Portfolio state loader + system-context builder.
 *
 * Grounded in three memory files:
 *   feedback_user_counter_trend_pattern.md  — trading psych weaknesses
 *   feedback_use_real_positions.md          — risk profile (defer to live snapshot, not a baked-in number)
 *   feedback_trade_must_confirm.md          — AI trade ban
 */

import { readFileSync } from 'fs'
import { PORTFOLIO_STATE_PATH, LEVERAGE_BAN_UNTIL } from '../config.js'
import type { Memory, PortfolioState } from '../modules/module.js'

// ── Persistent memory store (Phase 2) — wired by main.ts to SqliteDB ──────────
// Lets the bot remember the master's preferences/lessons ACROSS sessions
// (currently the 11 CC feedback memories aren't loaded by the Agent SDK).
export interface MemoryStore {
  remember(m: { kind: string; text: string; source?: string; slug?: string }): void
  recall(query: string, limit?: number): string[]
  getPersistent(): string[]
  recordDecision(d: { channel?: string; chatId?: string; symbol: string; direction?: string; rationale?: string; confidence?: string; priceAtDecision?: number; target?: number; stop?: number }): number
  openDecisions(limit?: number): Array<{ id: number; ts: number; symbol: string; direction: string | null; rationale: string | null; confidence: string | null; price_at_decision: number | null; target: number | null; stop: number | null }>
  closeDecision(id: number, outcome: string): void
}
let store: MemoryStore | undefined
export function setMemoryStore(s: MemoryStore): void { store = s }
/** Record an explicit trade recommendation in the decision ledger (可问责). Returns the new row id (0 if no store wired). */
export function recordDecision(d: { channel?: string; chatId?: string; symbol: string; direction?: string; rationale?: string; confidence?: string; priceAtDecision?: number; target?: number; stop?: number }): number {
  return store?.recordDecision(d) ?? 0
}
/** Open decisions for the weekly reflection to score. */
export function openDecisions(limit = 30): Array<{ id: number; ts: number; symbol: string; direction: string | null; rationale: string | null; confidence: string | null; price_at_decision: number | null; target: number | null; stop: number | null }> {
  return store?.openDecisions(limit) ?? []
}
/** Resolve a ledger entry with an outcome (weekly reflection closes scored ones). */
export function closeDecision(id: number, outcome: string): void {
  store?.closeDecision(id, outcome)
}
/** Capture a lasting preference (e.g. user says "别教条" / "以后先说市场"). */
export function rememberPreference(text: string, source = 'user'): void {
  store?.remember({ kind: 'preference', text, source })
}
/** Recall decision/lesson memories relevant to the current message. */
export function recallMemories(query: string, limit = 4): string[] {
  return store?.recall(query, limit) ?? []
}
/** Generic store (used by the weekly reflection to persist learned lessons). */
export function rememberMemory(kind: string, text: string, slug?: string, source?: string): void {
  store?.remember({ kind, text, slug, source })
}

// ── Portfolio state loader ─────────────────────────────────────────────────────

export function loadPortfolioState(): PortfolioState | null {
  try {
    const raw = readFileSync(PORTFOLIO_STATE_PATH, 'utf8')
    return JSON.parse(raw) as PortfolioState
  } catch {
    return null
  }
}

// ── Current time (注入每轮,给 agent 可靠时间概念) ────────────────────────────
// agent 本身不知真实当前时间;对话只有 UTC 消息戳、cron 作业完全没时间信号。
// 注入北京时间一行 → 正确判断"今天/盘前盘后/财报日/as_of"。
export function nowLine(): string {
  const fmt = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
  return `【当前时间】${fmt.format(new Date())}（北京时间 Asia/Shanghai；美股夏令时盘中=北京21:30–次日4:00）`
}

// ── Static risk profile ───────────────────────────────────────────────────────

export function riskProfile(): string {
  return [
    '【主人画像 · 你的使命】',
    '• 使命:帮主人赚钱——主线是机会/预期回报/风险报酬比/催化剂/仓位,风控是护栏不是主题。',
    '• 主人 edge:方向判断常对,亏多在执行(入场点/工具选择/止损时机)。你要放大他的判断,给可执行方案。',
    '• 主人要的是研究后的**明确决策意见**(买/卖/观望 + 仓位 + 理由),不是骑墙两面话。敢给立场,同时标注置信度与失效条件。',
    '• 现状一律以下方【持仓摘要】实时快照为准——**别凭记忆假设满仓或某板块集中**,先看真实仓位/现金再判断有无加仓空间。',
    '• 杠杆ETF/逆势抄底/转折投降是历史执行弱点——只在主人真要做交易决策时轻提一句,平时别说教。',
    '• 唯一硬红线:AI 绝不下单(deny 硬拦),其余都是建议不是禁令。',
  ].join('\n')
}

// ── Context builder ───────────────────────────────────────────────────────────

export function buildContext(): string {
  const lines: string[] = []

  // 1. Static risk profile
  lines.push(riskProfile())
  lines.push('')

  // 1b. Learned preferences / profile facts (persistent memory, Phase 2).
  const learned = store?.getPersistent() ?? []
  if (learned.length > 0) {
    lines.push('【已学到的偏好与事实（务必遵守，主人长期给过的指引）】')
    for (const m of learned) lines.push(`• ${m}`)
    lines.push('')
  }

  // 2. Portfolio snapshot (best-effort; skip silently if unavailable)
  const state = loadPortfolioState()
  if (state) {
    // Freshness guard: the snapshot is rebuilt by the portfolio:refresh cron.
    // If as_of is old (cron failed / bot read a stale file), say so — don't let
    // Cici silently trust stale numbers. >24h ⇒ flag and tell her to re-pull.
    const ageMs = Date.now() - Date.parse(state.as_of)
    const stale = state.ibkr_stale || !(ageMs < 24 * 60 * 60 * 1000)
    lines.push(stale ? '【持仓摘要 · ⚠️可能过时,给持仓建议前先刷新真实持仓】' : '【持仓摘要】')
    // cash_pct / weight_pct / pl_pct are ALREADY percentages in portfolio_state.json
    // (e.g. cash_pct=7.62 means 7.62%) — do NOT multiply by 100.
    lines.push(`as_of=${state.as_of}  NAV=$${state.nav_usd.toLocaleString()}  cash=${state.cash_pct.toFixed(1)}%`)
    // Top 5 positions by weight
    const top = [...state.positions]
      .sort((a, b) => b.weight_pct - a.weight_pct)
      .slice(0, 5)
    for (const p of top) {
      lines.push(`  ${p.code} ${p.name}  weight=${p.weight_pct.toFixed(1)}%  pl=${p.pl_pct.toFixed(1)}%`)
    }
    lines.push('')
  }

  // 3. Behaviour rules
  lines.push('【行为规则】')

  // Leverage ban — date-aware
  const now = new Date()
  const banUntil = new Date(LEVERAGE_BAN_UNTIL)
  if (now <= banUntil) {
    lines.push(`• 杠杆 ETF（SOXL/SOXS/TQQQ/SQQQ 等）禁止建议买入，禁令至 ${LEVERAGE_BAN_UNTIL}`)
  }

  lines.push('• 逆势/抄底/接飞刀：先问"右侧确认信号是什么"，不能只因跌多就入')
  lines.push('• 卖出后立刻反向开仓 = 情绪交易，建议强制冷静 24h')
  lines.push('• AI 绝不下单。给建议时给出【标的/方向/数量/价格】，让主人本人手动执行')

  return lines.join('\n')
}

// ── Memory object implementing the module interface ───────────────────────────

export const memory: Memory = {
  loadPortfolioState,
  riskProfile,
  buildContext,
}
