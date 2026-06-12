/**
 * alerts/index.ts — Alert module for M6 Batch 1.
 *
 * Handles event triggers (stop_hit, concentration_breach, thesis_decay) by
 * constructing an agent prompt that routes to the appropriate skills.
 *
 * - stop_hit      → thesis-tracker + trade-execution: evaluate stop/adjust
 * - concentration → portfolio-manager: concentration risk assessment
 * - thesis_decay  → thesis-tracker: re-verify thesis
 *
 * Prefixes memory.buildContext() (which already includes AI no-trade rule).
 * Explicitly reminds agent to give specific [标的/方向/数量/价格] for manual execution.
 */

import type { Module, ModuleContext } from '../module.js'
import { REPORT_DM } from '../../config.js'
import { modelFor } from '../../core/models.js'

// ── Prompt builders ────────────────────────────────────────────────────────────

function buildStopHitPrompt(summary: string): string {
  return [
    `【止损告警 — 主动告警】${summary}`,
    '',
    '请立即执行以下评估：',
    '1. 调用 `thesis-tracker` skill 复核该标的论点当前状态：论点是否已失效？基本面有无变化？',
    '2. 调用 `trade-execution` skill 评估：是否应立即止损？或设置新的止损位？有无止损外的替代方案？',
    '3. 给出具体行动建议：',
    '   - 如建议止损：【标的/方向（卖出）/数量/参考价格】',
    '   - 如建议持有：给出持有理由 + 新止损位 + 下次复核触发条件',
    '',
    '⚠️ AI 绝不下单。所有建议仅供主人参考，请在 futu/IBKR App 手动执行。',
  ].join('\n')
}

function buildConcentrationPrompt(summary: string): string {
  return [
    `【集中度告警 — 主动告警】${summary}`,
    '',
    '请执行集中度风险评估：',
    '1. 调用 `portfolio-manager` skill（拉 futu+IBKR 真实持仓）分析当前集中度风险：',
    '   - 该持仓/板块集中度是否在可接受范围？',
    '   - 与其他持仓的相关性如何？是否存在系统性风险？',
    '2. 给出再平衡建议（若需要）：',
    '   - 减仓标的 + 具体数量/金额',
    '   - 目标权重',
    '',
    '⚠️ AI 绝不下单。所有建议仅供主人参考，给出【标的/方向/数量/价格】让主人手动执行。',
  ].join('\n')
}

function buildThesisDecayPrompt(summary: string): string {
  return [
    `【论点衰减告警 — 主动告警】${summary}`,
    '',
    '请执行论点复核：',
    '1. 调用 `thesis-tracker` skill 对该标的进行全面论点审查：',
    '   - 原始论点是否仍然有效？',
    '   - 有哪些支持/反对证据？',
    '   - 是否需要降低 conviction score？',
    '2. 给出结论：',
    '   - 论点维持 / 降级 / 放弃',
    '   - 如论点放弃：给出退出建议【标的/方向（卖出）/数量/参考价格】',
    '   - 如论点维持：给出更新后的 kill criteria',
    '',
    '⚠️ AI 绝不下单。所有建议仅供主人参考，请在 futu/IBKR App 手动执行。',
  ].join('\n')
}

// ── Alerts Module ─────────────────────────────────────────────────────────────

export const alertsModule: Module = {
  name: 'alerts',
  events: ['stop_hit', 'concentration_breach', 'thesis_decay'],
  targetChat: REPORT_DM,

  async handle(ctx: ModuleContext): Promise<void> {
    const { trigger, channels, agent, db, memory } = ctx

    // Only handles event triggers
    if (trigger.kind !== 'event') return

    const { event, payload } = trigger
    const summary = payload.summary

    // Build skill-routing prompt based on event type
    let innerPrompt: string
    if (event === 'stop_hit') {
      innerPrompt = buildStopHitPrompt(summary)
    } else if (event === 'concentration_breach') {
      innerPrompt = buildConcentrationPrompt(summary)
    } else {
      // thesis_decay
      innerPrompt = buildThesisDecayPrompt(summary)
    }

    // Prefix with memory context (includes AI no-trade rule, risk profile, positions)
    const ctxPrefix = memory.buildContext()
    const fullPrompt = ctxPrefix ? `${ctxPrefix}\n\n---\n\n${innerPrompt}` : innerPrompt

    const prior = db.getSession('discord', REPORT_DM)?.sdkSessionId

    let text = ''
    let sessionId: string | undefined
    try {
      const result = await agent.run({
        prompt: fullPrompt,
        resume: prior,
        model: modelFor('opus'),
      })
      text = result.text
      sessionId = result.sessionId
    } catch (err) {
      await channels.send('discord', REPORT_DM, `⚠️ 告警处理出错（${event}）：${err}`, {})
      return
    }

    if (sessionId) {
      db.putSession('discord', REPORT_DM, { sdkSessionId: sessionId })
    }

    if (text) {
      await channels.send('discord', REPORT_DM, text, {})
    }
  },
}

export const alertModules: Module[] = [alertsModule]
