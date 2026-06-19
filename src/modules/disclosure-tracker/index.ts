/**
 * disclosure-tracker/index.ts — 披露追踪(Tier 4,研究 OS 主动追踪层)。
 *
 * 每周主动追踪持仓/观察名单的美股**财报电话会 + SEC 文件**,把口径/情绪变化与
 * 重大披露沉淀进知识库(filings-pipeline / earnings-call skill 自动 kb-ingest),
 * 让研究 OS 从"被动等你问"变"主动盯"。只追踪美股(A/H 走 longbridge/futu)。
 */

import type { Module, ModuleContext } from '../module.js'
import { nowLine } from '../../core/memory.js'
import { REPORT_DM, DISCLOSURE_CRON } from '../../config.js'
import { modelFor } from '../../core/models.js'

const PROMPT = [
  '【每周披露追踪 — 持仓/观察名单的财报 + SEC 文件(美股)】请执行:',
  '',
  '1. 用 `event-calendar`(或 OpenBB earnings 日历)查**本周哪些持仓/观察名单的美股要发财报**。',
  '2. 对**上周已发财报**的持仓名,用 `earnings-call` 跟一下管理层口径/情绪**与上季对照的变化**;',
  '   用 `filings-pipeline` 看有无新的 8-K/10-Q 重大披露(风险因子增删、重大事件)。',
  '3. 两个 skill 会自动把要点 `kb-ingest` 入知识库 — 形成季度对照链。',
  '4. 口径显著转向 / 重大披露 → 提示 `thesis-tracker` 复审对应论点。',
  '',
  '输出(结论先行,简洁):',
  '- **本周财报日历**(只列持仓/观察名单相关,标日期)。',
  '- **上周已发的关键口径变化**(每个名一句话:更乐观/更谨慎/中性 + 触发点)。',
  '- 没有相关披露就一句话"本周无持仓相关财报/披露",别硬凑。A/H 标的不在此追踪。',
].join('\n')

const disclosureTracker: Module = {
  name: 'disclosure:tracker',
  cron: DISCLOSURE_CRON,
  targetChat: REPORT_DM,

  async handle(ctx: ModuleContext): Promise<void> {
    if (ctx.trigger.kind !== 'cron') return

    const ctxPrefix = ctx.memory.buildContext()
    const prompt = `${nowLine()}\n${ctxPrefix}\n\n---\n\n${PROMPT}`

    // 全新 session(同 opportunity:不 resume,避免污染主人 DM 对话上下文)。
    let text = ''
    try {
      const r = await ctx.agent.run({ prompt, model: modelFor('sonnet') })
      text = r.text
    } catch (err) {
      process.stderr.write(`nimbus: disclosure tracker error: ${err}\n`)
      return
    }
    if (text) await ctx.channels.send('discord', REPORT_DM, text, {})
  },
}

export const disclosureTrackerModules: Module[] = [disclosureTracker]
