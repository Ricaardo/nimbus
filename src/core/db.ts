/**
 * db.ts — SQLite persistence layer (Batch C).
 *
 * Opens (or creates) the state.db file at DB_PATH and exposes the DB interface
 * defined in modules/module.ts. All statements are prepared at open time for
 * performance. Payload strings are truncated at 8000 characters to prevent
 * audit table bloat / sensitive full-text retention.
 */

import { mkdirSync } from 'fs'
import { Database } from 'bun:sqlite'
import { DATA_DIR, DB_PATH } from '../config.js'
import type { DB } from '../modules/module.js'

const PAYLOAD_LIMIT = 8000

function truncate(s: string): string {
  if (s.length <= PAYLOAD_LIMIT) return s
  return s.slice(0, PAYLOAD_LIMIT) + '…[truncated]'
}

// ── SqliteDB ──────────────────────────────────────────────────────────────────

class SqliteDB implements DB {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
    this.#init()
  }

  #init(): void {
    this.#db.run('PRAGMA journal_mode = WAL')

    this.#db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        channel        TEXT NOT NULL,
        chat_id        TEXT NOT NULL,
        sdk_session_id TEXT,
        cwd            TEXT,
        model          TEXT,
        updated_at     INTEGER NOT NULL,
        PRIMARY KEY (channel, chat_id)
      )
    `)

    this.#db.run(`
      CREATE TABLE IF NOT EXISTS audit (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        ts      INTEGER NOT NULL,
        channel TEXT,
        chat_id TEXT,
        user    TEXT,
        kind    TEXT,
        payload TEXT
      )
    `)

    this.#db.run(`
      CREATE TABLE IF NOT EXISTS jobs (
        name        TEXT PRIMARY KEY,
        cron        TEXT NOT NULL,
        target_chat TEXT NOT NULL,
        last_run    INTEGER,
        last_status TEXT
      )
    `)

    this.#db.run(`
      CREATE TABLE IF NOT EXISTS alert_cooldowns (
        key        TEXT PRIMARY KEY,
        last_fired INTEGER NOT NULL
      )
    `)

    // Small persistent key→value store (NAV high-water mark, etc.).
    this.#db.run(`
      CREATE TABLE IF NOT EXISTS kv (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `)

    this.#db.run(`
      CREATE TABLE IF NOT EXISTS usage (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        ts                INTEGER NOT NULL,
        model             TEXT,
        cost_usd          REAL,
        input_tokens      INTEGER,
        output_tokens     INTEGER,
        cache_read_tokens INTEGER
      )
    `)
    // Migrate: add cache_read_tokens to a pre-existing usage table (harmless if present).
    try { this.#db.run('ALTER TABLE usage ADD COLUMN cache_read_tokens INTEGER') } catch { /* column exists */ }

    // Decision ledger (可问责顾问):每条明确交易建议留痕 → 周反思对照结果。
    this.#db.run(`
      CREATE TABLE IF NOT EXISTS decisions (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        ts        INTEGER NOT NULL,
        channel   TEXT, chat_id TEXT,
        symbol    TEXT NOT NULL,
        direction TEXT,
        rationale TEXT,
        status    TEXT NOT NULL DEFAULT 'open',
        closed_ts INTEGER,
        outcome   TEXT
      )
    `)

    // Phase 2: persistent user memory. kind ∈ preference|profile|decision|lesson.
    // 'active' allows soft-delete / revision (防"学歪"可回滚). slug dedups imports.
    this.#db.run(`
      CREATE TABLE IF NOT EXISTS memories (
        id     INTEGER PRIMARY KEY AUTOINCREMENT,
        ts     INTEGER NOT NULL,
        kind   TEXT NOT NULL,
        slug   TEXT,
        text   TEXT NOT NULL,
        source TEXT,
        active INTEGER NOT NULL DEFAULT 1
      )
    `)
    this.#db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_slug ON memories(slug) WHERE slug IS NOT NULL')
    // 命中率闭环(Tier 3b):记录建议时的研究置信度,周复盘对照结果评校准。
    try { this.#db.run('ALTER TABLE decisions ADD COLUMN confidence TEXT') } catch { /* column exists */ }
    // 自动结算(decision:track):建议时价格快照 + 目标/止损位,供作业按行情自动收口。
    try { this.#db.run('ALTER TABLE decisions ADD COLUMN price_at_decision REAL') } catch { /* column exists */ }
    try { this.#db.run('ALTER TABLE decisions ADD COLUMN target REAL') } catch { /* column exists */ }
    try { this.#db.run('ALTER TABLE decisions ADD COLUMN stop REAL') } catch { /* column exists */ }
  }

  getSession(channel: string, chatId: string): { sdkSessionId?: string; model?: string; cwd?: string } | null {
    const stmt = this.#db.prepare<{ sdk_session_id: string | null; model: string | null; cwd: string | null }, [string, string]>(
      'SELECT sdk_session_id, model, cwd FROM sessions WHERE channel = ? AND chat_id = ?',
    )
    const row = stmt.get(channel, chatId)
    if (!row) return null
    return {
      sdkSessionId: row.sdk_session_id ?? undefined,
      model: row.model ?? undefined,
      cwd: row.cwd ?? undefined,
    }
  }

  putSession(
    channel: string,
    chatId: string,
    data: { sdkSessionId: string; model?: string; cwd?: string },
  ): void {
    const stmt = this.#db.prepare(
      `INSERT INTO sessions (channel, chat_id, sdk_session_id, model, cwd, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (channel, chat_id) DO UPDATE SET
         sdk_session_id = excluded.sdk_session_id,
         model          = excluded.model,
         cwd            = excluded.cwd,
         updated_at     = excluded.updated_at`,
    )
    stmt.run(channel, chatId, data.sdkSessionId, data.model ?? null, data.cwd ?? null, Date.now())
  }

  clearSession(channel: string, chatId: string): void {
    this.#db.prepare('DELETE FROM sessions WHERE channel = ? AND chat_id = ?').run(channel, chatId)
  }

  audit(row: {
    channel: string
    chatId: string
    user?: string
    kind: 'in' | 'out' | 'tool' | 'error'
    payload: string
  }): void {
    const stmt = this.#db.prepare(
      'INSERT INTO audit (ts, channel, chat_id, user, kind, payload) VALUES (?, ?, ?, ?, ?, ?)',
    )
    stmt.run(Date.now(), row.channel, row.chatId, row.user ?? null, row.kind, truncate(row.payload))
  }

  getJob(name: string): { cron: string; targetChat: string; lastRun: number | null; lastStatus: string | null } | null {
    const stmt = this.#db.prepare<{ cron: string; target_chat: string; last_run: number | null; last_status: string | null }, [string]>(
      'SELECT cron, target_chat, last_run, last_status FROM jobs WHERE name = ?',
    )
    const row = stmt.get(name)
    if (!row) return null
    return {
      cron: row.cron,
      targetChat: row.target_chat,
      lastRun: row.last_run,
      lastStatus: row.last_status,
    }
  }

  upsertJob(job: { name: string; cron: string; targetChat: string }): void {
    const stmt = this.#db.prepare(
      `INSERT INTO jobs (name, cron, target_chat)
       VALUES (?, ?, ?)
       ON CONFLICT (name) DO UPDATE SET
         cron        = excluded.cron,
         target_chat = excluded.target_chat`,
    )
    stmt.run(job.name, job.cron, job.targetChat)
  }

  markJobRun(name: string, status: string): void {
    const stmt = this.#db.prepare(
      'UPDATE jobs SET last_run = ?, last_status = ? WHERE name = ?',
    )
    const result = stmt.run(Date.now(), status, name)
    if ((result as { changes?: number }).changes === 0) {
      process.stderr.write(`nimbus: markJobRun: no row for "${name}"\n`)
    }
  }

  getCooldown(key: string): number | null {
    const stmt = this.#db.prepare<{ last_fired: number }, [string]>(
      'SELECT last_fired FROM alert_cooldowns WHERE key = ?',
    )
    const row = stmt.get(key)
    return row ? row.last_fired : null
  }

  setCooldown(key: string, ts: number): void {
    const stmt = this.#db.prepare(
      `INSERT INTO alert_cooldowns (key, last_fired) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET last_fired = excluded.last_fired`,
    )
    stmt.run(key, ts)
  }

  getKv(key: string): string | null {
    const row = this.#db
      .prepare<{ value: string }, [string]>('SELECT value FROM kv WHERE key = ?')
      .get(key)
    return row ? row.value : null
  }

  setKv(key: string, value: string): void {
    this.#db
      .prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
      .run(key, value)
  }

  // ── Usage tracking (Phase 1 省额度可见性) — concrete, not on DB interface ──────

  logUsage(row: { model: string; costUsd: number; inputTokens: number; outputTokens: number; cacheReadTokens?: number }): void {
    const stmt = this.#db.prepare(
      'INSERT INTO usage (ts, model, cost_usd, input_tokens, output_tokens, cache_read_tokens) VALUES (?, ?, ?, ?, ?, ?)',
    )
    stmt.run(Date.now(), row.model, row.costUsd, row.inputTokens, row.outputTokens, row.cacheReadTokens ?? 0)
  }

  // ── Persistent memory (Phase 2) — concrete, accessed via memory.ts store ──────

  /** Store a memory. With a slug, upserts (re-import safe); without, inserts.
   *  UPDATE-then-INSERT avoids ON CONFLICT (the slug index is partial). */
  remember(m: { kind: string; text: string; source?: string; slug?: string }): void {
    if (m.slug) {
      const upd = this.#db
        .prepare('UPDATE memories SET kind=?, text=?, source=?, active=1, ts=? WHERE slug=?')
        .run(m.kind, m.text, m.source ?? null, Date.now(), m.slug)
      if ((upd as { changes?: number }).changes !== 0) return
      this.#db
        .prepare('INSERT INTO memories (ts, kind, slug, text, source, active) VALUES (?, ?, ?, ?, ?, 1)')
        .run(Date.now(), m.kind, m.slug, m.text, m.source ?? null)
    } else {
      this.#db
        .prepare('INSERT INTO memories (ts, kind, slug, text, source, active) VALUES (?, ?, NULL, ?, ?, 1)')
        .run(Date.now(), m.kind, m.text, m.source ?? null)
    }
  }

  /** Active preference/profile memories (always-on context). */
  getPersistent(): string[] {
    const rows = this.#db
      .prepare<{ text: string }, []>(
        "SELECT text FROM memories WHERE active=1 AND kind IN ('preference','profile') ORDER BY kind, id",
      )
      .all()
    return rows.map(r => r.text)
  }

  /** Keyword recall: active memories scored by term overlap with the query. */
  recall(query: string, limit = 4): string[] {
    const terms = (query.toLowerCase().match(/[a-z0-9]+|[一-龥]{2,}/g) ?? []).filter(t => t.length >= 2)
    if (terms.length === 0) return []
    const rows = this.#db
      .prepare<{ text: string; kind: string }, []>(
        "SELECT text, kind FROM memories WHERE active=1 AND kind IN ('decision','lesson')",
      )
      .all()
    const scored = rows
      .map(r => {
        const lt = r.text.toLowerCase()
        const score = terms.reduce((s, t) => (lt.includes(t) ? s + 1 : s), 0)
        return { text: r.text, score }
      })
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
    return scored.map(r => r.text)
  }

  /** Soft-delete a memory by slug (revision / rollback). */
  deactivate(slug: string): void {
    this.#db.prepare('UPDATE memories SET active=0 WHERE slug=?').run(slug)
  }

  // ── Decision ledger (可问责) ───────────────────────────────────────────────

  recordDecision(d: { channel?: string; chatId?: string; symbol: string; direction?: string; rationale?: string; confidence?: string; priceAtDecision?: number; target?: number; stop?: number }): number {
    const result = this.#db
      .prepare('INSERT INTO decisions (ts, channel, chat_id, symbol, direction, rationale, confidence, price_at_decision, target, stop, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \'open\')')
      .run(Date.now(), d.channel ?? null, d.chatId ?? null, d.symbol.toUpperCase(), d.direction ?? null, d.rationale ?? null, d.confidence ?? null, d.priceAtDecision ?? null, d.target ?? null, d.stop ?? null)
    return Number(result.lastInsertRowid)
  }

  /** Open decisions (newest first) for the weekly reflection to score. */
  openDecisions(limit = 30): Array<{ id: number; ts: number; symbol: string; direction: string | null; rationale: string | null; confidence: string | null; price_at_decision: number | null; target: number | null; stop: number | null }> {
    return this.#db
      .prepare<{ id: number; ts: number; symbol: string; direction: string | null; rationale: string | null; confidence: string | null; price_at_decision: number | null; target: number | null; stop: number | null }, [number]>(
        "SELECT id, ts, symbol, direction, rationale, confidence, price_at_decision, target, stop FROM decisions WHERE status='open' ORDER BY id DESC LIMIT ?",
      )
      .all(limit)
  }

  closeDecision(id: number, outcome: string): void {
    this.#db.prepare("UPDATE decisions SET status='closed', closed_ts=?, outcome=? WHERE id=?").run(Date.now(), outcome, id)
  }

  /** Backfill the decision-time price snapshot — only if not already set, so a
   *  late async snapshot never clobbers an earlier (or manually-set) value. */
  updateDecisionPrice(id: number, price: number): void {
    this.#db.prepare('UPDATE decisions SET price_at_decision=? WHERE id=? AND price_at_decision IS NULL').run(price, id)
  }

  /** Per-model usage summary over the last `days` (for the weekly cost report). */
  getUsageSummary(days: number): Array<{ model: string; calls: number; cost: number; inTok: number; outTok: number; cacheRead: number }> {
    const since = Date.now() - days * 86400_000
    return this.#db
      .prepare<{ model: string; calls: number; cost: number; in_tok: number; out_tok: number; cache_read: number }, [number]>(
        `SELECT model,
                COUNT(*)                      AS calls,
                COALESCE(SUM(cost_usd),0)      AS cost,
                COALESCE(SUM(input_tokens),0)  AS in_tok,
                COALESCE(SUM(output_tokens),0) AS out_tok,
                COALESCE(SUM(cache_read_tokens),0) AS cache_read
         FROM usage WHERE ts >= ? GROUP BY model ORDER BY cost DESC`,
      )
      .all(since)
      .map(r => ({ model: r.model, calls: r.calls, cost: r.cost, inTok: r.in_tok, outTok: r.out_tok, cacheRead: r.cache_read }))
  }

  /** Total cost (USD) of agent runs since local midnight today. */
  getTodayCost(): number {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const stmt = this.#db.prepare<{ total: number | null }, [number]>(
      'SELECT SUM(cost_usd) AS total FROM usage WHERE ts >= ?',
    )
    return stmt.get(start.getTime())?.total ?? 0
  }

  close(): void {
    this.#db.close()
  }
}

// ── Factory + default singleton ───────────────────────────────────────────────

/**
 * Open a SqliteDB at the given path.
 * Pass ':memory:' for tests or a tmp file for on-disk persistence tests.
 * Pass a real path (default DB_PATH) for production.
 */
export function openDb(path: string = DB_PATH): SqliteDB {
  if (path !== ':memory:') {
    // Ensure parent directory exists before opening the file.
    const dir = path.replace(/\/[^/]+$/, '')
    if (dir) mkdirSync(dir, { recursive: true })
  }
  const rawDb = new Database(path)
  return new SqliteDB(rawDb)
}

// Lazily-initialised singleton for production use.
let _defaultDb: SqliteDB | undefined

/** Returns (and lazily creates) the default production DB singleton. */
export function defaultDb(): SqliteDB {
  if (!_defaultDb) {
    mkdirSync(DATA_DIR, { recursive: true })
    _defaultDb = openDb(DB_PATH)
  }
  return _defaultDb
}

/** Close the default singleton (call from shutdown handlers). */
export function closeDb(): void {
  _defaultDb?.close()
  _defaultDb = undefined
}
