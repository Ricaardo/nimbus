// One-off (idempotent via slug): import the master's CC feedback memories into
// Nimbus's own memory store, so the agent actually "knows" the accumulated
// preferences/profile (the Agent SDK does NOT load CC auto-memory).
//
// Run: bun run scripts/import-memories.ts
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { openDb } from '../src/core/db.js'

const MEM_DIR = join(homedir(), '.claude', 'projects', '-Users-x', 'memory')

function extractDescription(raw: string): string | null {
  const m = raw.match(/^description:\s*["']?(.+?)["']?\s*$/m)
  if (m) return m[1]!.trim()
  // fallback: first non-empty, non-frontmatter line of the body
  const body = raw.split(/^---\s*$/m).slice(2).join('\n')
  const line = body.split('\n').map(l => l.trim()).find(l => l.length > 0 && !l.startsWith('#'))
  return line ?? null
}

const db = openDb()
let n = 0
for (const f of readdirSync(MEM_DIR)) {
  if (!f.startsWith('feedback_') || !f.endsWith('.md')) continue
  const raw = readFileSync(join(MEM_DIR, f), 'utf8')
  const desc = extractDescription(raw)
  if (!desc) { console.log(`  skip (no desc): ${f}`); continue }
  const slug = `cc:${f.replace(/\.md$/, '')}`
  db.remember({ kind: 'preference', text: desc, source: f, slug })
  console.log(`  ✓ ${slug} — ${desc.slice(0, 70)}`)
  n++
}
console.log(`\nimported/updated ${n} feedback memories. total persistent:`)
console.log(db.getPersistent().length, 'memories now in store')
db.close()
process.exit(0)
