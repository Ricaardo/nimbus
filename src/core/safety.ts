/**
 * safety.ts — SDK-level trade guard (second line of defence).
 *
 * Layer 1 (process-level):  settings.local.json trade-guard PreToolUse hook
 *   (~/.claude/hooks/trade-guard.sh) + IBKR permissions.deny — loaded via the
 *   'local' settings source in agent.ts.
 * Layer 2 (SDK-level, here): canUseTool callback — covers MCP order tools that
 *   the hook cannot see and any Bash calls that slip through.
 *
 * Regex logic is a verbatim JS port of the PATTERN in trade-guard.sh.
 */

import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk'
import type { Safety } from '../modules/module.js'

// ── Trade-command regex (port of trade-guard.sh PATTERN) ─────────────────────
//
// Original bash (ERE, case-insensitive):
//   (place_order|modify_order|cancel_order|submit_order|create_order|send_order)\.py
//   |(^|[^[:alnum:]_])hl[[:space:]]+(order|buy|sell|cancel|close|market|limit|trade|long|short|twap)
//   |polymarket.*(--buy|--sell|place|trade|order)
//   |(^|/)(buy|sell)\.py
//
// JS equivalences:  [[:alnum:]] → [A-Za-z0-9]   [[:space:]] → [ \t]

export const TRADE_CMD_RE = new RegExp(
  '(place_order|modify_order|cancel_order|submit_order|create_order|send_order)\\.py' +
  '|(^|[^A-Za-z0-9_])hl[ \\t]+(order|buy|sell|cancel|close|market|limit|trade|long|short|twap)' +
  '|polymarket.*(--buy|--sell|place|trade|order)' +
  '|(^|/)(buy|sell)\\.py',
  'i',
)

// ── MCP order-tool deny list ──────────────────────────────────────────────────

/** Exact tool names that must always be denied (IBKR). */
const MCP_DENY_EXACT = new Set([
  'mcp__claude_ai_Interactive_Brokers_IBKR__create_order_instruction',
  'mcp__claude_ai_Interactive_Brokers_IBKR__delete_order_instruction',
])

/**
 * Read-only tool-name prefixes that are safe to allow even when the full name
 * contains an incidental trading-verb substring (e.g. "get_account_positions"
 * contains "position", "get_account_trades" contains "trade").
 *
 * Strategy: for any mcp__* tool, first check these safe prefixes; if matched,
 * allow immediately.  Only if no prefix matches do we apply MCP_TRADING_VERB_RE.
 * This gives "default deny on trading verbs, explicit allow for read-only" —
 * safer than the reverse.
 */
const MCP_READONLY_PREFIXES = [
  // Common read-only action words that appear as the first segment after __
  'get_',
  'list_',
  'fetch_',
  'search_',
  'quote',
  'snapshot',
  'bars',
  'summary',
  'balances',
  'history',
] as const

/**
 * Extracts the "action segment" of an mcp__ tool name — the part after the
 * last __ separator, lower-cased.  This is the verb-bearing portion we test
 * against trading verbs, so that a tool like
 *   mcp__broker__get_account_positions
 * is evaluated as "get_account_positions" (safe prefix "get_") rather than
 * matching "position" deep in the middle of the full name.
 */
function mcpActionSegment(toolName: string): string {
  const parts = toolName.split('__')
  return (parts[parts.length - 1] ?? toolName).toLowerCase()
}

/**
 * Trading-verb regex applied to the action segment of mcp__* tools.
 * Covers: order operations, buy/sell/long/short/close, execute, bet, trade.
 * Named existing tools also caught explicitly by MCP_DENY_EXACT above, but
 * this regex provides broad defence against new MCP integrations.
 */
const MCP_TRADING_VERB_RE = new RegExp(
  // 交易/改单/出金动作动词。注意:不含 'position'/'trade' 这类**查询**名词
  // (stock_positions / trades / trade_stats 是只读账户/历史查询,由 isAccountTool
  // 按身份管,不该当交易拦)。下单动作靠 order/submit/buy/sell/dca 等覆盖。
  '(order|buy|sell|long|short|close|execute|bet|trader' +
  '|submit|dca|withdraw|deposit|transfer|amend|replace)' +
  '|polymarket.*run-autonomous-trader' +
  '|alpaca.*(place|create).*order',
  'i',
)

/**
 * Legacy catch-all for non-mcp__ tool names that contain order-mutation verbs
 * (e.g. stand-alone "polymarket_run-autonomous-trader").
 */
const MCP_DENY_RE = new RegExp(
  '(place|create|submit|modify|cancel|delete|send)_order' +
  '|polymarket.*run-autonomous-trader' +
  '|alpaca.*(place|create).*order',
  'i',
)

const DENY_MSG = '⛔ AI 下单权限已被主人完全关闭。任何下单/改单/撤单一律拒绝。如需交易，请主人本人在终端用 ! 前缀手动操作，或先让我恢复护栏。'

// ── Trade deny check (hard, never asks) ───────────────────────────────────────

