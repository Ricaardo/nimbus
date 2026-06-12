// TelegramChannel — wraps grammY Bot, implements Channel interface.
//
// ⚠️  SINGLE CONSUMER WARNING: @CicociBot has a Claude TG channel launchd
// daemon that may already be consuming updates (long-polling). Starting Nimbus
// TG while that daemon is running will cause BOTH processes to receive the
// same updates and BOTH will reply — two responses per message. Before running
// Nimbus with TG enabled, stop the Claude TG channel daemon:
//   launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.claude.telegram.plist
// (Mirrors the Discord single-consumer iron rule.)

import { Bot } from 'grammy'
import { mkdirSync } from 'fs'
import { isAllowed } from './access.js'
import { chunk } from '../shared/chunk.js'
import { TG_CHUNK_LIMIT, TG_INBOX_DIR } from '../../config.js'
import type { Channel, InboundMsg, SendOpts, HistoryEntry } from '../channel.js'

// grammY types — imported for type annotations only (erased at runtime).
type GrammyBot = import('grammy').Bot

export class TelegramChannel implements Channel {
  readonly id = 'telegram'

  // TypeScript `private` (not hard-private `#`) so tests can inject a mock bot
  // via `(channel as any)._bot = mockBot`. The interface remains encapsulated
  // from external TypeScript callers.
  private readonly _token: string
  private _bot: GrammyBot | null = null
  private _onMessageCb: ((m: InboundMsg) => void) | null = null

  constructor(token: string) {
    this._token = token
  }

  onMessage(cb: (m: InboundMsg) => void): void {
    this._onMessageCb = cb
  }

  async start(): Promise<void> {
    mkdirSync(TG_INBOX_DIR, { recursive: true })

    const bot = new Bot(this._token)
    this._bot = bot

    bot.on('message:text', ctx => {
      const from = ctx.message.from
      const userId = String(from.id)

      // Access gate — silently drop unauthorized users.
      // Never reply to non-allowlisted senders: doing so would confirm
      // the bot exists and potentially leak information.
      if (!isAllowed(userId)) return

      const inbound: InboundMsg = {
        channel: 'telegram',
        chatId: String(ctx.chat.id),
        messageId: String(ctx.message.message_id),
        user: from.username ?? from.first_name,
        userId,
        ts: new Date(ctx.message.date * 1000).toISOString(),
        content: ctx.message.text,
      }

      if (this._onMessageCb) {
        this._onMessageCb(inbound)
      }
    })

    // Start long-polling. bot.start() runs until bot.stop() is called.
    // We intentionally do NOT await — it blocks until stopped.
    bot.start({
      onStart: info => {
        process.stderr.write(`nimbus: telegram connected as @${info.username}\n`)
      },
    }).catch(err => {
      process.stderr.write(`nimbus: telegram polling error: ${err}\n`)
    })

    // Wait for initialization (bot.isRunning() becomes true after onStart).
    await new Promise<void>(resolve => {
      const check = setInterval(() => {
        if (bot.isRunning()) {
          clearInterval(check)
          resolve()
        }
      }, 50)
    })
  }

  /**
   * Send text to a Telegram chat, chunking at TG_CHUNK_LIMIT (4096).
   * The first chunk may carry a reply_parameters reference (opts.replyTo).
   * Returns the message_id of the first sent message as a string.
   */
  async send(chatId: string, text: string, opts?: SendOpts): Promise<string> {
    if (!this._bot) throw new Error('TelegramChannel not started')

    const chunks = chunk(text, TG_CHUNK_LIMIT, 'newline')
    let firstId: string | null = null

    for (let i = 0; i < chunks.length; i++) {
      const replyParam =
        i === 0 && opts?.replyTo != null
          ? { reply_parameters: { message_id: Number(opts.replyTo) } }
          : {}

      const sent = await this._bot.api.sendMessage(chatId, chunks[i]!, replyParam)
      if (firstId === null) firstId = String(sent.message_id)
    }

    return firstId!
  }

  async edit(chatId: string, msgId: string, text: string): Promise<void> {
    if (!this._bot) throw new Error('TelegramChannel not started')
    await this._bot.api.editMessageText(chatId, Number(msgId), text)
  }

  async react(chatId: string, msgId: string, emoji: string): Promise<void> {
    if (!this._bot) throw new Error('TelegramChannel not started')
    // grammY api.setMessageReaction accepts ReactionType[] — wrap emoji string.
    // Telegram only supports a limited set of emoji reactions; invalid ones
    // will be rejected by the API (non-fatal; caller should use valid emoji).
    await this._bot.api.setMessageReaction(chatId, Number(msgId), [
      { type: 'emoji', emoji: emoji as any },
    ])
  }

  async sendTyping(chatId: string): Promise<void> {
    if (!this._bot) throw new Error('TelegramChannel not started')
    await this._bot.api.sendChatAction(chatId, 'typing')
  }

  /**
   * Telegram Bot API does not support pulling arbitrary chat history — bots
   * can only read messages as they arrive via webhook/polling. Returns [].
   * (This is a known platform limitation, not a Nimbus limitation.)
   */
  async fetchHistory(_chatId: string, _limit: number): Promise<HistoryEntry[]> {
    return []
  }

  /**
   * Telegram Bot API cannot retrieve messages/attachments by message_id after
   * the fact. Attachments must be captured at inbound time (in the message:*
   * handler). Returns [] for now — inbound attachment handling is a post-M0
   * concern and does not block core chat functionality.
   */
  async download(_chatId: string, _msgId: string): Promise<string[]> {
    return []
  }

  destroy(): void {
    this._bot?.stop().catch(() => {})
  }
}
