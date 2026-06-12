/**
 * ops/cost-report.ts — 成本周报(纯 db,不起 agent,零额度)。
 * 每周一汇总上周各模型 用量/成本/缓存命中 → 推 Discord。
 */

import type { Module, ModuleContext } from '../module.js'
import { buildEmbed } from '../../core/embed.js'
import { REPORT_DM, COST_REPORT_CRON } from '../../config.js'

function fmtTok(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`
  return String(n)
}

const costReport: Module = {
  name: 'ops:cost-report',
  cron: COST_REPORT_CRON,
  targetChat: REPORT_DM,

  async handle(ctx: ModuleContext): Promise<void> {
    if (ctx.trigger.kind !== 'cron') return
    const rows = ctx.db.getUsageSummary?.(7) ?? []
    if (rows.length === 0) {
      await ctx.channels.send('discord', REPORT_DM, '📊 **成本周报** · 过去 7 天无 agent 调用记录。', {})
      return
    }
    const total = rows.reduce((s, r) => s + r.cost, 0)
    const calls = rows.reduce((s, r) => s + r.calls, 0)
    const cacheRead = rows.reduce((s, r) => s + r.cacheRead, 0)
    const embed = buildEmbed('neutral', {
      title: '📊 成本周报（过去 7 天）',
      description: `总花费 **$${total.toFixed(2)}** · ${calls} 次调用 · 缓存命中 ${fmtTok(cacheRead)} tok`,
      fields: rows.map(r => ({
        name: r.model,
        value: `$${r.cost.toFixed(2)} · ${r.calls}次 · in ${fmtTok(r.inTok)} / out ${fmtTok(r.outTok)}`,
        inline: true,
      })),
      footer: '省额度:闲聊→Haiku · 行情→L0直连(不计token) · 上下文每会话只注一次',
    })
    await ctx.channels.send('discord', REPORT_DM, '', { embed })
  },
}

export const costReportModules: Module[] = [costReport]