/** True if the tool call is a trade/order operation that must be hard-denied. */
export function isTradeDenied(toolName: string, input: Record<string, unknown>): boolean {
  // 1. Exact-name MCP order tools (IBKR).
  if (MCP_DENY_EXACT.has(toolName)) return true
  // 2. mcp__* tools: trading verb on action segment unless a read-only prefix.
  if (toolName.startsWith('mcp__')) {
    const action = mcpActionSegment(toolName)
    const isReadOnly = MCP_READONLY_PREFIXES.some(prefix => action.startsWith(prefix))
    if (!isReadOnly && MCP_TRADING_VERB_RE.test(action)) return true
  }
  // 3. Legacy non-mcp order-verb tool names.
  if (MCP_DENY_RE.test(toolName)) return true
  // 4. Bash trade commands.
  if (toolName === 'Bash' || toolName === 'bash') {
    const command = typeof input['command'] === 'string' ? (input['command'] as string) : ''
    if (TRADE_CMD_RE.test(command)) return true
  }
  return false
}

// ── Approval-required (ASK) check ─────────────────────────────────────────────
// Non-trade operations with real external/destructive effect → ask the user
// (via Discord) before allowing. Trades are NEVER asked — they are hard-denied.

/** Tool names that need approval (outward-facing publish / send). */
export const ASK_TOOL_NAME_RE =
  /(publish|create_post|post_to|send_email|create_draft|sendmail|send_message|binance|square)/i

/** Bash commands that need approval (destructive / outward / config-mutating). */
export const ASK_BASH_RE =
  /(\brm\s+-[a-z]*[rf]|\bgit\s+push\b|>\s*[^|>]*\.env\b|\blaunchctl\s+(bootout|bootstrap)\b|\bkill\s+-9\b)/i

/** True if the tool call should be routed to the user for approval. */
export function needsApproval(toolName: string, input: Record<string, unknown>): boolean {
  if (ASK_TOOL_NAME_RE.test(toolName)) return true
  if (toolName === 'Bash' || toolName === 'bash') {
    const command = typeof input['command'] === 'string' ? (input['command'] as string) : ''
    if (ASK_BASH_RE.test(command)) return true
  }
  return false
}

/** Async approver: returns true to allow, false to deny. */
export type Approver = (toolName: string, input: Record<string, unknown>) => Promise<boolean>

// ── Account/holdings tools (隐私:非本人禁查) ──────────────────────────────────
// Matches portfolio/account/balance/positions queries across futu/longbridge/
// IBKR/alpaca. These leak the master's real holdings/cash → denied for非本人.
export const ACCOUNT_TOOL_RE =
  /(portfolio|all_portfolios|account_positions|stock_positions|account_balance|get_account|holdings|balances?|cash_flow|fund_positions|net_asset|positions)\b/i
/** Bash commands that pull real account data (futu/IBKR scripts). */
export const ACCOUNT_BASH_RE =
  /(get_all_portfolios|portfolio_state|account_positions|get_account|ibkr_positions)/i

/** True if a tool call reads the master's private account/holdings data. */
export function isAccountTool(toolName: string, input: Record<string, unknown>): boolean {
  if (ACCOUNT_TOOL_RE.test(toolName)) return true
  if (toolName === 'Bash' || toolName === 'bash') {
    const cmd = typeof input['command'] === 'string' ? (input['command'] as string) : ''
    if (ACCOUNT_BASH_RE.test(cmd)) return true
  }
  return false
}

// ── canUseTool factory ────────────────────────────────────────────────────────
//
// Three outcomes:
//   • trade → hard deny (never asks)
//   • ASK op + approver wired → ask the user (Discord), allow/deny on their reply
//   • everything else → allow
// When no approver is provided (tests / direct use), ASK ops fall through to
// allow — preserving the original behaviour; protection engages once wired.

export function makeCanUseTool(approver?: Approver, opts?: { blockAccount?: boolean }): CanUseTool {
  return async (toolName, input, _options) => {
    const inp = (input ?? {}) as Record<string, unknown>
    if (isTradeDenied(toolName, inp)) {
      return { behavior: 'deny', message: DENY_MSG }
    }
    // 非本人提问 → 禁查主人的账户/持仓数据(隐私隔离)。
    if (opts?.blockAccount && isAccountTool(toolName, inp)) {
      return { behavior: 'deny', message: '🔒 此操作涉及主人的私密账户/持仓数据,仅主人本人可查。' }
    }
    if (approver && needsApproval(toolName, inp)) {
      const ok = await approver(toolName, inp)
      return ok
        ? { behavior: 'allow', updatedInput: inp }
        : { behavior: 'deny', message: '❌ 操作未获主人批准（已在 Discord 拒绝或超时）。' }
    }
    // The SDK's runtime schema for an "allow" result requires updatedInput
    // (echo the input back unchanged) — omitting it triggers a ZodError on
    // every tool call.
    return { behavior: 'allow', updatedInput: inp }
  }
}

/** Default canUseTool (no approver) — used by tests and as a fallback. */
export const canUseTool: CanUseTool = makeCanUseTool()

// ── Safety object implementing the module interface ───────────────────────────

export const safety: Safety = { canUseTool }
