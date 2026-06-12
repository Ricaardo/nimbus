import { describe, test, expect } from 'bun:test'
import { canUseTool, TRADE_CMD_RE } from './safety.js'

// Minimal AbortSignal-compatible stub for the options param
const fakeOptions = {
  signal: { aborted: false } as AbortSignal,
  toolUseID: 'test-id',
}

// ── TRADE_CMD_RE unit tests (regex in isolation) ──────────────────────────────

describe('TRADE_CMD_RE', () => {
  const deny = [
    'python3 place_order.py --qty 10',
    'modify_order.py',
    'cancel_order.py --id 123',
    'submit_order.py',
    'create_order.py',
    'send_order.py',
    'hl buy BTC',
    'hl sell ETH',
    'hl order limit',
    'hl cancel 123',
    'hl close all',
    'hl market buy',
    'hl trade BTC',
    'hl long BTC',
    'hl short ETH',
    'hl twap BTC',
    'polymarket --buy YES',
    'polymarket --sell NO',
    'polymarket place bet',
    'polymarket trade event',
    'polymarket order submit',
    '/buy.py',
    '/sell.py',
    'buy.py',
    'sell.py',
    './scripts/buy.py',
  ]

  const allow = [
    'python3 get_all_portfolios.py',
    'get_order_fill_list.py',
    'hl positions',
    'hl account',
    'hl info BTC',
    'ls -la',
    'cat README.md',
    'curl https://api.example.com/prices',
    'get-stock-bars NVDA',
  ]

  for (const cmd of deny) {
    test(`matches (deny): ${cmd}`, () => {
      expect(TRADE_CMD_RE.test(cmd)).toBe(true)
    })
  }

  for (const cmd of allow) {
    test(`no-match (allow): ${cmd}`, () => {
      expect(TRADE_CMD_RE.test(cmd)).toBe(false)
    })
  }
})

// ── canUseTool integration tests ──────────────────────────────────────────────

describe('canUseTool — Bash trade commands → deny', () => {
  const bashDenyCases: Array<[string, string]> = [
    ['futu place_order', 'python3 /scripts/place_order.py --qty 10'],
    ['futu modify_order', 'modify_order.py --id 1'],
    ['futu cancel_order', 'cancel_order.py'],
    ['hl buy', 'hl buy BTC 0.1'],
    ['hl sell', 'hl sell ETH 1.0'],
    ['hl trade', 'hl trade BTC'],
    ['polymarket --buy', 'polymarket --buy YES'],
    ['polymarket --sell', 'polymarket --sell NO'],
    ['buy.py', 'buy.py'],
    ['sell.py', '/scripts/sell.py'],
  ]

  for (const [label, cmd] of bashDenyCases) {
    test(`Bash "${label}" → deny`, async () => {
      const result = await canUseTool('Bash', { command: cmd }, fakeOptions)
      expect(result.behavior).toBe('deny')
      if (result.behavior === 'deny') {
        expect(result.message).toContain('⛔')
      }
    })
  }
})

describe('canUseTool — MCP order tools → deny', () => {
  const mcpDenyCases = [
    'mcp__claude_ai_Interactive_Brokers_IBKR__create_order_instruction',
    'mcp__claude_ai_Interactive_Brokers_IBKR__delete_order_instruction',
    'mcp__alpaca__place_order',
    'mcp__alpaca__create_order',
    'mcp__futu__submit_order',
    'mcp__somebroker__modify_order',
    'mcp__somebroker__cancel_order',
    'mcp__somebroker__send_order',
    'mcp__somebroker__delete_order',
    'polymarket_run-autonomous-trader',
  ]

  for (const toolName of mcpDenyCases) {
    test(`MCP tool "${toolName}" → deny`, async () => {
      const result = await canUseTool(toolName, {}, fakeOptions)
      expect(result.behavior).toBe('deny')
    })
  }
})

describe('canUseTool — read-only tools → allow', () => {
  const allowCases: Array<[string, Record<string, unknown>]> = [
    ['Bash', { command: 'ls -la' }],
    ['Bash', { command: 'python3 get_all_portfolios.py' }],
    ['Bash', { command: 'hl positions' }],
    ['Bash', { command: 'curl https://api.example.com/quote/NVDA' }],
    ['Read', { file_path: '/tmp/data.json' }],
    ['mcp__yfinance__get_stock_bars', {}],
    ['mcp__tavily__search', { query: 'NVDA earnings' }],
    ['WebSearch', { query: 'market news' }],
    ['get-stock-bars', {}],
    // N1: read-only mcp__ tools that contain incidental trading-verb substrings
    // must NOT be blocked — the read-only prefix allowlist protects them.
    ['mcp__claude_ai_Interactive_Brokers_IBKR__get_account_positions', {}],
    ['mcp__alpaca__get_account_trades', {}],
    ['mcp__futu__get_order_fill_list', {}],
    ['mcp__yfinance__get_stock_bars', {}],
    ['mcp__somebroker__list_positions', {}],
    ['mcp__somebroker__fetch_balances', {}],
    ['mcp__somebroker__get_account_summary', {}],
    ['mcp__somebroker__quote_NVDA', {}],
    ['mcp__somebroker__snapshot_market', {}],
    ['mcp__somebroker__history_orders', {}],
  ]

  for (const [toolName, input] of allowCases) {
    test(`"${toolName}" → allow`, async () => {
      const result = await canUseTool(toolName, input, fakeOptions)
      expect(result.behavior).toBe('allow')
    })
  }
})

// ── N1: mcp__ trading-verb tools → deny ───────────────────────────────────────

describe('canUseTool — N1 mcp__ trading-verb tools → deny', () => {
  const mcpTradingDenyCases = [
    // New verbs not caught by old MCP_DENY_RE
    'mcp__hyperliquid__buy',
    'mcp__hyperliquid__sell',
    'mcp__alpaca__post_order',
    'mcp__polymarket__place_bet',
    'mcp__x__execute_trade',
    'mcp__somebroker__long_position',
    'mcp__somebroker__short_BTC',
    'mcp__somebroker__close_position',
    'mcp__somebroker__run_trader',
    // Already caught by exact-list / old regex, but also verified under N1
    'mcp__claude_ai_Interactive_Brokers_IBKR__create_order_instruction',
    'mcp__claude_ai_Interactive_Brokers_IBKR__delete_order_instruction',
    'mcp__alpaca__place_order',
    'mcp__futu__submit_order',
    'mcp__somebroker__modify_order',
    'mcp__somebroker__cancel_order',
  ]

  for (const toolName of mcpTradingDenyCases) {
    test(`mcp trading tool "${toolName}" → deny`, async () => {
      const result = await canUseTool(toolName, {}, fakeOptions)
      expect(result.behavior).toBe('deny')
      if (result.behavior === 'deny') {
        expect(result.message).toContain('⛔')
      }
    })
  }
})
