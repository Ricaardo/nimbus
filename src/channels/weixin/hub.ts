/**
 * weixin/hub.ts — thin client for the local weixin-hub daemon.
 *
 * Posts flattened text to the hub's /send so nimbus can mirror proactive pushes
 * (reports/alerts) to the owner's personal WeChat. Fire-and-forget: hub failures
 * are swallowed and never affect the primary Discord send. No LLM dependency —
 * the hub does the iLink delivery and the markdown→plain flattening.
 */

import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { WEIXIN_HUB_URL } from '../../config.js'
import { buildEnvelope, toWeixinHub } from '../pushEnvelope.js'

function loadHubToken(): string {
  const env = process.env.WEIXIN_HUB_TOKEN?.trim()
  if (env) return env
  const file = process.env.WEIXIN_HUB_TOKEN_FILE ?? join(homedir(), '.weixin-hub', 'api_token.txt')
  try {
    return readFileSync(file, 'utf8').trim()
  } catch {
    return ''
  }
}

const HUB_TOKEN = loadHubToken()
const SEND_URL = `${WEIXIN_HUB_URL.replace(/\/+$/, '')}/send`

export interface HubPush {
  text: string
  title?: string
  source?: string
  priority?: 'now' | 'digest'
  /** Target chat (iLink user id). Empty → hub's default self-target.
   *  Used by Phase-2 two-way replies to answer the chat that messaged in. */
  to?: string
}

/** Push to the weixin-hub. Resolves true on accept, false on any failure
 *  (never throws — callers treat WeChat delivery as best-effort). */
export async function pushToHub(p: HubPush): Promise<boolean> {
  if (!p.text?.trim() && !p.title?.trim()) return false
  // Construct a PushEnvelope v1 and map it to the hub /send payload. This adds a
  // stable request_id (content hash) for hub-side dedup and keeps nimbus/news on
  // one push contract; delivery stays best-effort fire-and-forget.
  let body: Record<string, string>
  try {
    body = toWeixinHub(
      buildEnvelope({
        source: p.source ?? 'Cici',
        text: p.text ?? '',
        title: p.title,
        priority: p.priority ?? 'now',
        channel_hint: 'weixin-hub',
        to: p.to,
      }),
    )
  } catch {
    return false
  }
  try {
    const res = await fetch(SEND_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(HUB_TOKEN ? { Authorization: `Bearer ${HUB_TOKEN}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    })
    return res.ok
  } catch {
    return false
  }
}
