import { describe, expect, it } from 'vitest'
import { dayTime, localDate } from '../metrics'

describe('localDate', () => {
  it("shifts a UTC instant into the wearer's day", () => {
    // 03:30 UTC is still the evening before at -05:00
    expect(localDate('2026-11-11T03:30:00.000Z', '-05:00')).toBe('2026-11-10')
    expect(localDate('2026-11-10T20:00:00.000Z', '+05:30')).toBe('2026-11-11')
    expect(localDate('2026-11-11T11:30:00.000Z', '+00:00')).toBe('2026-11-11')
  })

  it('falls back to the UTC date without a usable offset', () => {
    expect(localDate('2026-11-11T03:30:00.000Z')).toBe('2026-11-11')
    expect(localDate('2026-11-11T03:30:00.000Z', 'Z')).toBe('2026-11-11')
  })
})

describe('dayTime', () => {
  it('reads a bare date as local noon of that day', () => {
    const at = new Date(dayTime('2026-11-11'))
    expect([at.getFullYear(), at.getMonth(), at.getDate(), at.getHours()]).toEqual([
      2026, 10, 11, 12,
    ])
  })

  it('takes a full timestamp as it is', () => {
    expect(dayTime('2026-11-11T11:25:44.774Z')).toBe(Date.parse('2026-11-11T11:25:44.774Z'))
  })
})
