import { describe, test, expect } from 'bun:test'
import { modelFor } from './models.js'

// pick() is internal; test the public resolver returns a non-empty value per tier
// (fallback aliases before any refresh).
describe('model registry', () => {
  test('modelFor returns a value for each tier (fallback before refresh)', () => {
    expect(modelFor('haiku')).toBeTruthy()
    expect(modelFor('sonnet')).toBeTruthy()
    expect(modelFor('opus')).toBeTruthy()
  })
  test('tiers map to distinct families by default', () => {
    expect(modelFor('haiku')).toContain('haiku')
    expect(modelFor('sonnet')).toContain('sonnet')
    expect(modelFor('opus')).toContain('opus')
  })
})
