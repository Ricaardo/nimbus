import type { Module, ModuleContext } from '../module.js'
import type { InboundMsg } from '../../channels/channel.js'

const echo: Module = {
  name: 'echo',

  match(_m: InboundMsg): boolean {
    return true
  },

  async handle(ctx: ModuleContext): Promise<void> {
    if (ctx.trigger.kind !== 'message') return
    const { payload } = ctx.trigger
    await ctx.channels.send('discord', payload.chatId, payload.content, {
      replyTo: payload.messageId,
    })
  },
}

export default echo
