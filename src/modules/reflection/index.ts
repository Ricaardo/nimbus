/**
 * reflection/index.ts — 周反思(自进化闭环,Phase 2 Part 2)。
 *
 * 每周从真实交易数据(trade-journal + behavior_monitor)复盘,提炼主人的重复
 * 弱点 / 有效打法 → 存进记忆(kind=lesson)→ 反哺未来的对话上下文(recall)。
 * "越用越懂你"。安全:只学行为模式,不自动生成投资策略。
 */

import type { Module, ModuleContext } from '../module.js'
import { nowLine, rememberMemory } from '../../core/memory.js'
import { kbIngest } from '../../core/knowledge.js'
import { REPORT_DM, REFLECTION_CRON, SKILLS_ROOT } from '../../config.js'
import { modelFor } from '../../core/models.js'

const REFLECT_PROMPT = [
  '【每周反思 — 自进化,从真实数据学,只学行为不自创策略】请执行:',
  '',
  '1. 用 `trade-journal` skill(review + stats 模式)复盘本周交易:成交了吗?走 8 类错误 taxonomy。',
  '2. 可跑 `python3 ' + SKILLS_ROOT + '/trade-journal/scripts/behavior_monitor.py` 看近期行为体检(周转率/纪律破线)。',
  '3. 用 `thesis-tracker` 核对持仓论点本周有无变化/decay。',
  '4. 提炼:**本周主人做对了什么、做错了什么、重复出现的执行弱点、有效的打法**。',
  '',
  '输出两部分:',
  'A. **给主人的复盘报告**(先肯定方向判断对的地方,再拆执行)。',
  'B. 然后**单独一段**,严格用这个格式输出要长期记住的教训(每条一行,简短、可执行):',
  '===LESSONS===',
  '- <教训1>',
  '- <教训2>',
  '(没有值得记的就写"===LESSONS===" 后留空)',
  '',
  'C. 最后,对照上面【未结的建议】,把**已经有结果(兑现/止损/作废/明显走对走错)**的逐条结清,',
  '   严格用这个机器格式输出(主人看不到,用于更新决策台账);没有可结清的就留空数组:',
  '===CLOSE=== [{"id":<台账编号>,"outcome":"<一句话结果,如 兑现+12% / 止损-8% / 论点失效作废>"}]',
].join('\n')

/** 从 agent 输出里抽 ===LESSONS=== 后的 bullet 行(止于下一个 === 机器段)。 */
export function parseLessons(text: string): string[] {
  const idx = text.indexOf('===LESSONS===')
  if (idx < 0) return []
  return text
    .slice(idx + '===LESSONS==='.length)
    .split('===CLOSE===')[0]!
    .split('\n')
    .map(l => l.replace(/^[\s\-•*]+/, '').trim())
    .filter(l => l.length >= 4)
}

/** 从 agent 输出里抽 ===CLOSE=== 后的 JSON 数组 → 要结清的台账条目。
 *  容错:解析失败 / 非数组 / 缺 id → 返回 []。 */
export function parseClosures(text: string): Array<{ id: number; outcome: string }> {
  const idx = text.indexOf('===CLOSE===')
  if (idx < 0) return []
  const blob = text.slice(idx + '===CLOSE==='.length).trim()
  // 取第一个 [...] JSON 数组(后面可能跟别的文字)。
  const m = blob.match(/\[[\s\S]*?\]/)
  if (!m) return []
  try {
    const arr = JSON.parse(m[0]) as unknown
    if (!Array.isArray(arr)) return []
    const out: Array<{ id: number; outcome: string }> = []
    for (const o of arr) {
      const r = o as Record<string, unknown>
      const id = typeof r['id'] === 'number' ? r['id'] : Number(r['id'])
      if (!Number.isFinite(id)) continue
      out.push({ id, outcome: typeof r['outcome'] === 'string' ? r['outcome'] : '' })
    }
    return out
  } catch {
    return []
  }
}

const weeklyReflection: Module = {
  name: 'reflection:weekly',
  cron: REFLECTION_CRON,
  targetChat: REPORT_DM,

  async handle(ctx: ModuleContext): Promise<void> {
    if (ctx.trigger.kind !== 'cron') return

    const ctxPrefix = ctx.memory.buildContext()
    // Surface open decisions so reflection can score past recommendations.
    const open = ctx.db.openDecisions?.(30) ?? []
    const ledger = open.length > 0
      ? '\n【本周/近期未结的建议(对照结果,该兑现/止损/作废的指出来;有[置信]标注的,评一下当初置信度校准得准不准——高置信却错/低置信却对都值得记)】\n' +
        open.map(d => `  #${d.id} ${d.symbol} ${d.direction ?? ''}${d.confidence ? ` [置信:${d.confidence}]` : ''} — ${d.rationale ?? ''}`).join('\n')
      : ''
    const prompt = `${nowLine()}\n${ctxPrefix}${ledger}\n\n---\n\n${REFLECT_PROMPT}`
    const prior = ctx.db.getSession('discord', REPORT_DM)?.sdkSessionId

    let text = ''
    let sessionId: string | undefined
    try {
      const r = await ctx.agent.run({ prompt, resume: prior, model: modelFor('sonnet') })
      text = r.text
      sessionId = r.sessionId
    } catch (err) {
      process.stderr.write(`nimbus: weekly reflection error: ${err}\n`)
      return
    }
    if (sessionId) ctx.db.putSession('discord', REPORT_DM, { sdkSessionId: sessionId })

    // 存教训进记忆(去重 slug = lesson:周日期-序号),反哺未来 recall。
    const lessons = parseLessons(text)
    const wk = new Date().toISOString().slice(0, 10)
    lessons.forEach((l, i) => rememberMemory('lesson', l, `lesson:${wk}:${i}`, 'weekly-reflection'))
    // 整篇复盘入知识库(语义可召回,kind=reflection);弱依赖,失败不阻塞。
    const human = text.split('===LESSONS===')[0]!.split('===CLOSE===')[0]!.trim() || text
    void kbIngest({ kind: 'reflection', title: `周复盘 ${wk}`, source_path: `reflection:${wk}`, body: human, meta: { week: wk } })

    // 结清已有结果的台账条目(闭环问责:开了就要收尾,别让台账无限增长)。
    // 只结清本次确实在未结集合里的 id,防误关。
    const openIds = new Set(open.map(d => d.id))
    for (const c of parseClosures(text)) {
      if (openIds.has(c.id)) ctx.db.closeDecision?.(c.id, c.outcome || '已结清')
    }

    // 推人类报告(去掉 LESSONS / CLOSE 机器段;human 已在上方算好)。
    await ctx.channels.send('discord', REPORT_DM, human, {})
  },
}

export const reflectionModules: Module[] = [weeklyReflection]
