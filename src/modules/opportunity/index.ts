/**
 * opportunity/index.ts — 机会引擎(进攻自动化)。
 *
 * 之前的自动层全是防守(止损/集中度/论点 decay)。这个 cron 作业匹配"帮主人
 * 赚钱"的使命:每个交易日主动扫描赚钱机会(用 research/screener/market-pulse/
 * sector/news 等 skill + 真实持仓),把值得出手的机会推给主人。
 *
 * 信号不噪音:没有清晰机会就直说"今日无明确机会 + 在盯什么",不硬凑。
 */

import type { Module, ModuleContext } from '../module.js'
import { nowLine } from '../../core/memory.js'
import { kbIngest } from '../../core/knowledge.js'
import { extractSymbols } from '../../core/symbol.js'
import { REPORT_DM, OPPORTUNITY_CRON } from '../../config.js'
import { modelFor } from '../../core/models.js'

const OPP_PROMPT = [
  '【每日机会扫描 — 主动找赚钱机会(进攻为主)】请执行:',
  '',
  '1. 用 `market-pulse`(MHS)快速定调:当前 risk-on 还是 risk-off?适合进攻还是防守?',
  '2. 用 `news-bridge` 读 news 平台实时 feed(零额度、最快,优先看这个):',
  '   - `feed.py breaking --tickers <持仓代码,逗号分隔>` 看与持仓直接相关的突发催化(已带中文译文+利好/利空简评)。',
  '   - `feed.py 13f` 看名基金(Coatue/Druckenmiller/Burry…)13F 增减仓 = 聪明钱信号。',
  '   - 交叉验证: `insider-tracker X`(内部人) · `short-interest X`(做空拥挤)。',
  '3. 用 `research`(Systematic / Scenarios 模式)+ `stock-screener` + `sector-analyst` 扫:',
  '   - 主人持仓(NVDA/AVGO/MRVL/腾讯/药明等)有无加仓/兑现机会(技术位、催化剂、估值)?',
  '   - 半导体/AI/港股等主人能力圈内,有无新的不对称机会?',
  '   - 近期催化剂(财报/Fed/产品/政策)带来的事件性机会?(用 `event-calendar` + `news-dashboard`)',
  '4. 对每个机会给:**标的 / 方向 / 预期空间 / 关键催化 / 进场信号或区间 / 建议仓位 / 风险报酬比**。',
  '',
  '输出要求:',
  '- **结论先行**,只列 1-3 个**最值得出手**的机会(宁缺毋滥)。',
  '- 每个机会标"现在就可以"还是"等 X 信号触发"。',
  '- **如果今天没有清晰机会,就一句话说"今日无明确机会,继续观察 X/Y",别硬凑。**',
  '- 风控一句带过(护栏不是主题)。AI 绝不下单,给参数让主人手动执行。',
].join('\n')

const opportunityScan: Module = {
  name: 'opportunity:scan',
  cron: OPPORTUNITY_CRON,
  targetChat: REPORT_DM,

  async handle(ctx: ModuleContext): Promise<void> {
    if (ctx.trigger.kind !== 'cron') return

    const ctxPrefix = ctx.memory.buildContext()
    const prompt = `${nowLine()}\n${ctxPrefix}\n\n---\n\n${OPP_PROMPT}`

    // 机会扫描每次全新 session — 不 resume 也不 putSession。
    // REPORT_DM 同时是主人日常对话 DM，resume 会污染主人的对话上下文。
    let text = ''
    try {
      const r = await ctx.agent.run({ prompt, model: modelFor('sonnet') })
      text = r.text
    } catch (err) {
      await ctx.channels.send('discord', REPORT_DM, `⚠️ 机会扫描出错：${err}`, {})
      return
    }
    if (text) await ctx.channels.send('discord', REPORT_DM, text, {})

    // 入知识库(kind=opportunity):每日机会扫描沉淀为可召回资产,日后研究能调出
    // "我什么时候盯过这个机会、当时的逻辑/触发条件"。只在有实质内容时入库。弱依赖。
    if (text && text.trim().length >= 300) {
      const date = new Date().toISOString().slice(0, 10)
      const symbols = extractSymbols(text)
      void kbIngest({
        kind: 'opportunity',
        ticker: symbols[0],
        title: `每日机会扫描 ${date}`,
        source_path: `opportunity:${date}`,
        body: text,
        meta: { date, symbols },
      })
    }
  },
}

export const opportunityModules: Module[] = [opportunityScan]
