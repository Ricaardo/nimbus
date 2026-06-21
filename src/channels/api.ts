import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { randomUUID } from 'crypto'
import type { Channel, HistoryEntry, InboundMsg, SendOpts } from './channel.js'
import { API_CHANNEL_HOST, API_CHANNEL_PORT, API_CHANNEL_TOKEN } from '../config.js'

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

export class ApiChannel implements Channel {
  id = 'api'
  streaming = false
  #handler?: (m: InboundMsg) => void
  #server?: Server
  #pending = new Map<string, PendingReply>()

  async start(): Promise<void> {
    this.#server = createServer((req, res) => { void this.#handle(req, res) })
    await new Promise<void>(resolve => {
      this.#server!.once('error', err => {
        process.stderr.write(`nimbus api: disabled (${String(err)})\n`)
        resolve()
      })
      this.#server!.listen(API_CHANNEL_PORT, API_CHANNEL_HOST, () => {
        process.stderr.write(`nimbus api: listening on http://${API_CHANNEL_HOST}:${API_CHANNEL_PORT}\n`)
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
    return `api-send-${randomUUID()}`
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
      pending.resolve('⚠️ nimbus api shutting down')
    }
  }

  async #handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, { ok: true, channel: 'api' })
      return
    }
    // OpenAI-compatible endpoint so OpenAI clients (wechat-io, Hermes) can route
    // to the nimbus investment brain by pointing base_url here.
    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
      await this.#handleOpenAI(req, res)
      return
    }
    if (req.method !== 'POST' || url.pathname !== '/chat') {
      sendJson(res, 404, { ok: false, error: 'not found' })
      return
    }
    if (API_CHANNEL_TOKEN) {
      const auth = req.headers.authorization ?? ''
      if (auth !== `Bearer ${API_CHANNEL_TOKEN}`) {
        sendJson(res, 401, { ok: false, error: 'unauthorized' })
        return
      }
    }
    if (!this.#handler) {
      sendJson(res, 503, { ok: false, error: 'dispatcher not ready' })
      return
    }
    try {
      const raw = await readBody(req)
      const body = JSON.parse(raw || '{}') as Record<string, unknown>
      const text = typeof body.text === 'string' ? body.text.trim() : ''
      if (!text) {
        sendJson(res, 400, { ok: false, error: '`text` is required' })
        return
      }
      const chatId = typeof body.session_id === 'string' && body.session_id.trim()
        ? body.session_id.trim()
        : `api:${randomUUID()}`
      const messageId = `api-msg-${randomUUID()}`
      const reply = await this.#submit({
        channel: this.id,
        chatId,
        messageId,
        user: typeof body.user === 'string' ? body.user : 'api',
        userId: typeof body.user_id === 'string' ? body.user_id : 'api',
        ts: new Date().toISOString(),
        content: text,
      })
      sendJson(res, 200, { ok: true, session_id: chatId, reply })
    } catch (err) {
      sendJson(res, 500, { ok: false, error: String(err) })
    }
  }

  async #handleOpenAI(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (API_CHANNEL_TOKEN) {
      const auth = req.headers.authorization ?? ''
      if (auth !== `Bearer ${API_CHANNEL_TOKEN}`) {
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
      const messages = Array.isArray(body.messages) ? (body.messages as Array<{ role?: string; content?: unknown }>) : []
      const lastUser = [...messages].reverse().find(m => m.role === 'user')
      const text = typeof lastUser?.content === 'string' ? lastUser.content.trim() : ''
      if (!text) {
        sendJson(res, 400, { error: { message: '`messages` must include a user message', type: 'invalid_request_error' } })
        return
      }
      // session id: OpenAI has no field for it; accept a custom one or hash-less uuid.
      const sessionId = typeof body.user === 'string' && body.user.trim() ? `oa:${body.user.trim()}` : `oa:${randomUUID()}`
      const model = typeof body.model === 'string' ? body.model : 'nimbus-investment'
      const reply = await this.#submit({
        channel: this.id,
        chatId: sessionId,
        messageId: `api-msg-${randomUUID()}`,
        user: 'openai',
        userId: 'api', // non-owner: trade/account capabilities stay gated by PermissionBroker
        ts: new Date().toISOString(),
        content: text,
      })
      sendJson(res, 200, {
        id: `chatcmpl-${randomUUID()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }],
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
        resolve('⚠️ nimbus api timeout')
      }, 180_000)
      this.#pending.set(msg.messageId, { resolve, timer, chunks: [] })
      this.#handler?.(msg)
    })
  }
}
