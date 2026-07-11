/**
 * pushEnvelope.ts — PushEnvelope v1 builder + channel adapters.
 *
 * The envelope is the single push contract shared across producers (news,
 * nimbus) and transports (wechat-io). Producers construct an
 * envelope and map it to a channel payload here; they never reimplement
 * rate-limit / merge logic (that stays in the transports).
 *
 * Mirrors docs/contracts/push-envelope-v1.md and the Python transport-gateway
 * adapter (services/transport-gateway/transport_gateway/envelope.py).
 */

import { createHash } from 'crypto'

export type PushPriority = 'now' | 'digest'
export type ChannelHint = 'wechat-io' | 'discord' | 'feishu' | 'telegram' | 'wecom'

export interface PushEnvelope {
  version: 1
  request_id: string
  source: string
  title?: string
  text: string
  priority: PushPriority
  channel_hint?: ChannelHint
  to?: string
  metadata?: Record<string, unknown>
}

export interface EnvelopeInput {
  source: string
  text: string
  title?: string
  priority?: PushPriority
  channel_hint?: ChannelHint
  to?: string
  request_id?: string
  metadata?: Record<string, unknown>
}

function contentHash(input: EnvelopeInput): string {
  const basis = JSON.stringify({
    source: input.source,
    title: input.title ?? '',
    text: input.text ?? '',
    to: input.to ?? '',
  })
  return 'h:' + createHash('sha256').update(basis).digest('hex').slice(0, 24)
}

/** Build a normalized PushEnvelope, filling version, request_id and defaults. */
export function buildEnvelope(input: EnvelopeInput): PushEnvelope {
  const env: PushEnvelope = {
    version: 1,
    request_id: input.request_id?.trim() || contentHash(input),
    source: input.source,
    text: input.text ?? '',
    priority: input.priority ?? 'now',
  }
  if (input.title) env.title = input.title
  if (input.channel_hint) env.channel_hint = input.channel_hint
  if (input.to) env.to = input.to
  if (input.metadata) env.metadata = input.metadata
  return env
}

export function validateEnvelope(env: PushEnvelope): void {
  if (env.version !== 1) throw new Error('PushEnvelope.version must be 1')
  if (!env.source?.trim()) throw new Error('PushEnvelope.source required')
  if (!env.text?.trim() && !env.title?.trim()) throw new Error('PushEnvelope needs text or title')
  if (env.priority !== 'now' && env.priority !== 'digest') throw new Error('PushEnvelope.priority must be now|digest')
}
