/**
 * mirror-registry.ts — wraps a ChannelRegistry and mirrors the owner's
 * *proactive* pushes (daily reports, alerts, opportunity, reflection…) to the
 * personal-WeChat hub (Phase 1, push direction only).
 *
 * How proactive vs interactive is told apart, with zero dispatcher surgery:
 * interactive replies always carry `opts.replyTo` (placeholder, streaming edits,
 * command replies all reply to the user's message), while proactive module
 * pushes send with `{}`. So we mirror only sends to a configured owner chat that
 * have **no replyTo** (and no file attachment, which the hub can't deliver).
 *
 * The real (Discord) send is the critical path and always runs first; the hub
 * post is fire-and-forget so a down/unreachable hub never affects Discord or the
 * caller.
 */

import type { ChannelRegistry } from '../modules/module.js'
import type { EmbedSpec, SendOpts } from '../channels/channel.js'
import { pushToHub } from '../channels/weixin/hub.js'
import { WEIXIN_MIRROR_CHATS, WEIXIN_MIRROR_ENABLED } from '../config.js'

function embedToText(embed: EmbedSpec): string {
  const parts: string[] = []
  if (embed.title) parts.push(embed.title)
  if (embed.description) parts.push(embed.description)
  for (const f of embed.fields ?? []) {
    const name = (f.name ?? '').trim()
    const value = (f.value ?? '').trim()
    if (name && value) parts.push(`${name}: ${value}`)
    else if (value) parts.push(value)
    else if (name) parts.push(name)
  }
  if (embed.footer) parts.push(embed.footer)
  return parts.join('\n').trim()
}

export class MirroringRegistry implements ChannelRegistry {
  readonly #inner: ChannelRegistry
  readonly #chats: Set<string>
  readonly #enabled: boolean

  constructor(inner: ChannelRegistry, opts?: { enabled?: boolean; chats?: string[] }) {
    this.#inner = inner
    this.#enabled = opts?.enabled ?? WEIXIN_MIRROR_ENABLED
    this.#chats = new Set(opts?.chats ?? WEIXIN_MIRROR_CHATS)
  }

  async send(channel: string, chatId: string, text: string, opts?: SendOpts): Promise<string> {
    // Critical path: the real send happens first and its result is returned.
    const id = await this.#inner.send(channel, chatId, text, opts)

    if (
      this.#enabled &&
      this.#chats.has(chatId) &&
      !opts?.replyTo && // interactive replies carry replyTo — skip those
      !opts?.files?.length // hub is text-only; skip file-attachment notices
    ) {
      const body = text?.trim() ? text : opts?.embed ? embedToText(opts.embed) : ''
      if (body.trim()) void pushToHub({ text: body, priority: 'now', source: 'Cici' })
    }
    return id
  }

  edit(channel: string, chatId: string, msgId: string, text: string): Promise<void> {
    return this.#inner.edit(channel, chatId, msgId, text)
  }

  sendTyping(channel: string, chatId: string): Promise<void> {
    return this.#inner.sendTyping(channel, chatId)
  }

  streams(channel: string): boolean {
    return this.#inner.streams?.(channel) ?? true
  }
}
