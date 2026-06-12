// DiscordChannel — wraps discord.js Client, implements Channel interface.
// discord.js is never statically imported; always loaded via loadDiscordJs().

import { TOKEN } from '../../config.js'
import { proxyAgent, loadDiscordJs } from './proxy.js'
import { gate, dmChannelUsers, loadAccess } from './access.js'
import { sendReply, safeAttName, editMessage, reactToMessage, fetchHistory, downloadMessageAttachments } from './outbound.js'
import type { Channel, InboundMsg, SendOpts } from '../channel.js'

export class DiscordChannel implements Channel {
  readonly id = 'discord'

  #client: import('discord.js').Client | null = null
  #onMessageCb: ((m: InboundMsg) => void) | null = null

  onMessage(cb: (m: InboundMsg) => void): void {
    this.#onMessageCb = cb
  }

  async start(): Promise<void> {
    const dj = await loadDiscordJs()
    const { Client, GatewayIntentBits, Partials, ChannelType } = dj

    const client = new Client({
      intents: [
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
      // DMs arrive as partial channels — messageCreate never fires without this.
      partials: [Partials.Channel],
      // proxyAgent type conflicts between discord.js's bundled undici and ours;
      // cast to any — runtime is correct (same ProxyAgent interface).
      rest: proxyAgent ? { agent: proxyAgent as any } : undefined,
    })

    this.#client = client

    // ── Event handlers ────────────────────────────────────────────────────────

    client.on('error', err => {
      process.stderr.write(`nimbus: discord client error: ${err}\n`)
    })

    // 'clientReady' is the v15 name; 'ready' is deprecated. Cast to keep the
    // typed overload happy across discord.js minor versions.
    client.once('clientReady' as 'ready', c => {
      process.stderr.write(`nimbus: gateway connected as ${c.user.tag}\n`)
    })

    // ── Gateway reconnect monitoring (L929-936) ───────────────────────────────
    client.on('shardDisconnect', (event: any, id: number) =>
      process.stderr.write(`nimbus: shard ${id} disconnected (code ${event.code})\n`))
    client.on('shardReconnecting', (id: number) =>
      process.stderr.write(`nimbus: shard ${id} reconnecting...\n`))
    client.on('shardResume', (id: number, replayed: number) =>
      process.stderr.write(`nimbus: shard ${id} resumed, replayed ${replayed} events\n`))
    client.on('shardError', (err: Error, id: number) =>
      process.stderr.write(`nimbus: shard ${id} error: ${err}\n`))

    // ── Heartbeat check — re-login ONLY when truly wedged ─────────────────────
    // 关键修复:旧版单次非 READY 就 destroy+login,会在 gateway **正常重连**
    // (status=RECONNECTING≠READY)时一脚踢飞正在恢复的连接 → 重连风暴(实测73次)。
    // 改:连续 N 次(默认3次=90s)都非 READY 才判定僵死、re-login;正常重连几秒
    // 内恢复,不会连续命中。
    let notReadyStreak = 0
    setInterval(() => {
      if (client.ws.status !== 0) { // 0 = READY
        notReadyStreak++
        if (notReadyStreak >= 3) {
          process.stderr.write(`nimbus: gateway wedged ${notReadyStreak}×30s non-READY, re-login...\n`)
          notReadyStreak = 0
          client.destroy()
          client.login(TOKEN!).catch(err => {
            process.stderr.write(`nimbus: re-login failed: ${err}\n`)
          })
        }
      } else {
        notReadyStreak = 0 // 恢复 READY → 清零
      }
    }, 30_000).unref()

    // ── messageCreate (L836-839) ──────────────────────────────────────────────
    client.on('messageCreate', msg => {
      if (msg.author.bot) return
      this.#handleInbound(msg as import('discord.js').Message).catch(e =>
        process.stderr.write(`nimbus: handleInbound failed: ${e}\n`),
      )
    })

    // ── Login (L949-952) ─────────────────────────────────────────────────────
    await client.login(TOKEN!).catch(err => {
      process.stderr.write(`nimbus: login failed: ${err}\n`)
      process.exit(1)
    })
  }

  async #handleInbound(msg: import('discord.js').Message): Promise<void> {
    const result = await gate(msg, this.#client?.user?.id)

    if (result.action === 'drop') return

    if (result.action === 'pair') {
      const lead = result.isResend ? 'Still pending' : 'Pairing required'
      try {
        await msg.reply(
          `${lead} — run in Claude Code:\n\n/discord:access pair ${result.code}`,
        )
      } catch (err) {
        process.stderr.write(`nimbus: failed to send pairing code: ${err}\n`)
      }
      return
    }

    // deliver
    const chat_id = msg.channelId

    // DM: capture user ID for outbound DM gate (L860-862)
    const DM_TYPE = 1 // ChannelType.DM
    if (msg.channel.type === DM_TYPE) {
      dmChannelUsers.set(chat_id, msg.author.id)
    }

    // Typing indicator (L882-885)
    if ('sendTyping' in msg.channel) {
      void (msg.channel as any).sendTyping().catch(() => {})
    }

    // Ack reaction (L888-891)
    const access = result.access
    if (access.ackReaction) {
      void msg.react(access.ackReaction).catch(() => {})
    }

    // Attachments listed (L896-904)
    const atts: string[] = []
    for (const att of msg.attachments.values()) {
      const kb = (att.size / 1024).toFixed(0)
      atts.push(`${safeAttName(att)} (${att.contentType ?? 'unknown'}, ${kb}KB)`)
    }

    const content = msg.content || (atts.length > 0 ? '(attachment)' : '')

    // ★ M0 swap point: instead of mcp.notification, deliver to onMessage callback
    const inbound: InboundMsg = {
      channel: 'discord',
      chatId: chat_id,
      messageId: msg.id,
      user: msg.author.username,
      userId: msg.author.id,
      ts: msg.createdAt.toISOString(),
      content,
      ...(atts.length > 0 ? { attachments: atts } : {}),
    }

    if (this.#onMessageCb) {
      this.#onMessageCb(inbound)
    }
  }

  async send(chatId: string, text: string, opts?: SendOpts): Promise<string> {
    if (!this.#client) throw new Error('DiscordChannel not started')
    return sendReply(this.#client, chatId, text, opts)
  }

  async edit(chatId: string, msgId: string, text: string): Promise<void> {
    if (!this.#client) throw new Error('DiscordChannel not started')
    await editMessage(this.#client, chatId, msgId, text)
  }

  async react(chatId: string, msgId: string, emoji: string): Promise<void> {
    if (!this.#client) throw new Error('DiscordChannel not started')
    await reactToMessage(this.#client, chatId, msgId, emoji)
  }

  async fetchHistory(chatId: string, limit: number): Promise<import('../channel.js').HistoryEntry[]> {
    if (!this.#client) throw new Error('DiscordChannel not started')
    return fetchHistory(this.#client, chatId, limit)
  }

  async download(chatId: string, msgId: string): Promise<string[]> {
    if (!this.#client) throw new Error('DiscordChannel not started')
    return downloadMessageAttachments(this.#client, chatId, msgId)
  }

  async sendTyping(chatId: string): Promise<void> {
    if (!this.#client) throw new Error('DiscordChannel not started')
    try {
      const ch = await this.#client.channels.fetch(chatId)
      if (ch && 'sendTyping' in ch) {
        await (ch as any).sendTyping()
      }
    } catch {
      // typing is best-effort; swallow errors
    }
  }

  destroy(): void {
    this.#client?.destroy()
  }
}
