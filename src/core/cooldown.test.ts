/**
 * cooldown.test.ts — Unit tests for DB getCooldown / setCooldown (M6 Batch 1).
 *
 * Tests in-memory and on-disk persistence of alert cooldowns.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { openDb } from './db.js'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// ── In-memory: basic get/set ──────────────────────────────────────────────────

describe('getCooldown / setCooldown — in-memory', () => {
  test('getCooldown returns null for unknown key', () => {
    const db = openDb(':memory:')
    expect(db.getCooldown('stop_hit:AVGO')).toBeNull()
    db.close()
  })

  test('setCooldown then getCooldown returns the stored timestamp', () => {
    const db = openDb(':memory:')
    const ts = Date.now()
    db.setCooldown('stop_hit:AVGO', ts)
    expect(db.getCooldown('stop_hit:AVGO')).toBe(ts)
    db.close()
  })

  test('setCooldown is idempotent (upserts on second call)', () => {
    const db = openDb(':memory:')
    const ts1 = Date.now()
    const ts2 = ts1 + 5000
    db.setCooldown('concentration_breach:semis', ts1)
    db.setCooldown('concentration_breach:semis', ts2)
    expect(db.getCooldown('concentration_breach:semis')).toBe(ts2)
    db.close()
  })

  test('different keys are independent', () => {
    const db = openDb(':memory:')
    const ts1 = 1000000
    const ts2 = 2000000
    db.setCooldown('key:A', ts1)
    db.setCooldown('key:B', ts2)
    expect(db.getCooldown('key:A')).toBe(ts1)
    expect(db.getCooldown('key:B')).toBe(ts2)
    db.close()
  })
})

// ── On-disk persistence (restart simulation) ──────────────────────────────────

describe('getCooldown / setCooldown — on-disk persistence', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'nimbus-cooldown-test-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test('cooldown survives close + reopen', () => {
    const dbPath = join(tmpDir, 'state.db')
    const ts = Date.now()

    const db1 = openDb(dbPath)
    db1.setCooldown('thesis_decay:MRVL', ts)
    db1.close()

    const db2 = openDb(dbPath)
    const stored = db2.getCooldown('thesis_decay:MRVL')
    db2.close()

    expect(stored).toBe(ts)
  })

  test('unknown key still returns null after reopen', () => {
    const dbPath = join(tmpDir, 'state.db')

    const db1 = openDb(dbPath)
    db1.setCooldown('key:X', 12345)
    db1.close()

    const db2 = openDb(dbPath)
    expect(db2.getCooldown('key:Y')).toBeNull()
    db2.close()
  })
})
