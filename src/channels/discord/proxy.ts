// ── proxy.ts — MUST be the first module evaluated in the process ──
// This file runs its top-level side-effect (WebSocket override + proxy setup)
// BEFORE discord.js is ever imported. main.ts imports this first.
// No other file may statically import 'discord.js' — use loadDiscordJs() instead.

import { WebSocket as WsWebSocket } from 'ws'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { ProxyAgent } from 'undici'
import { PROXY_URL } from '../../config.js'

export let proxyAgent: InstanceType<typeof ProxyAgent> | undefined

if (PROXY_URL) {
  const agent = new HttpsProxyAgent(PROXY_URL)
  proxyAgent = new ProxyAgent(PROXY_URL)
  process.stderr.write(`nimbus: using proxy: ${PROXY_URL}\n`)

  // Override globalThis.WebSocket with proxy-aware ws before discord.js loads.
  // @ts-ignore
  globalThis.WebSocket = class ProxiedWebSocket extends WsWebSocket {
    constructor(url: string | URL, protocols?: string | string[], options?: object) {
      super(url, protocols as any, { ...options, agent })
    }
  } as any
}

// Dynamic import discord.js — call this instead of any static import.
// Must be called AFTER this module's top-level side-effects have run.
export async function loadDiscordJs(): Promise<typeof import('discord.js')> {
  return await import('discord.js')
}
