// weixin-inbound.ts — OpenAI-compatible inbound adapter for wechat-io.
//
// wechat-io (纯 I/O 网关, Python) 感知群消息后, 经 OpenAI 兼容口
//   POST http://127.0.0.1:8788/v1/chat/completions
//   X-Hermes-Session-Id: wechat-{chat_id}        ← 群级会话隔离
// 调进来。本通道把它桥接进 Dispatcher (与 Cici 的 Discord 路径同一套 agent/记忆/
// 预算), 等首个回复后以 OpenAI chat.completion 形状同步返回。
//
// 默认不启动 (WEIXIN_INBOUND=0); DeepSeek/微信第二实例设 WEIXIN_INBOUND=1 开启。

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { randomUUID } from 'crypto'
import type { Channel, HistoryEntry, InboundMsg, SendOpts } from './channel.js'
import { WEIXIN_INBOUND_HOST, WEIXIN_INBOUND_PORT, WEIXIN_INBOUND_TOKEN } from '../config.js'

interface PendingReply {
  resolve: (text: string) => void
  timer: ReturnType<typeof setTimeout>
  chunks: string[]
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', chunk => {
      body += chunk
      if (body.length > 1_000_000) {
        reject(new Error('request body too large'))
        req.destroy()
      }
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(body)
}

/** OpenAI chat-completion message content can be a string or an array of parts
 *  (vision format). Collapse to plain text — wechat-io only sends text. */
function messageText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(p => (p && typeof p === 'object' && typeof (p as { text?: unknown }).text === 'string'
        ? (p as { text: string }).text
        : ''))
      .join('')
  }
  return ''
}

/** Pull the last user-authored message from an OpenAI `messages[]` array. */
function lastUserText(messages: unknown): string {
  if (!Array.isArray(messages)) return ''
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: unknown; content?: unknown }
    if (m && m.role === 'user') return messageText(m.content).trim()
  }
  // Fallback: last message of any role.
  const last = messages[messages.length - 1] as { content?: unknown } | undefined
  return last ? messageText(last.content).trim() : ''
}

export class WeixinInboundChannel implements Channel {
  // Distinct from WeixinChannel's id='weixin' (Phase-2 iLink path) so the two
  // never collide in the registry even if both were ever registered together.
  id = 'weixin-inbound'
  // wechat-io wants one final message, not streaming edits.
  streaming = false
  #handler?: (m: InboundMsg) => void
  #server?: Server
  #pending = new Map<string, PendingReply>()

  async start(): Promise<void> {
    this.#server = createServer((req, res) => { void this.#handle(req, res) })
    await new Promise<void>(resolve => {
      this.#server!.once('error', err => {
        process.stderr.write(`nimbus weixin-inbound: disabled (${String(err)})\n`)
        resolve()
      })
      this.#server!.listen(WEIXIN_INBOUND_PORT, WEIXIN_INBOUND_HOST, () => {
        process.stderr.write(
          `nimbus weixin-inbound: listening on http://${WEIXIN_INBOUND_HOST}:${WEIXIN_INBOUND_PORT}/v1/chat/completions\n`,
        )
        resolve()
      })
    })
  }

  onMessage(cb: (m: InboundMsg) => void): void {
    this.#handler = cb
  }

  async send(_chatId: string, text: string, opts?: SendOpts): Promise<string> {
    const key = opts?.replyTo
    if (key) {
      const pending = this.#pending.get(key)
      if (pending) {
        pending.chunks.push(text)
        clearTimeout(pending.timer)
        this.#pending.delete(key)
        pending.resolve(pending.chunks.join('\n\n'))
      }
    }
    return `weixin-send-${randomUUID()}`
  }

  async edit(chatId: string, _msgId: string, text: string): Promise<void> {
    await this.send(chatId, text)
  }

  async react(): Promise<void> {}
  async fetchHistory(): Promise<HistoryEntry[]> { return [] }
  async download(): Promise<string[]> { return [] }
  async sendTyping(): Promise<void> {}

  destroy(): void {
    this.#server?.close()
    for (const [key, pending] of this.#pending) {
      clearTimeout(pending.timer)
      this.#pending.delete(key)
      pending.resolve('⚠️ nimbus weixin 网关重启中,请稍后再试')
    }
  }

  async #handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, { ok: true, channel: 'weixin' })
      return
    }
    if (req.method !== 'POST' || url.pathname !== '/v1/chat/completions') {
      sendJson(res, 404, { error: { message: 'not found', type: 'invalid_request_error' } })
      return
    }
    if (WEIXIN_INBOUND_TOKEN) {
      const auth = req.headers.authorization ?? ''
      if (auth !== `Bearer ${WEIXIN_INBOUND_TOKEN}`) {
        sendJson(res, 401, { error: { message: 'unauthorized', type: 'invalid_request_error' } })
        return
      }
    }
    if (!this.#handler) {
      sendJson(res, 503, { error: { message: 'dispatcher not ready', type: 'server_error' } })
      return
    }
    try {
      const raw = await readBody(req)
      const body = JSON.parse(raw || '{}') as Record<string, unknown>
      const text = lastUserText(body.messages)
      if (!text) {
        sendJson(res, 400, { error: { message: '`messages` must contain a user message', type: 'invalid_request_error' } })
        return
      }
      // Group-level session isolation: wechat-io sets X-Hermes-Session-Id:
      // wechat-{chatId}.  Use that value verbatim as the dispatcher chatId so
      // each group resumes its own session.  Fall back to a per-request id.
      const sessionHeader = req.headers['x-hermes-session-id']
      const headerVal = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader
      const chatId = headerVal && headerVal.trim() ? headerVal.trim() : `weixin:${randomUUID()}`
      const model = typeof body.model === 'string' ? body.model : 'nimbus'
      const messageId = `weixin-msg-${randomUUID()}`
      const reply = await this.#submit({
        channel: this.id,
        chatId,
        messageId,
        user: 'weixin',
        userId: chatId,
        ts: new Date().toISOString(),
        content: text,
      })
      sendJson(res, 200, {
        id: `chatcmpl-${randomUUID()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{
          index: 0,
          message: { role: 'assistant', content: reply },
          finish_reason: 'stop',
        }],
        // Cost is tracked internally via the usage table; wechat-io does not bill
        // off these numbers, so zeros are fine here.
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      })
    } catch (err) {
      sendJson(res, 500, { error: { message: String(err), type: 'server_error' } })
    }
  }

  #submit(msg: InboundMsg): Promise<string> {
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        this.#pending.delete(msg.messageId)
        resolve('⚠️ nimbus 处理超时,请稍后再试')
      }, 180_000)
      this.#pending.set(msg.messageId, { resolve, timer, chunks: [] })
      this.#handler?.(msg)
    })
  }
}
