/**
 * registry.ts — Simple ChannelRegistry that routes send() to the right Channel.
 *
 * Kept minimal: just a Map<id, Channel> with a send() facade.
 * main.ts registers channels at startup; modules never reference channels directly.
 */

import type { Channel } from '../channels/channel.js'
import type { ChannelRegistry } from '../modules/module.js'
import type { SendOpts } from '../channels/channel.js'

export class SimpleRegistry implements ChannelRegistry {
  readonly #channels = new Map<string, Channel>()

  register(channel: Channel): void {
    this.#channels.set(channel.id, channel)
  }

  async send(
    channelId: string,
    chatId: string,
    text: string,
    opts?: SendOpts,
  ): Promise<string> {
    const ch = this.#channels.get(channelId)
    if (!ch) throw new Error(`ChannelRegistry: unknown channel '${channelId}'`)
    return ch.send(chatId, text, opts)
  }

  async edit(
    channelId: string,
    chatId: string,
    msgId: string,
    text: string,
  ): Promise<void> {
    const ch = this.#channels.get(channelId)
    if (!ch) throw new Error(`ChannelRegistry: unknown channel '${channelId}'`)
    return ch.edit(chatId, msgId, text)
  }

  async sendTyping(channelId: string, chatId: string): Promise<void> {
    const ch = this.#channels.get(channelId)
    if (!ch) throw new Error(`ChannelRegistry: unknown channel '${channelId}'`)
    return ch.sendTyping(chatId)
  }
}
