/**
 * portfolio-refresh/index.ts — 窄持仓刷新作业（Phase 3 独立 / 补 IBKR）。
 *
 * 主对话 agent 已去 'user' 源(精简、无 IBKR 连接器)。但持仓数据需要 IBKR。
 * 这个 cron 作业是唯一用 'user' 源的 agent 调用 —— 只为够到 claude.ai 的 IBKR
 * 连接器,把 IBKR 持仓写进 ibkr_positions.json,再跑 L1 的 portfolio_state.py
 * 合并 futu+IBKR 重建 portfolio_state.json。主 agent 保持精简,持仓数据保持新鲜。
 *
 * 机械作业:low effort、silent(不推聊天)、只读不下单。
 */

import type { Module, ModuleContext } from '../module.js'
import { nowLine } from '../../core/memory.js'
import { REPORT_DM, REFRESH_CRON, IBKR_POSITIONS_FILE, PORTFOLIO_STATE_GEN } from '../../config.js'

const REFRESH_PROMPT = [
  '【后台持仓刷新 · 只读不下单 · 机械执行,不分析不寒暄】',
  '1. 用 Interactive Brokers (IBKR) 连接器查小号真实持仓(get_account_positions)+ 账户余额。',
  `2. 把结果写成 JSON 到 ${IBKR_POSITIONS_FILE},严格用这个 schema:`,
  '   {"_source":"ibkr-mcp","as_of":"<今天YYYY-MM-DD>","stale":false,',
  '    "positions":[{"ticker":"NOK","qty":100,"average_cost":17.2,"price":14.09,"currency":"USD"}]}',
  '   每个持仓必须含 ticker / qty / average_cost / price(数字)。无持仓则 positions:[]。',
  `3. 然后执行:python3 ${PORTFOLIO_STATE_GEN} --quiet`,
  '   (它拉 futu + 合并你刚写的 IBKR 文件 → 重建 portfolio_state.json)。',
  '4. 完成只回一句"✅ 持仓已刷新"。AI 绝不下单/改单。',
].join('\n')

const portfolioRefresh: Module = {
  name: 'portfolio:refresh',
  cron: REFRESH_CRON,
  targetChat: REPORT_DM,

  async handle(ctx: ModuleContext): Promise<void> {
    if (ctx.trigger.kind !== 'cron') return
    try {
      await ctx.agent.run({
        prompt: `${nowLine()}\n${REFRESH_PROMPT}`,
        // ★ 唯一用 'user' 的调用 —— 为够到 claude.ai 的 IBKR 托管连接器。
        settingSources: ['user', 'project', 'local'],
        effort: 'low', // 机械活,少想省额度
      })
    } catch (err) {
      process.stderr.write(`nimbus: portfolio refresh error: ${err}\n`)
    }
    // 静默:不推聊天,仅刷新数据。
  },
}

export const portfolioRefreshModules: Module[] = [portfolioRefresh]
