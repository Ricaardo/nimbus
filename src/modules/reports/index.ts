/**
 * reports/index.ts — Scheduled daily report jobs (M5).
 *
 * Three report jobs, each is a Module with a cron? field and a handle()
 * that responds to trigger.kind === 'cron'.  The Scheduler fires them via
 * dispatcher.runCron(moduleName), which enqueues under the REPORT_DM chat.
 *
 * Prompts instruct Cici to use the appropriate skills (not inline logic).
 * Model: REPORT_MODEL (claude-opus-4-8) for depth.
 * Target channel: 'discord', chatId: REPORT_DM.
 */

import type { Module, ModuleContext } from '../module.js'
import { nowLine } from '../../core/memory.js'
import { REPORT_DM, MORNING_CRON, PREMARKET_CRON, CLOSE_CRON } from '../../config.js'
import { modelFor } from '../../core/models.js'

// ── Shared helper ─────────────────────────────────────────────────────────────

async function runReport(ctx: ModuleContext, prompt: string): Promise<void> {
  if (ctx.trigger.kind !== 'cron') return

  const ctxPrefix = ctx.memory.buildContext()
  const fullPrompt = `${nowLine()}\n${ctxPrefix}\n\n---\n\n${prompt}`

  const prior = ctx.db.getSession('discord', REPORT_DM)?.sdkSessionId

  let text = ''
  let sessionId: string | undefined
  try {
    const result = await ctx.agent.run({
      prompt: fullPrompt,
      resume: prior,
      model: modelFor('sonnet'),
    })
    text = result.text
    sessionId = result.sessionId
  } catch (err) {
    await ctx.channels.send('discord', REPORT_DM, `⚠️ 日报生成出错：${err}`, {})
    return
  }

  if (sessionId) {
    ctx.db.putSession('discord', REPORT_DM, { sdkSessionId: sessionId })
  }

  if (text) {
    await ctx.channels.send('discord', REPORT_DM, text, {})
  }
}

// ── Morning check: 08:00 CST ─────────────────────────────────────────────────

const morningReport: Module = {
  name: 'report:morning',
  cron: MORNING_CRON,
  targetChat: REPORT_DM,

  async handle(ctx: ModuleContext): Promise<void> {
    const prompt = [
      '【早间体检 — 自动日报】现在是北京时间早上8点，请依次执行：',
      '',
      '1. 调用 `market-pulse` skill（MHS 0-100评分模式）评估当前美股市场温度，给出 MHS 分数和仓位指引。',
      '2. 调用 `event-calendar` skill 列出今日及未来3天的关键财报/宏观事件，标注对主人持仓的影响等级。',
      '3. 调用 `thesis-tracker` skill 做 decay 检查：有无超过30天未更新的论点？有无价格已大幅偏离的持仓？',
      '4. 调用 `portfolio-manager` skill（拉 futu+IBKR 真实持仓）检查偏离：当前集中度 vs 目标，有无再平衡信号。',
      '',
      '输出格式：每个模块一个醒目标题，要点用 • 列出，最后一行给今日总结和行动建议（具体标的/方向/数量，不下单）。',
    ].join('\n')
    await runReport(ctx, prompt)
  },
}

// ── Pre-market: 21:00 CST (US pre-market next day) ───────────────────────────

const premarketReport: Module = {
  name: 'report:premarket',
  cron: PREMARKET_CRON,
  targetChat: REPORT_DM,

  async handle(ctx: ModuleContext): Promise<void> {
    const prompt = [
      '【盘前持仓扫描 — 自动日报】美股即将开盘，请执行盘前持仓检查：',
      '',
      '1. 调用 futu 真实持仓（`python3 ~/.claude/skills/futuapi/scripts/trade/get_all_portfolios.py --trd-env REAL`）获取最新仓位快照。',
      '2. 对每个美股持仓：用 `market-data` skill 查最新报价，核对是否触及或接近止损位。',
      '3. 用 `news-dashboard` skill（stock模式，针对主要持仓代码）拉最新消息，标注是否有催化剂。',
      '4. 调用 `event-calendar` skill 检查今日财报/Fed讲话/宏观数据发布，评估对持仓的潜在冲击。',
      '5. 给出今日盘中需关注的触发器：加仓触发 / 止损触发 / 持有不动（各持仓明确结论）。',
      '',
      '⚠️ 提醒：AI 绝不下单，所有建议仅供主人参考，主人在 futu/IBKR App 手动执行。',
    ].join('\n')
    await runReport(ctx, prompt)
  },
}

// ── Market close recap: 06:00 CST (after US close) ───────────────────────────

const closeReport: Module = {
  name: 'report:close',
  cron: CLOSE_CRON,
  targetChat: REPORT_DM,

  async handle(ctx: ModuleContext): Promise<void> {
    const prompt = [
      '【收盘复盘 — 自动日报】美股已收盘，请执行日终复盘：',
      '',
      '1. 调用 `trade-journal` skill（daily review模式）：今日有成交吗？如有，走8类错误taxonomy分析。',
      '2. 用 `market-pulse` skill 评估今日市场变化：MHS有无显著位移？板块轮动信号？',
      '3. 调用 `thesis-tracker` skill：今日价格变动是否影响现有论点的有效性？需要更新吗？',
      '4. 用 `sector-analyst` skill 做半导体板块（主人44%集中度）的日终分析：趋势强度/量能/催化剂。',
      '5. 总结：今日做对了什么 / 做错了什么 / 明日预案（止损价/加仓条件/观察标的）。',
      '',
      '复盘原则：先肯定方向判断对的地方，再拆执行（入场点/工具选择/止损时机）。',
    ].join('\n')
    await runReport(ctx, prompt)
  },
}

export const reportModules: Module[] = [morningReport, premarketReport, closeReport]
