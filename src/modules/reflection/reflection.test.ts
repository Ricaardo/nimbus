import { describe, test, expect } from 'bun:test'
import { reflectionModules, parseLessons, parseClosures } from './index.js'

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

  test('parseLessons stops at the ===CLOSE=== machine block', () => {
    const out = parseLessons('报告\n===LESSONS===\n- 教训甲很重要\n===CLOSE=== [{"id":1,"outcome":"win"}]')
    expect(out).toHaveLength(1)
    expect(out[0]).toContain('教训甲')
  })

  test('parseClosures parses the CLOSE JSON array', () => {
    const out = parseClosures('报告\n===LESSONS===\n- x\n===CLOSE=== [{"id":3,"outcome":"兑现+12%"},{"id":7,"outcome":"止损-8%"}]')
    expect(out).toEqual([{ id: 3, outcome: '兑现+12%' }, { id: 7, outcome: '止损-8%' }])
  })

  test('parseClosures empty when no marker / empty array / malformed', () => {
    expect(parseClosures('没有标记')).toHaveLength(0)
    expect(parseClosures('===CLOSE=== []')).toHaveLength(0)
    expect(parseClosures('===CLOSE=== {not json}')).toHaveLength(0)
  })

  test('parseClosures drops entries without a numeric id', () => {
    const out = parseClosures('===CLOSE=== [{"outcome":"无id"},{"id":5,"outcome":"ok"}]')
    expect(out).toEqual([{ id: 5, outcome: 'ok' }])
  })
})
