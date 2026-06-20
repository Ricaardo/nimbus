/**
 * weixin/index.ts — Phase 2 two-way channel for personal WeChat via weixin-hub.
 *
 * Inbound:  weixin-hub's getupdates loop POSTs each WeChat message to this
 *           channel's local HTTP endpoint (127.0.0.1) → emitted as an InboundMsg
 *           → dispatcher → Cici.
 * Outbound: replies (and any send to a weixin chat) go back out through the hub
 *           /send, which owns the iLink session + context_token threading.
 *
 * streaming = false: iLink can't stream edits, so the dispatcher sends one final
 * message instead of a placeholder + incremental edits.
 */

import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { Channel, HistoryEntry, InboundMsg, SendOpts } from '../channel.js'
import { pushToHub } from './hub.js'
import { WEIXIN_INBOUND_PORT } from '../../config.js'

function loadSharedToken(): string {
  const env = process.env.WEIXIN_HUB_TOKEN?.trim()
  if (env) return env
  const file = process.env.WEIXIN_HUB_TOKEN_FILE ?? join(homedir(), '.weixin-hub', 'api_token.txt')
  try {
    return readFileSync(file, 'utf8').trim()
  } catch {
    return ''
  }
}

export class WeixinChannel implements Channel {
  readonly id = 'weixin'
  readonly streaming = false
  #onMessageCb: ((m: InboundMsg) => void) | null = null
  #server: { stop: () => void } | null = null
  readonly #token = loadSharedToken()

  onMessage(cb: (m: InboundMsg) => void): void {
    this.#onMessageCb = cb
  }

  async start(): Promise<void> {
    this.#server = Bun.serve({
      port: WEIXIN_INBOUND_PORT,
      hostname: '127.0.0.1',
      fetch: async (req: Request): Promise<Response> => {
        const url = new URL(req.url)
        if (req.method === 'GET' && url.pathname === '/health') {
          return Response.json({ ok: true, channel: 'weixin' })
        }
        if (req.method === 'POST' && url.pathname === '/weixin/inbound') {
          if (this.#token && req.headers.get('authorization') !== `Bearer ${this.#token}`) {
            return new Response('unauthorized', { status: 401 })
          }
          let body: Record<string, unknown>
          try {
            body = (await req.json()) as Record<string, unknown>
          } catch {
            return new Response('bad json', { status: 400 })
          }
          const text = String(body.text ?? '').trim()
          const chatId = String(body.chatId ?? '').trim()
          if (!text || !chatId) return new Response('missing chatId/text', { status: 400 })
          // ★ Identity must survive an empty/missing userId. `??` only guards
          // null/undefined, so a POST with userId:"" would resolve to "" and the
          // owner check (OWNER_IDS.includes(userId)) silently fails → 主人 treated
          // as a stranger. Fall back to chatId on empty too (DM: chatId == openid).
          const userId = String(body.userId ?? '').trim() || chatId
          const user = String(body.user ?? '').trim() || chatId
          const inbound: InboundMsg = {
            channel: 'weixin',
            chatId,
            messageId: String(body.messageId ?? `wx-${Date.now()}`),
            user,
            userId,
            ts: new Date().toISOString(),
            content: text,
          }
          this.#onMessageCb?.(inbound)
          return Response.json({ ok: true })
        }
        return new Response('not found', { status: 404 })
      },
    })
    process.stderr.write(`nimbus: weixin inbound listening on 127.0.0.1:${WEIXIN_INBOUND_PORT}\n`)
  }

  async send(chatId: string, text: string, _opts?: SendOpts): Promise<string> {
    // Replies go back through the hub, which threads the iLink context_token.
    await pushToHub({ text, to: chatId, priority: 'now', source: '' })
    return `wx-${Date.now()}`
  }

  // Unsupported / non-streaming ops — safe no-ops.
  async edit(): Promise<void> {}
  async react(): Promise<void> {}
  async fetchHistory(): Promise<HistoryEntry[]> {
    return []
  }
  async download(): Promise<string[]> {
    return []
  }
  async sendTyping(): Promise<void> {}

  destroy(): void {
    this.#server?.stop()
    this.#server = null
  }
}
