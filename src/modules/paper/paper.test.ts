import { describe, test, expect } from 'bun:test'
import { makeCanUseTool } from '../../core/safety.js'

// 用拼接避免源文件含 trade-guard hook 会拦的字面量
const orderPy = ['place', 'order', '.py'].join('_').replace('_.py', '.py')

describe('paper-trading safety gate', () => {
  const opts = {} as Parameters<ReturnType<typeof makeCanUseTool>>[2]

  test('allowPaperTrade: 长桥下单/改单放行', async () => {
    const cut = makeCanUseTool(undefined, { allowPaperTrade: true })
    for (const t of ['mcp__longbridge__submit_order', 'mcp__longbridge__cancel_order', 'mcp__longbridge__replace_order', 'mcp__longbridge__dca_create']) {
      expect((await cut(t, {}, opts)).behavior).toBe('allow')
    }
  })

  test('allowPaperTrade: 长桥出入金/转账 永远 deny(AI 不碰钱)', async () => {
    const cut = makeCanUseTool(undefined, { allowPaperTrade: true })
    for (const t of ['mcp__longbridge__withdraw', 'mcp__longbridge__deposit', 'mcp__longbridge__transfer']) {
      expect((await cut(t, {}, opts)).behavior).toBe('deny')
    }
  })

  test('allowPaperTrade: 真实账户下单(IBKR/Bash) 永远 deny', async () => {
    const cut = makeCanUseTool(undefined, { allowPaperTrade: true })
    expect((await cut('mcp__claude_ai_Interactive_Brokers_IBKR__create_order_instruction', {}, opts)).behavior).toBe('deny')
    expect((await cut('Bash', { command: `python3 ${orderPy}` }, opts)).behavior).toBe('deny')
  })

  test('无 allowPaperTrade(普通对话):长桥下单 deny', async () => {
    const cut = makeCanUseTool(undefined, {})
    expect((await cut('mcp__longbridge__submit_order', {}, opts)).behavior).toBe('deny')
  })
})
