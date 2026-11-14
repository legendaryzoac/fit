import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiEvent, bodyOf, putItem, resetAws } from '../testing/aws'
import {
  whoopCycle,
  whoopRecovery,
  whoopSleep,
  whoopWorkout,
} from '../testing/whoop-fixtures'
import {
  normalizeCycle,
  normalizeRecovery,
  normalizeSleep,
  normalizeWorkout,
} from '../whoop/normalize'

vi.mock('../db', async () => (await import('../testing/aws')).dbMock())
vi.mock('@aws-sdk/client-s3', async () => (await import('../testing/aws')).s3Mock())
vi.mock('@aws-sdk/client-lambda', async () => (await import('../testing/aws')).lambdaMock())
vi.mock('@aws-sdk/client-ssm', async () => (await import('../testing/aws')).ssmMock())
vi.mock('aws-jwt-verify', async () => (await import('../testing/aws')).jwtMock())

// The wire shapes the dashboards read: /api/metrics and /api/sessions.

let handler: (event: any) => Promise<unknown>
const store = (entity: Record<string, unknown>) => putItem({ pk: 'USER#u1', ...entity })

beforeEach(async () => {
  resetAws()
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-12T12:00:00.000Z') })
  vi.resetModules()
  handler = (await import('../handler')).handler
  store(normalizeSleep(whoopSleep))
  store(normalizeCycle(whoopCycle))
  store(normalizeRecovery(whoopRecovery))
  store(normalizeWorkout(whoopWorkout))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('GET /api/metrics', () => {
  it('returns recovery, sleep and cycle series in their wire shapes', async () => {
    const res = await handler(apiEvent('GET', '/api/metrics', { user: 'u1' }))
    expect(bodyOf(res)).toEqual({
      days: 90,
      recoveries: [
        {
          date: '2026-11-10T11:25:44.774Z',
          recoveryScore: 44,
          rhr: 64,
          hrvMs: 31.813562,
          scoreState: 'SCORED',
          userCalibrating: false,
        },
      ],
      sleeps: [
        {
          end: '2026-11-10T10:25:44.774Z',
          timezoneOffset: '-05:00',
          nap: false,
          inBedMin: 504.5,
          awakeMin: 23.4,
          lightMin: 248.4,
          deepMin: 110.5,
          remMin: 98,
          performancePct: 98,
          efficiencyPct: 91.69533848,
          consistencyPct: 90,
          respiratoryRate: 16.11328125,
          disturbances: 12,
          scoreState: 'SCORED',
        },
      ],
      cycles: [
        {
          start: '2026-11-10T02:25:44.774Z',
          end: '2026-11-11T02:10:00.000Z',
          timezoneOffset: '-05:00',
          strain: 5.2951527,
          kilojoule: 8288.297,
          avgHr: 68,
          maxHr: 141,
          scoreState: 'SCORED',
        },
      ],
    })
  })

  it('clamps the window to 7–365 days and drops what falls outside it', async () => {
    store({ ...normalizeSleep(whoopSleep), sk: 'SLEEP#2026-10-01T10:00:00.000Z#old' })
    const week = bodyOf(await handler(apiEvent('GET', '/api/metrics', { user: 'u1', query: { days: '1' } })))
    expect(week.days).toBe(7)
    expect(week.sleeps).toHaveLength(1)
    const year = bodyOf(
      await handler(apiEvent('GET', '/api/metrics', { user: 'u1', query: { days: '9999' } })),
    )
    expect(year.days).toBe(365)
    expect(year.sleeps).toHaveLength(2)
  })

  it("only reads the caller's rows", async () => {
    const other = bodyOf(await handler(apiEvent('GET', '/api/metrics', { user: 'u2' })))
    expect(other).toEqual({ days: 90, recoveries: [], sleeps: [], cycles: [] })
  })
})

describe('GET /api/sessions', () => {
  it('returns captured sessions with their sort key for linking', async () => {
    const res = await handler(apiEvent('GET', '/api/sessions', { user: 'u1' }))
    expect(bodyOf(res)).toEqual({
      sessions: [
        {
          sk: 'SESSION#2026-11-10T17:25:44.774Z#1043e0f5-5d1c-4f0a-9a7e-2b0c3a0c7f11',
          sport: 'running',
          start: '2026-11-10T17:25:44.774Z',
          end: '2026-11-10T18:25:44.774Z',
          timezoneOffset: '-05:00',
          strain: 8.2463,
          avgHr: 123,
          maxHr: 146,
          kilojoule: 1569.34033203125,
          distanceM: 1772.77035916,
          zoneMin: { z0: 5, z1: 10, z2: 15, z3: 15, z4: 10, z5: 5 },
          scoreState: 'SCORED',
        },
      ],
    })
  })
})
