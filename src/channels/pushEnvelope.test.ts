import { describe, expect, test } from 'bun:test'
import { buildEnvelope, validateEnvelope } from './pushEnvelope.js'

describe('pushEnvelope', () => {
  test('buildEnvelope fills version, priority and a stable request_id', () => {
    const a = buildEnvelope({ source: 'Cici', text: 'hello' })
    const b = buildEnvelope({ source: 'Cici', text: 'hello' })
    expect(a.version).toBe(1)
    expect(a.priority).toBe('now')
    expect(a.request_id).toBe(b.request_id) // content hash is deterministic
    expect(a.request_id.startsWith('h:')).toBe(true)
  })

  test('explicit request_id is preserved', () => {
    const env = buildEnvelope({ source: 'news', text: 'x', request_id: 'evt-1' })
    expect(env.request_id).toBe('evt-1')
  })

  test('validateEnvelope rejects empty payloads', () => {
    expect(() => validateEnvelope({ version: 1, request_id: 'x', source: 'a', text: '', priority: 'now' })).toThrow()
  })
})
