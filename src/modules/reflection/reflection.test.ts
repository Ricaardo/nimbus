import { describe, test, expect } from 'bun:test'
import { reflectionModules, parseLessons } from './index.js'

describe('reflection module', () => {
  test('is a weekly cron module', () => {
    const m = reflectionModules[0]!
    expect(m.name).toBe('reflection:weekly')
    expect(typeof m.cron).toBe('string')
  })

  test('parseLessons extracts bullets after marker', () => {
    const out = parseLessons('复盘正文…\n===LESSONS===\n- 逆势接飞刀又犯了，下次等右侧确认\n- SOXL 别装多日观点\n')
    expect(out).toHaveLength(2)
    expect(out[0]).toContain('右侧确认')
    expect(out[1]).toContain('SOXL')
  })

  test('parseLessons empty when no marker / empty block', () => {
    expect(parseLessons('只有报告没有标记')).toHaveLength(0)
    expect(parseLessons('报告\n===LESSONS===\n')).toHaveLength(0)
  })
})
