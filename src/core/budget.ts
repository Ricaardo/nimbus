/**
 * budget.ts — Pure, stateless budget-degrade helpers (Phase 3 硬预算闸).
 *
 * No I/O. All decisions driven by the todayCost value from db.getTodayCost().
 *
 * Three degrade levels:
 *   0 — normal: tier unchanged.
 *   1 — downgrade: opus→sonnet, sonnet→haiku, haiku→haiku, quote→quote.
 *   2 — pause deep: opus/sonnet blocked; haiku/quote pass through.
 *
 * Red-line alerts (dispatchEvent/runCron) are NEVER routed through these helpers.
 * L0 quote fast-path is also unaffected (handled before the gate in #process).
 */

import { DAILY_COST_BUDGET_USD, BUDGET_L1_RATIO, BUDGET_DEGRADE_ENABLED } from '../config.js'
import type { Tier } from './router.js'

/**
 * Compute the current degrade level from today's accumulated cost.
 *
 * @param todayCost — USD spent since local midnight (from db.getTodayCost()).
 * @returns 0 | 1 | 2
 */
export function degradeLevel(todayCost: number): 0 | 1 | 2 {
  if (!BUDGET_DEGRADE_ENABLED) return 0
  if (todayCost >= DAILY_COST_BUDGET_USD) return 2
  if (todayCost >= DAILY_COST_BUDGET_USD * BUDGET_L1_RATIO) return 1
  return 0
}

/**
 * Apply degrade level to a classified tier.
 *
 * @param tier — Original tier from router.classify().
 * @param level — Degrade level from degradeLevel().
 * @returns { tier: effective tier to use, blocked: true if the request should be short-circuited }
 */
export function applyDegrade(
  tier: Tier,
  level: 0 | 1 | 2,
): { tier: Tier; blocked: boolean } {
  if (level === 0) {
    return { tier, blocked: false }
  }

  if (level === 1) {
    // Downgrade: opus→sonnet, sonnet→haiku; haiku/quote unchanged.
    if (tier === 'opus') return { tier: 'sonnet', blocked: false }
    if (tier === 'sonnet') return { tier: 'haiku', blocked: false }
    return { tier, blocked: false }
  }

  // level === 2: pause deep analysis; haiku/quote still run.
  if (tier === 'opus' || tier === 'sonnet') {
    return { tier, blocked: true }
  }
  return { tier, blocked: false }
}
