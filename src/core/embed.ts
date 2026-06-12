/**
 * embed.ts — Discord embed 卡片 helper(结构化推送用)。
 *
 * 用于结构化的自动推送(成本周报/健康/告警):标题条 + 颜色 + 字段,更醒目。
 * agent 自由文本对话/日报保持纯 markdown(embed description 有 4096 限,且会
 * 丢失 agent 的 markdown 美感)。Telegram 无 embed → 自动降级成文本。
 */

import type { EmbedSpec, EmbedField } from '../channels/channel.js'

/** Discord 语义颜色(0xRRGGBB)。 */
export const COLORS = {
  danger: 0xed4245,   // 红 — 止损/告警/出错
  warn: 0xfee75c,     // 黄 — 提醒/降级
  success: 0x57f287,  // 绿 — 恢复/达成
  info: 0x5865f2,     // 蓝 — 一般信息/日报
  opportunity: 0x1abc9c, // 青 — 机会
  neutral: 0x95a5a6,  // 灰 — 统计/周报
} as const

export type EmbedKind = keyof typeof COLORS

export function buildEmbed(kind: EmbedKind, spec: Omit<EmbedSpec, 'color'>): EmbedSpec {
  return { color: COLORS[kind], ...spec }
}

export type { EmbedField }
