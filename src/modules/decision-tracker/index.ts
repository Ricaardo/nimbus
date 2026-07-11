/**
 * decision-tracker/index.ts — 决策自动结算(可问责闭环)。
 *
 * 纯机械作业(不跑 agent):拉未结的决策台账,批量查一次现价,按 target/stop
 * 或(无目标/止损时)持仓天数,自动判定 win/loss/expired 并 closeDecision。
 * OpenD 挂了 / 行情拿不到 = 静默跳过,绝不误结。
 */

import type { Module, ModuleContext } from '../module.js'
import { fetchPriceMap } from '../quote/index.js'
import { toFutuCode } from '../../core/symbol.js'
import { REPORT_DM, DECISION_TRACK_CRON, DECISION_AUTO_CLOSE_DAYS } from '../../config.js'

const DAY_MS = 86_400_000
const BACKFILL_WINDOW_MS = 48 * 3600_000

export interface TrackedDecision {
  id: number
  ts: number
  symbol: string
  direction: string | null
  price_at_decision: number | null
  target: number | null
  stop: number | null
}

/** buy-ish / sell-ish / hold(默认,含未知方向 — 保守不误判)。 */
function directionKind(direction: string | null): 'buy' | 'sell' | 'hold' {
  const d = (direction ?? '').toLowerCase()
  if (/buy|add|加仓|买入/.test(d)) return 'buy'
  if (/sell|reduce|减仓|卖出|清仓/.test(d)) return 'sell'
  return 'hold'
}

/** 决策时未留价格快照、且刚建仓不久(<48h)→ 值得回填;超窗就不追溯了(意义不大)。 */
export function shouldBackfillPrice(d: { price_at_decision: number | null; ts: number }, now: number): boolean {
  return d.price_at_decision == null && (now - d.ts) < BACKFILL_WINDOW_MS
}

/** 格式化 ±X.X%(相对 price_at_decision);没有快照就返回空串(省略 pct 部分)。
 *  invert=true(sell 方向)时反号 —— 空单价格跌才是赚,数字要读成"从空头视角的盈亏"。 */
function pctFrom(base: number | null, price: number, invert = false): string {
  if (base == null || base <= 0) return ''
  const p = ((price - base) / base) * 100 * (invert ? -1 : 1)
  return ` ${p >= 0 ? '+' : ''}${p.toFixed(1)}%`
}

/**
 * 纯函数:给定一条未结决策 + 现价 + 当前时间,判定要不要自动结算。
 * 返回 null = 不动(继续挂着)。
 */
export function evaluateDecision(
  d: TrackedDecision,
  price: number,
  now: number,
  autoCloseDays: number = DECISION_AUTO_CLOSE_DAYS,
): { outcome: string } | null {
  if (!Number.isFinite(price) || price <= 0) return null
  const kind = directionKind(d.direction)
  // Asia/Shanghai (CST, UTC+8) calendar date — the 07:45 CST run is still "yesterday" in UTC.
  const dateStr = new Date(now + 8 * 3600_000).toISOString().slice(0, 10)
  const hasTarget = d.target != null && d.target > 0
  const hasStop = d.stop != null && d.stop > 0

  if (hasTarget || hasStop) {
    if (kind === 'buy') {
      if (hasTarget && price >= d.target!) return { outcome: `auto: win${pctFrom(d.price_at_decision, price)} target-hit ${dateStr}` }
      if (hasStop && price <= d.stop!) return { outcome: `auto: loss${pctFrom(d.price_at_decision, price)} stop-hit ${dateStr}` }
      return null
    }
    if (kind === 'sell') {
      if (hasTarget && price <= d.target!) return { outcome: `auto: win${pctFrom(d.price_at_decision, price, true)} target-hit ${dateStr}` }
      if (hasStop && price >= d.stop!) return { outcome: `auto: loss${pctFrom(d.price_at_decision, price, true)} stop-hit ${dateStr}` }
      return null
    }
    // hold:只看止损(下方保护位),中性措辞,不带 win/loss。
    if (hasStop && price <= d.stop!) return { outcome: `auto: stop-hit${pctFrom(d.price_at_decision, price)} ${dateStr}` }
    return null
  }

  // 无目标/止损位:按持仓天数到期自动结算(需要有决策时快照才能判定盈亏方向)。
  const ageDays = (now - d.ts) / DAY_MS
  if (ageDays > autoCloseDays && d.price_at_decision != null && d.price_at_decision > 0) {
    if (kind === 'buy') return { outcome: `auto: ${price > d.price_at_decision ? 'win' : 'loss'}${pctFrom(d.price_at_decision, price)} ${autoCloseDays}d-settle ${dateStr}` }
    if (kind === 'sell') return { outcome: `auto: ${price < d.price_at_decision ? 'win' : 'loss'}${pctFrom(d.price_at_decision, price, true)} ${autoCloseDays}d-settle ${dateStr}` }
    return { outcome: `auto: expired${pctFrom(d.price_at_decision, price)} ${autoCloseDays}d-settle ${dateStr}` }
  }

  return null
}

const decisionTracker: Module = {
  name: 'decision:track',
  cron: DECISION_TRACK_CRON,
  targetChat: REPORT_DM,

  async handle(ctx: ModuleContext): Promise<void> {
    if (ctx.trigger.kind !== 'cron') return
    try {
      const open = ctx.db.openDecisions?.(100) ?? []
      if (open.length === 0) return

      // symbol → futu code(去重后一次批量查,省行情调用)。
      const codeBySymbol = new Map<string, string>()
      for (const d of open) {
        if (codeBySymbol.has(d.symbol)) continue
        const code = toFutuCode(d.symbol)
        if (code) codeBySymbol.set(d.symbol, code)
      }
      if (codeBySymbol.size === 0) return

      const priceMap = await fetchPriceMap([...new Set(codeBySymbol.values())])
      if (priceMap.size === 0) return // OpenD 大概率不可达,静默跳过,下一轮再试

      const now = Date.now()
      const closedLines: string[] = []
      for (const d of open) {
        const code = codeBySymbol.get(d.symbol)
        if (!code) continue
        const price = priceMap.get(code)
        if (price == null || !Number.isFinite(price) || price <= 0) continue

        let priceAtDecision = d.price_at_decision
        if (shouldBackfillPrice(d, now)) {
          ctx.db.updateDecisionPrice?.(d.id, price)
          priceAtDecision = price // 本轮评估就用上,不用等下一轮
        }

        const evaluated = evaluateDecision({ ...d, price_at_decision: priceAtDecision }, price, now)
        if (evaluated) {
          ctx.db.closeDecision?.(d.id, evaluated.outcome)
          closedLines.push(`#${d.id} ${d.symbol} ${d.direction ?? '-'} → ${evaluated.outcome}`)
        }
      }

      if (closedLines.length === 0) return
      await ctx.channels.send('discord', REPORT_DM, `📒 决策自动结算 ${closedLines.length} 条:\n${closedLines.join('\n')}`, {})
    } catch (err) {
      process.stderr.write(`nimbus: decision tracker error: ${err}\n`)
    }
  },
}

export const decisionTrackerModules: Module[] = [decisionTracker]
