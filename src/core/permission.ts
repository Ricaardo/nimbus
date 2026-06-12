/**
 * permission.ts — Human-in-the-loop approval over a chat channel.
 *
 * When the agent attempts an ASK-listed operation (see safety.ts), canUseTool
 * calls the broker's `request()`, which posts a prompt to the user's chat and
 * blocks until they reply `y <code>` / `n <code>` (or it times out → deny).
 *
 * The reply must JUMP THE QUEUE: the agent run holding the per-chat serial slot
 * is blocked waiting on this promise, so the approval reply cannot be processed
 * through the normal queued path. The dispatcher calls `tryResolve()` at the top
 * of dispatch(), before enqueuing — mirroring the official plugin's intercept.
 */

import { randomBytes } from 'crypto'

type Pending = {
  resolve: (ok: boolean) => void
  timer: ReturnType<typeof setTimeout>
}

/** Matches a permission reply: "y ab12" / "yes ab12" / "n ab12" / "no ab12". */
export const PERMISSION_REPLY_RE = /^\s*(y|yes|n|no)\s+([a-z0-9]{4})\s*$/i

export type SendFn = (channel: string, chatId: string, text: string) => Promise<string>

export class PermissionBroker {
  #pending = new Map<string, Pending>()
  #send: SendFn
  #timeoutMs: number

  constructor(send: SendFn, timeoutMs = 120_000) {
    this.#send = send
    this.#timeoutMs = timeoutMs
  }

  /**
   * Ask the user to approve a tool call. Posts to their chat, resolves true on
   * `y <code>`, false on `n <code>` or timeout.
   */
  async request(channel: string, chatId: string, toolName: string, summary: string): Promise<boolean> {
    const code = randomBytes(2).toString('hex') // 4 hex chars
    const secs = Math.round(this.#timeoutMs / 1000)
    const text =
      `🔐 **需要你批准一个操作**\n` +
      `工具:\`${toolName}\`\n` +
      (summary ? `内容:${summary}\n` : '') +
      `回复 \`y ${code}\` 批准 · \`n ${code}\` 拒绝（${secs}s 内未回复自动拒绝）`
    await this.#send(channel, chatId, text).catch(() => {})

    return new Promise<boolean>(resolve => {
      const timer = setTimeout(() => {
        this.#pending.delete(code)
        resolve(false)
      }, this.#timeoutMs)
      // Allow the process to exit even if a request is pending.
      if (typeof timer === 'object' && 'unref' in timer) (timer as { unref: () => void }).unref()
      this.#pending.set(code, { resolve, timer })
    })
  }

  /**
   * If `content` is a permission reply for a pending request, resolve it and
   * return true (message consumed). Otherwise return false.
   */
  tryResolve(content: string): boolean {
    const m = PERMISSION_REPLY_RE.exec(content)
    if (!m) return false
    const code = m[2]!.toLowerCase()
    const p = this.#pending.get(code)
    if (!p) return false
    clearTimeout(p.timer)
    this.#pending.delete(code)
    p.resolve(/^y/i.test(m[1]!))
    return true
  }

  get pendingCount(): number {
    return this.#pending.size
  }
}
