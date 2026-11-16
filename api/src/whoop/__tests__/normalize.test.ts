import { describe, expect, it } from 'vitest'
import {
  whoopCycle,
  whoopCycleOngoing,
  whoopRecovery,
  whoopSleep,
  whoopSleepUnscored,
  whoopWorkout,
} from '../../testing/whoop-fixtures'
import {
  normalizeCycle,
  normalizeRecovery,
  normalizeSleep,
  normalizeWorkout,
} from '../normalize'

// What lands in the table for each WHOOP record. These shapes are live
// data: a change here changes what existing users' dashboards read.
describe('WHOOP normalizers', () => {
  it('maps a scored sleep', () => {
    expect(normalizeSleep(whoopSleep)).toEqual({
      sk: 'SLEEP#2026-11-10T10:25:44.774Z#ecfc6a15-4661-442f-a9a4-f160dd7afae8',
      type: 'sleep',
      source: 'whoop',
      id: 'ecfc6a15-4661-442f-a9a4-f160dd7afae8',
      start: '2026-11-10T02:25:44.774Z',
      end: '2026-11-10T10:25:44.774Z',
      timezoneOffset: '-05:00',
      nap: false,
      scoreState: 'SCORED',
      inBedMin: 504.5,
      awakeMin: 23.4,
      lightMin: 248.4,
      deepMin: 110.5,
      remMin: 98,
      sleepCycles: 3,
      disturbances: 12,
      respiratoryRate: 16.11328125,
      performancePct: 98,
      consistencyPct: 90,
      efficiencyPct: 91.69533848,
      updatedAt: '2026-11-10T14:25:44.774Z',
    })
  })

  it('leaves unscored sleep metrics out and defaults nap to false', () => {
    const entity = JSON.parse(JSON.stringify(normalizeSleep(whoopSleepUnscored)))
    expect(entity).toEqual({
      sk: 'SLEEP#2026-11-11T11:00:00.000Z#a1b2c3d4-0000-4000-8000-000000000001',
      type: 'sleep',
      source: 'whoop',
      id: 'a1b2c3d4-0000-4000-8000-000000000001',
      start: '2026-11-11T03:00:00.000Z',
      end: '2026-11-11T11:00:00.000Z',
      timezoneOffset: '-05:00',
      nap: false,
      scoreState: 'PENDING_SCORE',
      updatedAt: '2026-11-11T12:00:00.000Z',
    })
  })

  it('maps a workout to a session', () => {
    expect(normalizeWorkout(whoopWorkout)).toEqual({
      sk: 'SESSION#2026-11-10T17:25:44.774Z#1043e0f5-5d1c-4f0a-9a7e-2b0c3a0c7f11',
      type: 'session',
      source: 'whoop',
      id: '1043e0f5-5d1c-4f0a-9a7e-2b0c3a0c7f11',
      sport: 'running',
      start: '2026-11-10T17:25:44.774Z',
      end: '2026-11-10T18:25:44.774Z',
      timezoneOffset: '-05:00',
      scoreState: 'SCORED',
      strain: 8.2463,
      avgHr: 123,
      maxHr: 146,
      kilojoule: 1569.34033203125,
      distanceM: 1772.77035916,
      altitudeGainM: 46.64384460449,
      percentRecorded: 100,
      zoneMin: { z0: 5, z1: 10, z2: 15, z3: 15, z4: 10, z5: 5 },
      updatedAt: '2026-11-10T19:25:44.774Z',
    })
  })

  it('names a workout by sport id, then "unknown", when WHOOP sends no name', () => {
    expect(normalizeWorkout({ ...whoopWorkout, sport_name: undefined, sport_id: 63 }).sport).toBe('63')
    expect(normalizeWorkout({ ...whoopWorkout, sport_name: undefined, sport_id: undefined }).sport).toBe(
      'unknown',
    )
  })

  it('maps a cycle, and an ongoing one without an end', () => {
    expect(normalizeCycle(whoopCycle)).toEqual({
      sk: 'CYCLE#2026-11-10T02:25:44.774Z#93845',
      type: 'cycle',
      source: 'whoop',
      id: 93845,
      start: '2026-11-10T02:25:44.774Z',
      end: '2026-11-11T02:10:00.000Z',
      timezoneOffset: '-05:00',
      scoreState: 'SCORED',
      strain: 5.2951527,
      kilojoule: 8288.297,
      avgHr: 68,
      maxHr: 141,
      updatedAt: '2026-11-10T11:25:44.774Z',
    })
    const ongoing = JSON.parse(JSON.stringify(normalizeCycle(whoopCycleOngoing)))
    expect(ongoing).toEqual({
      sk: 'CYCLE#2026-11-11T02:10:00.000Z#93846',
      type: 'cycle',
      source: 'whoop',
      id: 93846,
      start: '2026-11-11T02:10:00.000Z',
      timezoneOffset: '-05:00',
      scoreState: 'PENDING_SCORE',
      updatedAt: '2026-11-11T11:00:00.000Z',
    })
  })

  it('maps a recovery, keyed by its creation time and cycle', () => {
    expect(normalizeRecovery(whoopRecovery)).toEqual({
      sk: 'RECOVERY#2026-11-10T11:25:44.774Z#93845',
      type: 'recovery',
      source: 'whoop',
      cycleId: 93845,
      sleepId: 'ecfc6a15-4661-442f-a9a4-f160dd7afae8',
      scoreState: 'SCORED',
      userCalibrating: false,
      recoveryScore: 44,
      rhr: 64,
      hrvMs: 31.813562,
      spo2Pct: 95.6875,
      skinTempC: 33.7,
      updatedAt: '2026-11-10T14:25:44.774Z',
    })
  })
})
