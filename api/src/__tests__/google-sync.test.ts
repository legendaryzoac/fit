import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  aws,
  getItem,
  itemsWithPrefix,
  jsonResponse,
  putItem,
  resetAws,
} from '../testing/aws'
import {
  googleDailyHrv,
  googleDailyRhr,
  googleDailySpo2,
  googleDailyTemp,
  googleNap,
  googleScopes,
  googleSleep,
  googleStepsDay,
} from '../testing/google-fixtures'

vi.mock('../db', async () => (await import('../testing/aws')).dbMock())
vi.mock('@aws-sdk/client-s3', async () => (await import('../testing/aws')).s3Mock())
vi.mock('@aws-sdk/client-lambda', async () => (await import('../testing/aws')).lambdaMock())
vi.mock('@aws-sdk/client-ssm', async () => (await import('../testing/aws')).ssmMock())

// The sync Lambda for a Fitbit Air user, against a fake Google Health API.

const NOW = Date.parse('2026-11-12T12:00:00.000Z')
const fetchMock = vi.fn<typeof fetch>()
const waits: number[] = []
let handler: (event: any) => Promise<void>

interface FakeGoogle {
  /** Reconcile pages per data type id. */
  points?: Record<string, unknown[][]>
  steps?: unknown[]
  refresh?: () => Response
  fail?: Record<string, number>
}

interface Call {
  kind: 'token' | 'reconcile' | 'rollup'
  type?: string
  query?: Record<string, string>
  body?: any
  token?: string
}
const calls: Call[] = []

function serveGoogle(fake: FakeGoogle): void {
  fetchMock.mockImplementation(async (input, init) => {
    const url = new URL(String(input))
    if (url.host === 'oauth2.googleapis.com') {
      calls.push({ kind: 'token', query: Object.fromEntries(init!.body as URLSearchParams) })
      return fake.refresh
        ? fake.refresh()
        : jsonResponse({ error: 'invalid_grant' }, 400)
    }
    const token = (init!.headers as Record<string, string>).authorization.replace('Bearer ', '')
    const match = /dataTypes\/([a-z0-9-]+)\/dataPoints:(reconcile|dailyRollUp)$/.exec(url.pathname)
    if (!match) return new Response('not found', { status: 404 })
    const [, type, method] = match
    if (fake.fail?.[type]) return new Response('denied', { status: fake.fail[type] })
    if (method === 'dailyRollUp') {
      calls.push({ kind: 'rollup', type, body: JSON.parse(init!.body as string), token })
      // Only the newest chunk has data in these tests
      const isLast = !calls.some((c) => c.kind === 'rollup' && c !== calls.at(-1))
      return jsonResponse({ rollupDataPoints: isLast ? (fake.steps ?? []) : [] })
    }
    const query = Object.fromEntries(url.searchParams)
    calls.push({ kind: 'reconcile', type, query, token })
    const pages = fake.points?.[type] ?? [[]]
    const index = Number(query.pageToken ?? 0)
    return jsonResponse({
      dataPoints: pages[index],
      ...(index + 1 < pages.length && { nextPageToken: String(index + 1) }),
    })
  })
}

function connect(userId: string, over: Record<string, unknown> = {}): void {
  putItem({
    pk: `USER#${userId}`,
    sk: 'GOOGLE#CONNECTION',
    type: 'google-connection',
    gsi1pk: 'GOOGLECONN',
    gsi1sk: userId,
    provider: 'google',
    externalUserId: 'abc123',
    accessToken: `access-${userId}`,
    refreshToken: `refresh-${userId}`,
    expiresAt: NOW + 3_000_000,
    scope: googleScopes.join(' '),
    status: 'active',
    connectedAt: '2026-11-01T00:00:00.000Z',
    ...over,
  })
}

