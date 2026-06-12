/**
 * quote/index.ts — L0 market-data fast path (M7).
 *
 * Fetches real-time quotes by shell-calling the futu get_snapshot.py script
 * directly, bypassing the agent entirely.  This is an intentional L0 bypass:
 * the script is stateless, read-only, and produces no investment decisions.
 *
 * Flow:
 *  1. TCP probe 127.0.0.1:11111 (OpenD).  Timeout: 2 s.
 *  2. If OpenD is reachable: run get_snapshot.py, parse JSON, format output.
 *  3. If OpenD is down or script fails: attempt yfinance fallback via quote.py.
 *     (Note: fallback script requires trading_skills module; if unavailable,
 *      error text is returned — degradation is graceful.)
 *  4. All errors: return a short error string (never throws to caller).
 *
 * The spawn function is injectable for unit tests (SpawnFn / TcpCheckFn).
 */

import * as net from 'net'
import { spawn } from 'child_process'
import type { ChildProcess } from 'child_process'
import {
  OPEND_HOST,
  OPEND_PORT,
  FUTU_SNAPSHOT_SCRIPT,
  MARKET_DATA_QUOTE_SCRIPT,
  QUOTE_TIMEOUT_MS,
  PYTHON_BIN,
} from '../../config.js'

// ── Injectable seams for testing ──────────────────────────────────────────────

/**
 * Minimal shape of the spawn function needed by fetchQuotes.
 * Narrower than typeof spawn — avoids overload complexity in tests.
 */
export type SpawnFn = (cmd: string, args: string[], options: { stdio: string[] }) => ChildProcess

/** Shape of a TCP probe (injectable in tests). */
export type TcpCheckFn = (host: string, port: number, timeoutMs: number) => Promise<boolean>

// ── TCP probe ─────────────────────────────────────────────────────────────────

/**
 * Check whether a TCP port is accepting connections.
 * Returns true if connected within timeoutMs, false otherwise.
 */
export function defaultTcpCheck(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = new net.Socket()
    let settled = false

    const done = (ok: boolean): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(ok)
    }

    socket.setTimeout(timeoutMs)
    socket.connect(port, host, () => done(true))
    socket.on('error', () => done(false))
    socket.on('timeout', () => done(false))
  })
}

// ── Process runner ────────────────────────────────────────────────────────────

/** Run a command, return { stdout, stderr, exitCode } with a timeout. */
function runProcess(
  cmd: string,
  args: string[],
  timeoutMs: number,
  spawnFn: SpawnFn,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise(resolve => {
    const proc = spawnFn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] }) as ChildProcess
    let stdout = ''
    let stderr = ''
    let finished = false

    const finish = (code: number): void => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      resolve({ stdout, stderr, exitCode: code })
    }

    const timer = setTimeout(() => {
      proc.kill('SIGTERM')
      finish(1)
    }, timeoutMs)

    proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString() })
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
    proc.on('close', (code: number | null) => finish(code ?? 1))
    proc.on('error', () => finish(1))
  })
}

// ── Output formatters ─────────────────────────────────────────────────────────

interface SnapshotItem {
  code?: string
  name?: string
  last_price?: number
  prev_close?: number
  volume?: number
  turnover?: number
  [key: string]: unknown
}

/** Format a single snapshot item into a one-line summary.
 *  Uses middot separators (single spaces collapse in Discord markdown rendering)
 *  and a 📈/📉/➖ direction marker so the move reads at a glance on mobile. */
function formatItem(item: SnapshotItem): string {
  const name = item.name ?? item.code ?? '?'
  const code = item.code ?? ''
  const last = item.last_price ?? 0
  const prev = item.prev_close ?? 0
  const diff = last - prev
  const chg = prev > 0 ? (diff / prev) * 100 : 0
  const sign = chg >= 0 ? '+' : ''
  const arrow = chg > 0 ? '📈' : chg < 0 ? '📉' : '➖'
  const vol = item.volume != null ? formatVolume(item.volume) : '-'

  return `${arrow} **${name}** (${code}) · 现价 **${last.toFixed(2)}** · ${sign}${chg.toFixed(2)}% (${sign}${diff.toFixed(2)}) · 量 ${vol}`
}

function formatVolume(v: number): string {
  if (v >= 1e8) return `${(v / 1e8).toFixed(1)}亿`
  if (v >= 1e4) return `${(v / 1e4).toFixed(1)}万`
  return String(v)
}

/** Parse futu get_snapshot.py --json stdout into structured items.
 *  futu writes connection logs to stdout alongside the JSON, so we extract the
 *  JSON line (the one starting with `{`) instead of parsing the whole stream.
 *  Returns [] on parse failure or no data (callers degrade gracefully). */
function parseFutuItems(stdout: string): SnapshotItem[] {
  const jsonLine = stdout
    .split('\n')
    .map(l => l.trim())
    .find(l => l.startsWith('{') && l.includes('"data"'))
  try {
    const data = JSON.parse(jsonLine ?? stdout.trim()) as { data?: SnapshotItem[] }
    return data.data ?? []
  } catch {
    return []
  }
}

