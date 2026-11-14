import { describe, expect, it } from 'vitest'
import {
  googleDailyHrv,
  googleDailyRhr,
  googleDailySpo2,
  googleDailyTemp,
  googleNap,
  googleSleep,
  googleStepsDay,
} from '../../testing/google-fixtures'
import {
  normalizeDaily,
  normalizeSleep,
  normalizeSteps,
  parseDaily,
  parseSleep,
  parseStepsRollup,
} from '../normalize'

const stored = (entity: unknown) => JSON.parse(JSON.stringify(entity))

describe('Google sleep', () => {
  it('maps a staged night onto the shared sleep record', () => {
    expect(stored(normalizeSleep(googleSleep))).toEqual({
      sk: 'SLEEP#2026-11-11T11:30:00.000Z#sleep-8841',
      type: 'sleep',
      source: 'google',
      id: 'sleep-8841',
      start: '2026-11-11T03:30:00.000Z',
      end: '2026-11-11T11:30:00.000Z',
      timezoneOffset: '-05:00',
      nap: false,
      inBedMin: 480,
      awakeMin: 25,
      lightMin: 260,
      deepMin: 85,
      remMin: 110,
      efficiencyPct: 95,
      updatedAt: '2026-11-11T11:42:10Z',
    })
  })

  it('keeps a classic nap without inventing a stage split', () => {
    expect(stored(normalizeSleep(googleNap))).toEqual({
      sk: 'SLEEP#2026-11-11T19:50:00.000Z#sleep-8842',
      type: 'sleep',
      source: 'google',
      id: 'sleep-8842',
      start: '2026-11-11T19:00:00.000Z',
      end: '2026-11-11T19:50:00.000Z',
      timezoneOffset: '-05:00',
      nap: true,
      inBedMin: 50,
      awakeMin: 6,
    })
  })

  it('sums stage segments when the summary is missing', () => {
    const { summary: _summary, ...sleep } = googleSleep.sleep
    const parsed = parseSleep({ ...googleSleep, sleep })!
    expect(parsed.lightMin).toBe(75)
    expect(parsed.deepMin).toBe(90)
    expect(parsed.remMin).toBeUndefined()
    expect(parsed.inBedMin).toBe(480)
  })

  it('treats a sleep that is not the main one as a nap', () => {
    const point = {
      ...googleSleep,
      sleep: { ...googleSleep.sleep, metadata: { mainSleep: false } },
    }
    expect(parseSleep(point)!.nap).toBe(true)
  })

  it('falls back to the end time for an unnamed data point, and skips a broken one', () => {
    expect(parseSleep({ sleep: googleSleep.sleep })!.id).toBe('2026-11-11T11:30:00.000Z')
    expect(normalizeSleep({ dataPointName: 'x', sleep: {} })).toBeNull()
    expect(normalizeSleep({})).toBeNull()
  })
})

describe('Google daily vitals', () => {
  it('reads each data type into its own fields, all keyed to one row per day', () => {
    const key = { sk: 'RECOVERY#2026-11-11#google', type: 'recovery', source: 'google', date: '2026-11-11' }
    expect(stored(normalizeDaily(googleDailyHrv))).toEqual({ ...key, hrvMs: 48.2, hrvDeepSleepMs: 55.1 })
    // 64-bit integers arrive as strings
    expect(stored(normalizeDaily(googleDailyRhr))).toEqual({ ...key, rhr: 54 })
    expect(stored(normalizeDaily(googleDailySpo2))).toEqual({ ...key, spo2Pct: 96.4 })
    expect(stored(normalizeDaily(googleDailyTemp))).toEqual({
      ...key,
      skinTempC: 34.12,
      skinTempDeviationC: 0.17,
    })
  })

  it('never writes a recovery score: the band has none', () => {
    for (const point of [googleDailyHrv, googleDailyRhr, googleDailySpo2, googleDailyTemp]) {
      expect(normalizeDaily(point)).not.toHaveProperty('recoveryScore')
    }
  })

  it('reports no deviation without a baseline, and skips unknown or dateless points', () => {
    const noBaseline = {
      dailySleepTemperatureDerivations: {
        date: { year: 2026, month: 11, day: 11 },
        nightlyTemperatureCelsius: 34.12,
      },
    }
    expect(parseDaily(noBaseline)).toEqual({ date: '2026-11-11', skinTempC: 34.12 })
    expect(normalizeDaily({ steps: {} })).toBeNull()
    expect(normalizeDaily({ dailyRestingHeartRate: { beatsPerMinute: '54' } })).toBeNull()
  })
})

describe('Google steps', () => {
  it('maps a daily roll-up to a steps row by civil date', () => {
    expect(normalizeSteps(googleStepsDay(11, '9120'))).toEqual({
      sk: 'STEPS#2026-11-11',
      type: 'steps',
      source: 'google',
      date: '2026-11-11',
      steps: 9120,
    })
  })

  it('keeps a worn day with zero steps but not an unworn day', () => {
    expect(parseStepsRollup(googleStepsDay(10, '0'))).toEqual({ date: '2026-11-10', steps: 0 })
    expect(parseStepsRollup(googleStepsDay(9))).toBeNull()
  })
})
