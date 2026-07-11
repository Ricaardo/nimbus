/**
 * guardrail/index.ts — P0 behaviour guardrail for repeated trading weaknesses.
 *
 * Based on feedback_user_counter_trend_pattern.md:
 *   (1) entry too early / fading strong trends
 *   (2) using 3× daily-reset leveraged ETFs for multi-day views
 *   (3) emotional capitulation at max-pain turning points
 *   (4) immediately reversing direction after a stop-out (catching falling knives)
 *   (5) inability to hold cash
 *
 * detect(content) returns a mandatory instruction string to prepend into the
 * agent prompt when any trigger keyword is found, or null if the message is clean.
 * It is a pure function — no side effects, no module registration needed.
 */

import { LEVERAGE_BAN_UNTIL } from '../../config.js'
import { tradeEvidenceString } from './loader.js'

// Cache evidence strings in-process (re-lazied per detect call) to avoid
// repetitive YAML reads when the user sends multiple messages in one session.
let _evidenceCache = new Map<string, string | null>()

function getTickerEvidence(ticker: string): string | null {
  const key = ticker.toUpperCase()
  if (!_evidenceCache.has(key)) {
    _evidenceCache.set(key, tradeEvidenceString(key))
  }
  return _evidenceCache.get(key) ?? null
}

/** Reset per-session evidence cache (exported for testing). */
export function resetEvidenceCache(): void {
  _evidenceCache = new Map()
}

// ── Keyword groups ────────────────────────────────────────────────────────────

/** Leverage / leveraged-ETF patterns */
const LEVERAGE_PATTERNS: RegExp[] = [
  /加杠杆/,
  /杠杆\s*ETF/i,
  /\b3[xX]\b/,
  /\b2[xX]\b/,
  /\bTQQQ\b/i,
  /\bSQQQ\b/i,
  /\bSOXL\b/i,
  /\bSOXS\b/i,
  /\bUPRO\b/i,
  /\bSPXL\b/i,
  /\bSPXS\b/i,
  /\bTSLL\b/i,
  /\bNVDL\b/i,
  /\bLABU\b/i,
  /\bFAZ\b/i,
  /\bFAS\b/i,
]

/** All-in / position-size extremes */
const POSITION_PATTERNS: RegExp[] = [
  /满仓/,
  /all\s*in/i,
  /梭哈/,
]

/** Counter-trend / catching-falling-knives */
const COUNTER_TREND_PATTERNS: RegExp[] = [
  /接飞刀/,
  /抄底/,
  /越跌越买/,
  /补仓/,
  /加仓.*跌/,
  /逆势/,
  /反手/,
]

/** Capitulation / panic-exit */
const CAPITULATION_PATTERNS: RegExp[] = [
  /割肉/,
  /清仓/,
  /认输/,
  /投降/,
]

const ALL_PATTERNS: RegExp[] = [
  ...LEVERAGE_PATTERNS,
  ...POSITION_PATTERNS,
  ...COUNTER_TREND_PATTERNS,
  ...CAPITULATION_PATTERNS,
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function isLeverageMatch(content: string): boolean {
  return LEVERAGE_PATTERNS.some(p => p.test(content))
}

function isAnyMatch(content: string): boolean {
  return ALL_PATTERNS.some(p => p.test(content))
}

/** Prefixed tickers whose trade-journal data to check for leverage-trigger messages. */
const EVIDENCE_TICKERS = ['SOXL', 'SOXS', 'TQQQ', 'SQQQ', 'UPRO', 'SPXL', 'SPXS', 'TSLL', 'NVDL', 'LABU']

function formatLeverageEvidence(): string {
  const parts: string[] = []
  for (const ticker of EVIDENCE_TICKERS) {
    const ev = getTickerEvidence(ticker)
    if (ev) {
      parts.push(ev)
      break // one concrete example is enough
    }
  }
  if (parts.length > 0) {
    return parts[0] + '，被 3x 每日重置 + 持仓 decay 暴露的风险。'
  }
  return '杠杆ETF的每日重置结构叠加方向判断错误可能造成严重亏损。'
}

/**
 * Scan inbound content for known trading-weakness keywords.
 *
 * Returns a mandatory instruction string (to inject before the user message
 * in the agent prompt) when triggered, or null when the message is clean.
 *
 * The returned instruction is written in the imperative — it tells Cici what
 * to do, not the user.  It is injected into the system context, not sent as
 * a reply on its own.
 */
export function detect(content: string): string | null {
  if (!isAnyMatch(content)) return null

  const now = new Date()
  const banUntil = new Date(LEVERAGE_BAN_UNTIL)
  const leverageHit = isLeverageMatch(content)

  // Evidence-based STRONG REMINDER, not dogma. Tell Cici to weave in a brief,
  // fact-based caution sized to the situation — advise / push back, but let the
  // master decide. No imperative "禁止/必须/强制" framing, no forced checklist.
  const lines: string[] = [
    '【护栏提示 · 给 Cici 的内部提醒 — 是强提醒不是规则,自然融入,别教条】',
    '主人这条消息触发了他已知的重复弱点。请在回答里**简短、自然地**带一句**基于事实**的提醒——摆代价/数据,让主人自己判断;别长篇说教、别逐条盘问、别命令口吻。能一句话说清就不展开。',
  ]
  if (leverageHit) {
    const banNote = now <= banUntil
      ? `（他给自己定过到 ${LEVERAGE_BAN_UNTIL} 的杠杆ETF冷静期，可温和提一句）`
      : ''
    lines.push(
      `• 杠杆/杠杆ETF：历史代价是事实——${formatLeverageEvidence()}${banNote}。可顺口问一句"日内还是多日？多日的话正股或小仓更稳"。`,
    )
  }
  lines.push(
    '• 逆势/抄底/接飞刀：轻提"右侧确认信号有了吗？只因跌多还不够"。',
    '• 割肉/清仓后想反手：提醒"卖完立刻反向容易是情绪，值得缓一下"。',
    '• 若是新开仓且可能加重集中度：以实时持仓为准核对（futu/持仓摘要），确认真的已集中再点一句，别凭旧印象假设某板块占比。',
    '',
    '原则：可以建议、可以劝阻，但**最终让主人决定**。AI 不下单的硬线不在这层（那是安全契约，另有双闸）。',
  )
  return lines.join('\n')
}
