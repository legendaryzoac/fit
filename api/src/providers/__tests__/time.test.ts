import { describe, expect, it } from 'vitest'
import { civilToUtc, isoDate, toOffset, toUtcIso, utcDay } from '../time'

describe('time helpers', () => {
  it('writes instants as UTC ISO with milliseconds', () => {
    expect(toUtcIso('2026-11-11T11:30:00Z')).toBe('2026-11-11T11:30:00.000Z')
    expect(toUtcIso('2026-11-11T06:30:00-05:00')).toBe('2026-11-11T11:30:00.000Z')
  })

  it('turns a seconds duration into a ±HH:MM offset', () => {
    expect(toOffset('-14400s')).toBe('-04:00')
    expect(toOffset('19800s')).toBe('+05:30')
    expect(toOffset('0s')).toBe('+00:00')
    expect(toOffset(-18000)).toBe('-05:00')
    expect(toOffset(undefined)).toBeUndefined()
    expect(toOffset('soon')).toBeUndefined()
  })

  it('formats and shifts civil days', () => {
    expect(isoDate({ year: 2026, month: 3, day: 7 })).toBe('2026-03-07')
    const at = new Date('2026-03-01T02:00:00Z')
    expect(utcDay(at)).toEqual({ year: 2026, month: 3, day: 1 })
    expect(utcDay(at, -1)).toEqual({ year: 2026, month: 2, day: 28 })
    expect(civilToUtc({ year: 2026, month: 3, day: 1 }).toISOString()).toBe(
      '2026-03-01T00:00:00.000Z',
    )
  })
})
