/**
 * paper/index.ts — 长桥模拟盘交易(安全版 B,Phase: paper trading)。
 *
 * ★安全模型(长桥无"模拟/真实"程序标识 → 指纹锁):
 *   1. 仅当 config.PAPER_TRADING 开(env NIMBUS_PAPER_TRADING=1,默认关)。
 *   2. 每次下单**同一流程内先验证**:agent 查 deposits + bank_cards,
 *      两者都空 = 模拟账户特征 → 通过;任一非空(=真实账户)→ 拒绝 + 告警。
 *   3. 验证通过才用 allowPaperTrade=true 的 agent.run 执行下单
 *      (safety 只放行长桥下单/改单,出金 withdraw/deposit/transfer 永远 deny)。
 *   4. futu/IBKR/hl/polymarket 真实账户下单 → 永远 deny(不受此影响)。
 *   5. 每单 Discord 通知 + 审计。
 *
 * 触发:主人对话里说"模拟盘/paper 买/卖 ..."(match)。普通对话不走这里,
 * 长桥下单在普通对话里仍被 canUseTool 永远 deny。
 */

import type { Module, ModuleContext } from '../module.js'
import type { InboundMsg } from '../../channels/channel.js'
import { modelFor } from '../../core/models.js'
import { PAPER_TRADING, REPORT_DM, OWNER_IDS } from '../../config.js'

/** 主人消息是否是模拟盘交易指令。 */
function isPaperOrder(content: string): boolean {
  return /(模拟盘|paper|纸面|模拟仓|模拟账户).*(买|卖|下单|加仓|减仓|清仓|order|buy|sell)/i.test(content)
    || /(买|卖|下单).*(模拟盘|paper)/i.test(content)
}

const VERIFY_PROMPT = [
  '【模拟盘账户验证 — 只读,不下单】请执行,只输出一行 JSON:',
  '1. 调 longbridge deposits(入金历史)+ bank_cards(提现银行卡)。',
  '2. 输出: {"deposits_count": <入金记录数>, "cards_count": <银行卡数>}',
  '只要这一行 JSON,不要别的。',
].join('\n')

function parseVerify(text: string): { ok: boolean; deposits: number; cards: number } | null {
  const m = text.match(/\{[^}]*deposits_count[^}]*\}/)
  if (!m) return null
  try {
    const o = JSON.parse(m[0]) as Record<string, unknown>
    const deposits = Number(o['deposits_count'] ?? -1)
    const cards = Number(o['cards_count'] ?? -1)
    if (deposits < 0 || cards < 0) return null
    // 模拟账户铁证:无真实入金 且 无提现银行卡。
    return { ok: deposits === 0 && cards === 0, deposits, cards }
  } catch { return null }
}

const paperTrade: Module = {
  name: 'paper:trade',
  // 仅:paper 模式开 + 本人 + 模拟盘指令。非本人不匹配 → 走默认路由 → 长桥下单 deny。
  match: (m: InboundMsg) => PAPER_TRADING && OWNER_IDS.includes(m.userId) && isPaperOrder(m.content),

  async handle(ctx: ModuleContext): Promise<void> {
    if (ctx.trigger.kind !== 'message') return
    const inbound = ctx.trigger.payload
    const reply = (t: string) => ctx.channels.send(inbound.channel, inbound.chatId, t, { replyTo: inbound.messageId })

    if (!PAPER_TRADING) { await reply('🔒 模拟盘交易未开启(NIMBUS_PAPER_TRADING)。'); return }

    // ── Step 1: 指纹验证(同一流程内,每次下单前) ──────────────────────────────
    let vtext = ''
    try {
      const r = await ctx.agent.run({ prompt: VERIFY_PROMPT, model: modelFor('haiku'), effort: 'low', mcpAllow: ['longbridge'] })
      vtext = r.text
    } catch (err) {
      await reply(`⚠️ 模拟盘验证出错,已中止下单:${err}`); return
    }
    const v = parseVerify(vtext)
    if (!v) { await reply('⚠️ 无法验证账户类型,已中止下单(安全起见)。'); return }
    if (!v.ok) {
      // 检测到真实账户特征 → 拒绝 + 告警(可能是凭证被换成真账户)。
      ctx.db.audit({ channel: inbound.channel, chatId: inbound.chatId, user: inbound.user, kind: 'error',
        payload: `[paper-guard] 拒绝:检测到真实账户特征 deposits=${v.deposits} cards=${v.cards}` })
      await ctx.channels.send('discord', REPORT_DM,
        `🚨 **模拟盘安全拦截**:长桥账户出现真实特征(入金 ${v.deposits} 笔 / 银行卡 ${v.cards} 张)——可能凭证已换成**真实账户**。AI 已拒绝下单。若确实换了真账户,请立即 \`NIMBUS_PAPER_TRADING\` 关闭并重启。`, {})
      await reply('🚨 已拒绝:检测到真实账户特征,AI 不在真钱账户下单。详见告警。')
      return
    }

    // ── Step 2: 验证通过 → 执行模拟盘下单(allowPaperTrade) ────────────────────
    const orderPrompt = [
      `【模拟盘交易 — 已验证为模拟账户(无入金/无绑卡)】`,
      `${ctx.memory.buildContext()}`,
      '',
      '主人的模拟盘指令如下。请用 longbridge 下单工具(submit_order 等)在**模拟盘**执行:',
      '- 先用行情确认价格,按主人指令的标的/方向/数量下单(限价或市价按指令)。',
      '- 下单后用 today_orders / order_detail 确认状态,回报成交/挂单结果。',
      '- 只下主人明确说的单,不擅自加码。出入金/转账绝不碰。',
      '',
      `指令:${inbound.content}`,
    ].join('\n')

    let otext = ''
    try {
      const r = await ctx.agent.run({
        prompt: orderPrompt,
        model: modelFor('sonnet'),
        allowPaperTrade: true, // ★唯一放行长桥模拟盘下单的地方
        mcpAllow: ['longbridge'], // 下单需要长桥 MCP
      })
      otext = r.text
    } catch (err) {
      await reply(`⚠️ 模拟盘下单执行出错:${err}`); return
    }

    ctx.db.audit({ channel: inbound.channel, chatId: inbound.chatId, user: inbound.user, kind: 'tool',
      payload: `[paper-order] ${inbound.content}\n→ ${otext.slice(0, 500)}` })
    // 结果发回 + 同步通知日报频道(透明:AI 下了什么单你实时看到)。
    await reply(`📝 **模拟盘**\n${otext}`)
    if (inbound.chatId !== REPORT_DM) {
      await ctx.channels.send('discord', REPORT_DM, `📝 模拟盘下单(${inbound.user}):${otext.slice(0, 300)}`, {}).catch(() => {})
    }
  },
}

export const paperModules: Module[] = [paperTrade]