const connection = (userId: string) => getItem(`USER#${userId}`, 'GOOGLE#CONNECTION')!
const reconciles = () => calls.filter((c) => c.kind === 'reconcile')
const rollups = () => calls.filter((c) => c.kind === 'rollup')
const day = (c: Call, edge: 'start' | 'end') => {
  const d = c.body.range[edge].date
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`
}

beforeEach(async () => {
  resetAws()
  aws.params.set('/fit/google/client-id', 'gid')
  aws.params.set('/fit/google/client-secret', 'gsecret')
  calls.length = 0
  waits.length = 0
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(NOW) })
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
    waits.push(ms ?? 0)
    fn()
    return 0
  }) as unknown as typeof setTimeout)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  process.env.RAW_BUCKET = 'raw-bucket'
  vi.resetModules()
  handler = (await import('../sync')).handler
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('what it asks Google for', () => {
  it('pulls the last three days, starting a civil day early', async () => {
    connect('u1')
    serveGoogle({})
    await handler({ mode: 'recent', userId: 'u1' })

    expect(reconciles().map((c) => [c.type, c.query!.filter])).toEqual([
      ['sleep', 'sleep.interval.civil_end_time >= "2026-11-08"'],
      ['daily-heart-rate-variability', 'daily_heart_rate_variability.date >= "2026-11-08"'],
      ['daily-resting-heart-rate', 'daily_resting_heart_rate.date >= "2026-11-08"'],
      ['daily-oxygen-saturation', 'daily_oxygen_saturation.date >= "2026-11-08"'],
      [
        'daily-sleep-temperature-derivations',
        'daily_sleep_temperature_derivations.date >= "2026-11-08"',
      ],
    ])
    expect(reconciles()[0].query!.pageSize).toBe('25')
    expect(reconciles().every((c) => c.token === 'access-u1')).toBe(true)

    // Steps: one roll-up from that day through tomorrow, in one-day windows
    expect(rollups()).toHaveLength(1)
    expect(rollups()[0].body.windowSizeDays).toBe(1)
    expect([day(rollups()[0], 'start'), day(rollups()[0], 'end')]).toEqual([
      '2026-11-08',
      '2026-11-14',
    ])
    expect(rollups()[0].body.range.start.time).toEqual({ hours: 0, minutes: 0, seconds: 0, nanos: 0 })
  })

  it('backfills a year, with steps in chunks of at most ninety days', async () => {
    connect('u1')
    serveGoogle({})
    await handler({ mode: 'backfill', userId: 'u1' })

    expect(reconciles()[0].query!.filter).toBe('sleep.interval.civil_end_time >= "2025-11-11"')
    expect(rollups().map((c) => [day(c, 'start'), day(c, 'end')])).toEqual([
      ['2025-11-11', '2026-02-09'],
      ['2026-02-09', '2026-05-10'],
      ['2026-05-10', '2026-08-08'],
      ['2026-08-08', '2026-11-06'],
      ['2026-11-06', '2026-11-14'],
    ])
    expect(connection('u1').backfillDone).toBe(true)
  })

  it('follows nextPageToken, pausing between pages', async () => {
    connect('u1')
    serveGoogle({ points: { sleep: [[googleSleep], [googleNap]] } })
    await handler({ mode: 'recent', userId: 'u1' })
    expect(reconciles().filter((c) => c.type === 'sleep').map((c) => c.query!.pageToken)).toEqual([
      undefined,
      '1',
    ])
    expect(new Set(waits)).toEqual(new Set([450]))
    expect(itemsWithPrefix('USER#u1', 'SLEEP#')).toHaveLength(2)
  })
})

describe('what it writes', () => {
  const everything: FakeGoogle = {
    points: {
      sleep: [[googleSleep]],
      'daily-heart-rate-variability': [[googleDailyHrv]],
      'daily-resting-heart-rate': [[googleDailyRhr]],
      'daily-oxygen-saturation': [[googleDailySpo2]],
      'daily-sleep-temperature-derivations': [[googleDailyTemp]],
    },
    steps: [googleStepsDay(12, '2210'), googleStepsDay(11, '9120'), googleStepsDay(10)],
  }

  it('merges the four daily types into one vitals row per day, with no score', async () => {
    connect('u1')
    serveGoogle(everything)
    await handler({ mode: 'recent', userId: 'u1' })

    expect(itemsWithPrefix('USER#u1', 'RECOVERY#')).toEqual([
      {
        pk: 'USER#u1',
        sk: 'RECOVERY#2026-11-11#google',
        type: 'recovery',
        source: 'google',
        date: '2026-11-11',
        hrvMs: 48.2,
        hrvDeepSleepMs: 55.1,
        rhr: 54,
        spo2Pct: 96.4,
        skinTempC: 34.12,
        skinTempDeviationC: 0.17,
        syncedAt: '2026-11-12T12:00:00.000Z',
      },
    ])
  })

  it('leaves a score we computed ourselves in place on the next sync', async () => {
    connect('u1')
    putItem({
      pk: 'USER#u1',
      sk: 'RECOVERY#2026-11-11#google',
      recoveryScore: 71,
      scoreSource: 'model',
      hrvMs: 40,
    })
    serveGoogle(everything)
    await handler({ mode: 'recent', userId: 'u1' })
    expect(getItem('USER#u1', 'RECOVERY#2026-11-11#google')).toMatchObject({
      recoveryScore: 71,
      scoreSource: 'model',
      hrvMs: 48.2,
      rhr: 54,
    })
  })

  it('stores sleep and steps, skipping days the band was not worn', async () => {
    connect('u1')
    serveGoogle(everything)
    await handler({ mode: 'recent', userId: 'u1' })

    expect(itemsWithPrefix('USER#u1', 'SLEEP#').map((i) => [i.sk, i.source, i.inBedMin])).toEqual([
      ['SLEEP#2026-11-11T11:30:00.000Z#sleep-8841', 'google', 480],
    ])
    expect(itemsWithPrefix('USER#u1', 'STEPS#')).toEqual([
      {
        pk: 'USER#u1',
        sk: 'STEPS#2026-11-11',
        type: 'steps',
        source: 'google',
        date: '2026-11-11',
        steps: 9120,
        syncedAt: '2026-11-12T12:00:00.000Z',
      },
      {
        pk: 'USER#u1',
        sk: 'STEPS#2026-11-12',
        type: 'steps',
        source: 'google',
        date: '2026-11-12',
        steps: 2210,
        syncedAt: '2026-11-12T12:00:00.000Z',
      },
    ])
    expect(itemsWithPrefix('USER#u1', 'CYCLE#')).toEqual([])
    expect(itemsWithPrefix('USER#u1', 'SESSION#')).toEqual([])
  })

  it('archives raw payloads under google/, and records the outcome', async () => {
    connect('u1')
    serveGoogle(everything)
    await handler({ mode: 'recent', userId: 'u1' })

    expect(aws.rawPuts.map((p) => p.Key).sort()).toEqual([
      'google/u1/daily-heart-rate-variability/2026-11-11.json',
      'google/u1/daily-oxygen-saturation/2026-11-11.json',
      'google/u1/daily-resting-heart-rate/2026-11-11.json',
      'google/u1/daily-sleep-temperature-derivations/2026-11-11.json',
      'google/u1/sleep/sleep-8841.json',
      'google/u1/steps/2026-11-11.json',
      'google/u1/steps/2026-11-12.json',
    ])
    expect(connection('u1')).toMatchObject({
      lastSyncAt: '2026-11-12T12:00:00.000Z',
      lastSyncCounts: {
        sleep: 1,
        'daily-heart-rate-variability': 1,
        'daily-resting-heart-rate': 1,
        'daily-oxygen-saturation': 1,
        'daily-sleep-temperature-derivations': 1,
        steps: 2,
      },
    })
  })
})

describe('when part of it is unavailable', () => {
  it('carries on past a failing daily type', async () => {
    connect('u1')
    serveGoogle({
      points: { sleep: [[googleSleep]], 'daily-resting-heart-rate': [[googleDailyRhr]] },
      fail: { 'daily-heart-rate-variability': 500 },
    })
    await handler({ mode: 'recent', userId: 'u1' })
    expect(itemsWithPrefix('USER#u1', 'SLEEP#')).toHaveLength(1)
    expect(getItem('USER#u1', 'RECOVERY#2026-11-11#google')).toMatchObject({ rhr: 54 })
    expect(connection('u1').lastSyncAt).toBe('2026-11-12T12:00:00.000Z')
  })

  it('fails the sync when sleep itself fails', async () => {
    connect('u1')
    serveGoogle({ fail: { sleep: 500 } })
    await expect(handler({ mode: 'recent', userId: 'u1' })).rejects.toThrow('Google API 500')
    expect(connection('u1').lastSyncAt).toBeUndefined()
  })

  it('does not ask for data types whose scope the user withheld', async () => {
    connect('u1', { scope: googleScopes[0] }) // sleep only
    serveGoogle({ points: { sleep: [[googleSleep]] } })
    await handler({ mode: 'recent', userId: 'u1' })
    expect(reconciles().map((c) => c.type)).toEqual(['sleep'])
    expect(rollups()).toEqual([])
    expect(connection('u1').lastSyncCounts).toEqual({ sleep: 1 })
  })
})

describe('token refresh', () => {
  const refreshed = () =>
    jsonResponse({ access_token: 'access-new', expires_in: 3599, scope: googleScopes.join(' ') })

  it('refreshes near expiry and keeps the same refresh token', async () => {
    connect('u1', { expiresAt: NOW + 60_000 })
    serveGoogle({ refresh: refreshed })
    await handler({ mode: 'recent', userId: 'u1' })
    expect(calls[0]).toMatchObject({
      kind: 'token',
      query: { grant_type: 'refresh_token', refresh_token: 'refresh-u1' },
    })
    expect(reconciles().every((c) => c.token === 'access-new')).toBe(true)
    expect(connection('u1')).toMatchObject({
      accessToken: 'access-new',
      refreshToken: 'refresh-u1',
      expiresAt: NOW + 3_599_000,
      status: 'active',
    })
  })

  it('asks for a reconnect when Google says the grant is gone, without the WHOOP wait', async () => {
    connect('u1', { expiresAt: NOW })
    serveGoogle({})
    await expect(handler({ mode: 'recent', userId: 'u1' })).rejects.toThrow('Google API 400')
    expect(connection('u1').status).toBe('error')
    expect(waits).not.toContain(2500)
  })

  it('leaves the connection alone when the token endpoint merely hiccups', async () => {
    connect('u1', { expiresAt: NOW })
    serveGoogle({ refresh: () => new Response('unavailable', { status: 503 }) })
    await expect(handler({ mode: 'recent', userId: 'u1' })).rejects.toThrow('Google API 503')
    expect(connection('u1').status).toBe('active')
  })
})

describe('nightly', () => {
  it('covers WHOOP and Fitbit users in one pass', async () => {
    aws.params.set('/fit/whoop/client-id', 'cid')
    aws.params.set('/fit/whoop/client-secret', 'csecret')
    putItem({
      pk: 'USER#w1',
      sk: 'WHOOP#CONNECTION',
      gsi1pk: 'WHOOPCONN',
      gsi1sk: 'w1',
      accessToken: 'whoop-access',
      refreshToken: 'whoop-refresh',
      expiresAt: NOW + 3_000_000,
      scope: 'offline',
      whoopUserId: '10129',
      status: 'active',
    })
    connect('g1')
    const google = vi.fn()
    serveGoogle({})
    const googleImpl = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input).includes('api.prod.whoop.com')) return jsonResponse({ records: [] })
      google()
      return googleImpl(input, init)
    })
    await handler({ mode: 'nightly' })

    expect(getItem('USER#w1', 'WHOOP#CONNECTION')!.lastSyncAt).toBe('2026-11-12T12:00:00.000Z')
    expect(connection('g1').lastSyncAt).toBe('2026-11-12T12:00:00.000Z')
    expect(google).toHaveBeenCalled()
    // Fourteen days back, less the early civil day
    expect(reconciles()[0].query!.filter).toBe('sleep.interval.civil_end_time >= "2026-10-28"')
  })
})
