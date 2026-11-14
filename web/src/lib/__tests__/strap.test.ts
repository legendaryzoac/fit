import { describe, expect, it } from 'vitest'
import { hasVital, strapSummary, type StrapMetrics } from '../strap'

const NOW = new Date(2026, 10, 12, 8, 0).getTime()
const metrics = (over: Partial<StrapMetrics>): StrapMetrics => ({
  recoveries: [],
  sleeps: [],
  steps: [],
  ...over,
})

describe('strapSummary', () => {
  it('summarises a band that publishes a recovery score', () => {
    const summary = strapSummary(
      metrics({
        recoveries: [
          { date: '2026-11-10T12:00:00.000Z', recoveryScore: 60, hrvMs: 70, rhr: 58 },
          { date: '2026-11-11T12:00:00.000Z', recoveryScore: 44, hrvMs: 60, rhr: 62 },
        ],
        sleeps: [{ end: '2026-11-11T11:00:00.000Z', nap: false, inBedMin: 450, performancePct: 88 }],
      }),
      NOW,
    )
    expect(summary).toEqual({
      recovery: 44,
      hrvMs: 60,
      hrvVs30d: -5,
      rhr: 62,
      rhrVs30d: 2,
      sleepHours: 7.5,
      sleepPerformancePct: 88,
    })
  })

  it('summarises a band with no score from its vitals, without inventing one', () => {
    const summary = strapSummary(
      metrics({
        recoveries: [
          { source: 'google', date: '2026-11-10', hrvMs: 50, rhr: 56 },
          { source: 'google', date: '2026-11-11', hrvMs: 46, rhr: 54, spo2Pct: 96 },
        ],
        sleeps: [{ source: 'google', end: '2026-11-11T11:30:00.000Z', nap: false, inBedMin: 480 }],
      }),
      NOW,
    )
    expect(summary).toEqual({ hrvMs: 46, hrvVs30d: -2, rhr: 54, rhrVs30d: -1, sleepHours: 8 })
    expect(summary).not.toHaveProperty('recovery')
  })

  it('skips an empty newest day and reads the last one with something measured', () => {
    const summary = strapSummary(
      metrics({
        recoveries: [
          { date: '2026-11-11T12:00:00.000Z', recoveryScore: 71, hrvMs: 66 },
          { date: '2026-11-12T12:00:00.000Z', scoreState: 'PENDING_SCORE' },
        ],
      }),
      NOW,
    )
    expect(summary?.recovery).toBe(71)
  })

  it('is null when there is nothing, or the newest reading is over two days old', () => {
    expect(strapSummary(metrics({ recoveries: null }), NOW)).toBeNull()
    expect(strapSummary(metrics({}), NOW)).toBeNull()
    expect(
      strapSummary(metrics({ recoveries: [{ date: '2026-11-08', hrvMs: 50 }] }), NOW),
    ).toBeNull()
    // Two days back by the calendar is still current
    expect(
      strapSummary(metrics({ recoveries: [{ date: '2026-11-10', hrvMs: 50 }] }), NOW),
    ).not.toBeNull()
  })
})

describe('hasVital', () => {
  it('needs a score, HRV or resting heart rate', () => {
    expect(hasVital({ date: '2026-11-11', spo2Pct: 96 })).toBe(false)
    expect(hasVital({ date: '2026-11-11', rhr: 54 })).toBe(true)
    expect(hasVital({ date: '2026-11-11', recoveryScore: 0 })).toBe(true)
  })
})