/** Parse futu snapshot stdout and return formatted lines (or a ⚠️ string). */
function parseFutuOutput(stdout: string, symbols: string[]): string {
  const items = parseFutuItems(stdout)
  if (items.length === 0) {
    return `⚠️ 行情解析失败或无数据 (${symbols.join(', ')})`
  }
  return items.map(formatItem).join('\n')
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Fetch real-time quotes for the given futu-format symbols.
 *
 * L0 fast path — does NOT go through the agent or canUseTool.
 * This is intentional: get_snapshot.py is read-only and stateless.
 *
 * @param symbols - futu-format codes, e.g. ["US.NVDA", "HK.00700"]
 * @param spawnFn - injectable spawn (default: child_process.spawn)
 * @param tcpCheck - injectable TCP probe (default: defaultTcpCheck)
 */
export async function fetchQuotes(
  symbols: string[],
  spawnFn: SpawnFn = spawn as unknown as SpawnFn,
  tcpCheck: TcpCheckFn = defaultTcpCheck,
): Promise<string> {
  if (symbols.length === 0) return '⚠️ 没有可查询的标的'

  // 1. TCP probe OpenD
  const opendUp = await tcpCheck(OPEND_HOST, OPEND_PORT, 2000)

  if (opendUp) {
    // 2. Run futu get_snapshot.py
    const { stdout, exitCode } = await runProcess(
      PYTHON_BIN,
      [FUTU_SNAPSHOT_SCRIPT, ...symbols, '--json'],
      QUOTE_TIMEOUT_MS,
      spawnFn,
    )

    if (exitCode === 0 && stdout.trim()) {
      return parseFutuOutput(stdout, symbols)
    }
    // futu script failed — fall through to fallback
  }

  // 3. Fallback: yfinance via market-data quote.py (one symbol at a time)
  const results: string[] = []
  for (const sym of symbols) {
    const { stdout, exitCode } = await runProcess(
      PYTHON_BIN,
      [MARKET_DATA_QUOTE_SCRIPT, sym],
      QUOTE_TIMEOUT_MS,
      spawnFn,
    )

    if (exitCode === 0 && stdout.trim()) {
      // quote.py prints JSON — try to extract a price line
      try {
        const obj = JSON.parse(stdout.trim()) as Record<string, unknown>
        const price = obj['price'] ?? obj['last_price'] ?? obj['regularMarketPrice'] ?? obj['close']
        const name = obj['name'] ?? obj['shortName'] ?? sym
        if (price != null) {
          results.push(`**${name}** (${sym}) · 现价 **${price}**`)
          continue
        }
      } catch {
        // not JSON — use raw stdout trimmed to first line
        const line = stdout.trim().split('\n')[0]
        if (line) { results.push(`${sym}: ${line}`); continue }
      }
    }

    results.push(`⚠️ ${sym} 行情获取失败`)
  }

  if (results.length === 0) return '⚠️ 行情服务暂时不可用'
  return results.join('\n')
}

/**
 * Fetch structured snapshots for the given futu-format symbols (futu/OpenD only,
 * no yfinance fallback — intended for the alert price-probe where speed and a
 * clean numeric result matter more than coverage).
 *
 * Returns [] if OpenD is down or the script fails — callers fall back to the
 * last portfolio_state price, so a probe miss never breaks detection.
 */
export async function fetchSnapshots(
  symbols: string[],
  spawnFn: SpawnFn = spawn as unknown as SpawnFn,
  tcpCheck: TcpCheckFn = defaultTcpCheck,
): Promise<SnapshotItem[]> {
  if (symbols.length === 0) return []
  const opendUp = await tcpCheck(OPEND_HOST, OPEND_PORT, 2000)
  if (!opendUp) return []
  const { stdout, exitCode } = await runProcess(
    PYTHON_BIN,
    [FUTU_SNAPSHOT_SCRIPT, ...symbols, '--json'],
    QUOTE_TIMEOUT_MS,
    spawnFn,
  )
  if (exitCode !== 0 || !stdout.trim()) return []
  return parseFutuItems(stdout)
}

/**
 * Build a fresh { futu-code → last price } map for the given symbols.
 * Empty map on any failure (OpenD down, parse error) — detectors then use the
 * portfolio_state snapshot price unchanged.
 */
export async function fetchPriceMap(
  symbols: string[],
  spawnFn: SpawnFn = spawn as unknown as SpawnFn,
  tcpCheck: TcpCheckFn = defaultTcpCheck,
): Promise<Map<string, number>> {
  const items = await fetchSnapshots(symbols, spawnFn, tcpCheck)
  const map = new Map<string, number>()
  for (const it of items) {
    if (it.code && typeof it.last_price === 'number' && it.last_price > 0) {
      map.set(it.code, it.last_price)
    }
  }
  return map
}
