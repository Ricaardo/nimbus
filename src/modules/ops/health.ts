/**
 * ops/health.ts — 健康自愈检查(每 20 分钟)。
 *
 * 进程崩溃 → launchd KeepAlive + nimbus-daemon.sh 退避重启(已有);
 * gateway 断 → 连接层 60s 心跳 re-login(已有)。
 * 这个作业补"可见性 + 主动告警":检 OpenD(L0 行情依赖)+ DB,
 * 异常才推 Discord(1h 冷却,不刷屏)+ stderr;恢复时通知一次。
 */

import type { Module, ModuleContext } from '../module.js'
import { defaultTcpCheck } from '../quote/index.js'
import { buildEmbed } from '../../core/embed.js'
import { kbHealth } from '../../core/knowledge.js'
import { OPEND_HOST, OPEND_PORT, REPORT_DM, HEALTH_CRON } from '../../config.js'

const COOLDOWN_MS = 60 * 60_000 // 1h between repeated down-alerts
// State in one cooldown key 'health:opend': 0/null = healthy; >0 = down-since-last-alert.
const KEY = 'health:opend'
const KB_KEY = 'health:kb' // 知识层 sidecar(弱依赖,挂了 recall 降级,但仍想可见)

const healthCheck: Module = {
  name: 'ops:health',
  cron: HEALTH_CRON,
  targetChat: REPORT_DM,

  async handle(ctx: ModuleContext): Promise<void> {
    if (ctx.trigger.kind !== 'cron') return

    const opendUp = await defaultTcpCheck(OPEND_HOST, OPEND_PORT, 2000)
    const flagged = ctx.db.getCooldown(KEY) ?? 0 // 0 = healthy, >0 = down since last alert

    if (!opendUp) {
      process.stderr.write(`nimbus: health — OpenD ${OPEND_HOST}:${OPEND_PORT} 不可达\n`)
      const firstOrCooled = flagged === 0 || Date.now() - flagged > COOLDOWN_MS
      if (firstOrCooled) {
        await ctx.channels.send('discord', REPORT_DM, '', {
          embed: buildEmbed('danger', {
            title: '⚠️ 健康告警 — OpenD 不可达',
            description: `futu OpenD(${OPEND_HOST}:${OPEND_PORT})无响应 → L0 行情降级到 yfinance。\n请检查 OpenD 是否在运行。`,
          }),
        })
        ctx.db.setCooldown(KEY, Date.now()) // mark down + record alert time
      }
    } else if (flagged > 0) {
      // Recovered from a previously-flagged outage → notify once, reset to healthy.
      await ctx.channels.send('discord', REPORT_DM, '', {
        embed: buildEmbed('success', { title: '✅ 健康恢复 — OpenD', description: 'OpenD 已恢复,L0 行情正常。' }),
      })
      ctx.db.setCooldown(KEY, 0)
    }

    // ── 知识层 sidecar 自检(弱依赖:挂了历史召回降级,bot 不崩,但需可见) ──
    const kb = await kbHealth()
    const kbFlagged = ctx.db.getCooldown(KB_KEY) ?? 0
    if (!kb) {
      process.stderr.write('nimbus: health — kb-server 不可达,历史召回降级\n')
      if (kbFlagged === 0 || Date.now() - kbFlagged > COOLDOWN_MS) {
        await ctx.channels.send('discord', REPORT_DM, '', {
          embed: buildEmbed('warn', {
            title: '⚠️ 知识层 sidecar 不可达',
            description: 'kb-server(RAG)无响应 → 历史研究召回降级(bot 照常运转)。\n修:`launchctl kickstart -k gui/$(id -u)/com.nimbus.kb-server`',
          }),
        })
        ctx.db.setCooldown(KB_KEY, Date.now())
      }
    } else if (kbFlagged > 0) {
      await ctx.channels.send('discord', REPORT_DM, '', {
        embed: buildEmbed('success', { title: '✅ 知识层恢复', description: `kb-server 已恢复(${kb.artifacts} artifacts / ${kb.chunks} chunks)。` }),
      })
      ctx.db.setCooldown(KB_KEY, 0)
    }
  },
}

export const healthModules: Module[] = [healthCheck]
