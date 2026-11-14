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
  whoopCycle,
  whoopRecovery,
  whoopSleep,
  whoopSleepUnscored,
  whoopWorkout,
} from '../testing/whoop-fixtures'

vi.mock('../db', async () => (await import('../testing/aws')).dbMock())
vi.mock('@aws-sdk/client-s3', async () => (await import('../testing/aws')).s3Mock())
vi.mock('@aws-sdk/client-lambda', async () => (await import('../testing/aws')).lambdaMock())
vi.mock('@aws-sdk/client-ssm', async () => (await import('../testing/aws')).ssmMock())

// The sync Lambda end to end against a fake WHOOP API: what it asks for,
// what it writes, and how it treats a token on the edge of expiry.

const NOW = Date.parse('2026-11-12T12:00:00.000Z')
const fetchMock = vi.fn<typeof fetch>()
const waits: number[] = []
let onWait: (ms: number) => void = () => {}
let handler: (event: any) => Promise<void>

interface FakeWhoop {
  pages: Record<string, unknown[][]>
  body?: unknown
  /** Answer to a refresh-token request; default refuses. */
  refresh?: () => Response
  failPath?: string
}

const calls: Array<{ path: string; query: Record<string, string>; token?: string }> = []

function serveWhoop(fake: FakeWhoop): void {
  fetchMock.mockImplementation(async (input, init) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith('/oauth/oauth2/token')) {
      calls.push({ path: 'token', query: Object.fromEntries(init!.body as URLSearchParams) })
      return fake.refresh ? fake.refresh() : new Response('invalid_grant', { status: 400 })
    }
    const path = url.pathname.replace('/developer', '')
    const query = Object.fromEntries(url.searchParams)
    const auth = (init?.headers as Record<string, string>).authorization
    calls.push({ path, query, token: auth.replace('Bearer ', '') })
    if (path === fake.failPath) return new Response('boom', { status: 500 })
    if (path === '/v2/user/measurement/body') {
      return fake.body === undefined
        ? new Response('nope', { status: 500 })
        : jsonResponse(fake.body)
    }
    const pages = fake.pages[path] ?? [[]]
    const index = Number(query.nextToken ?? 0)
    return jsonResponse({
      records: pages[index],
      next_token: index + 1 < pages.length ? String(index + 1) : null,
    })
  })
}

function connect(userId: string, over: Record<string, unknown> = {}): void {
  putItem({
    pk: `USER#${userId}`,
    sk: 'WHOOP#CONNECTION',
    type: 'whoop-connection',
    gsi1pk: 'WHOOPCONN',
    gsi1sk: userId,
    accessToken: `access-${userId}`,
    refreshToken: `refresh-${userId}`,
    expiresAt: NOW + 3_600_000,
    scope: 'offline',
    whoopUserId: '10129',
    status: 'active',
    connectedAt: '2026-11-01T00:00:00.000Z',
    ...over,
  })
}

const connection = (userId: string) => getItem(`USER#${userId}`, 'WHOOP#CONNECTION')!
const collectionCalls = () => calls.filter((c) => c.path !== 'token' && !c.path.includes('/user/'))

beforeEach(async () => {
  resetAws()
  aws.params.set('/fit/whoop/client-id', 'cid')
  aws.params.set('/fit/whoop/client-secret', 'csecret')
  calls.length = 0
  waits.length = 0
  onWait = () => {}
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(NOW) })
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
    waits.push(ms ?? 0)
    onWait(ms ?? 0)
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

describe('backfill', () => {
  it('pulls every collection with no lower bound, following next_token', async () => {
    connect('u1')
    serveWhoop({
      pages: {
        '/v2/cycle': [[whoopCycle]],
        '/v2/activity/sleep': [[whoopSleep], [whoopSleepUnscored]],
        '/v2/activity/workout': [[whoopWorkout]],
        '/v2/recovery': [[whoopRecovery]],
      },
      body: { weight_kilogram: 81.5 },
    })
    await handler({ mode: 'backfill', userId: 'u1' })

    expect(collectionCalls()).toEqual([
      { path: '/v2/cycle', query: { limit: '25' }, token: 'access-u1' },
      { path: '/v2/activity/sleep', query: { limit: '25' }, token: 'access-u1' },
      { path: '/v2/activity/sleep', query: { limit: '25', nextToken: '1' }, token: 'access-u1' },
      { path: '/v2/activity/workout', query: { limit: '25' }, token: 'access-u1' },
      { path: '/v2/recovery', query: { limit: '25' }, token: 'access-u1' },
    ])
    // One pause per page keeps a long backfill under WHOOP's rate limit
    expect(waits).toEqual([650, 650, 650, 650, 650])
  })

  it('stores each normalized entity under the user, stamped with the sync time', async () => {
    connect('u1')
    serveWhoop({
      pages: {
        '/v2/cycle': [[whoopCycle]],
        '/v2/activity/sleep': [[whoopSleep]],
        '/v2/activity/workout': [[whoopWorkout]],
        '/v2/recovery': [[whoopRecovery]],
      },
    })
    await handler({ mode: 'backfill', userId: 'u1' })

    expect(itemsWithPrefix('USER#u1', 'CYCLE#').map((i) => i.sk)).toEqual([
      'CYCLE#2026-11-10T02:25:44.774Z#93845',
    ])
    expect(itemsWithPrefix('USER#u1', 'SESSION#').map((i) => i.sk)).toEqual([
      'SESSION#2026-11-10T17:25:44.774Z#1043e0f5-5d1c-4f0a-9a7e-2b0c3a0c7f11',
    ])
    expect(itemsWithPrefix('USER#u1', 'SLEEP#')).toEqual([
      {
        pk: 'USER#u1',
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
        syncedAt: '2026-11-12T12:00:00.000Z',
      },
    ])
    expect(itemsWithPrefix('USER#u1', 'RECOVERY#')).toEqual([
      {
        pk: 'USER#u1',
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
        syncedAt: '2026-11-12T12:00:00.000Z',
      },
    ])
  })

  it('archives the untouched vendor record to S3', async () => {
    connect('u1')
    serveWhoop({
      pages: { '/v2/activity/sleep': [[whoopSleep]], '/v2/recovery': [[whoopRecovery]] },
    })
    await handler({ mode: 'backfill', userId: 'u1' })

    expect(aws.rawPuts.map((p) => p.Key).sort()).toEqual([
      'whoop/u1/recovery/93845.json',
      'whoop/u1/sleep/ecfc6a15-4661-442f-a9a4-f160dd7afae8.json',
    ])
    const sleep = aws.rawPuts.find((p) => p.Key.includes('/sleep/'))!
    expect(sleep.Bucket).toBe('raw-bucket')
    expect(JSON.parse(sleep.Body)).toEqual(whoopSleep)
  })

  it('records the outcome on the connection', async () => {
    connect('u1')
    serveWhoop({
      pages: {
        '/v2/cycle': [[whoopCycle]],
        '/v2/activity/sleep': [[whoopSleep], [whoopSleepUnscored]],
      },
      body: { weight_kilogram: 81.5 },
    })
    await handler({ mode: 'backfill', userId: 'u1' })

    expect(connection('u1')).toMatchObject({
      lastSyncAt: '2026-11-12T12:00:00.000Z',
      lastSyncCounts: { cycle: 1, sleep: 2, workout: 0, recovery: 0 },
      backfillDone: true,
      bodyWeightKg: 81.5,
      status: 'active',
      accessToken: 'access-u1',
    })
  })

  it('never fails over the optional body measurement', async () => {
    connect('u1')
    serveWhoop({ pages: { '/v2/cycle': [[whoopCycle]] } })
    await handler({ mode: 'backfill', userId: 'u1' })
    expect(connection('u1').lastSyncCounts.cycle).toBe(1)
    expect(connection('u1').bodyWeightKg).toBeUndefined()
  })
})

describe('recent', () => {
  it('asks for the last three days by default and leaves backfillDone alone', async () => {
    connect('u1')
    serveWhoop({ pages: {} })
    await handler({ mode: 'recent', userId: 'u1' })
    expect(collectionCalls().map((c) => c.query.start)).toEqual(
      Array(4).fill('2026-11-09T12:00:00.000Z'),
    )
    expect(connection('u1').backfillDone).toBeUndefined()
    expect(connection('u1').lastSyncAt).toBe('2026-11-12T12:00:00.000Z')
  })

  it('honours an explicit day count', async () => {
    connect('u1')
    serveWhoop({ pages: {} })
    await handler({ mode: 'recent', userId: 'u1', days: 1 })
    expect(collectionCalls()[0].query.start).toBe('2026-11-11T12:00:00.000Z')
  })

  it('needs a user', async () => {
    await expect(handler({ mode: 'recent' })).rejects.toThrow('requires userId')
  })

  it('skips a user with no connection, or one flagged for reconnect', async () => {
    serveWhoop({ pages: {} })
    await handler({ mode: 'recent', userId: 'nobody' })
    connect('u1', { status: 'error' })
    await handler({ mode: 'recent', userId: 'u1' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails loudly when the client credentials are missing', async () => {
    aws.params.clear()
    connect('u1')
    await expect(handler({ mode: 'recent', userId: 'u1' })).rejects.toThrow('not configured')
  })

  it('surfaces a WHOOP error and leaves lastSyncAt untouched', async () => {
    connect('u1')
    serveWhoop({ pages: {}, failPath: '/v2/activity/sleep' })
    await expect(handler({ mode: 'recent', userId: 'u1' })).rejects.toThrow('WHOOP API 500')
    expect(connection('u1').lastSyncAt).toBeUndefined()
  })
})

describe('nightly', () => {
  it('re-pulls fourteen days for every connected user, one after another', async () => {
    connect('u1')
    connect('u2')
    serveWhoop({ pages: {} })
    await handler({ mode: 'nightly' })
    const starts = collectionCalls()
    expect(starts).toHaveLength(8)
    expect(new Set(starts.map((c) => c.query.start))).toEqual(
      new Set(['2026-10-29T12:00:00.000Z']),
    )
    expect(starts.map((c) => c.token)).toEqual([
      ...Array(4).fill('access-u1'),
      ...Array(4).fill('access-u2'),
    ])
  })

  it('carries on past a user whose sync fails', async () => {
    connect('u1', { expiresAt: NOW }) // refresh is refused → dead
    connect('u2')
    serveWhoop({ pages: { '/v2/cycle': [[whoopCycle]] } })
    await handler({ mode: 'nightly' })
    expect(connection('u1').status).toBe('error')
    expect(connection('u2').lastSyncCounts.cycle).toBe(1)
  })
})

describe('token refresh', () => {
  const rotated = () =>
    jsonResponse({ access_token: 'access-new', refresh_token: 'refresh-new', expires_in: 3600 })

  it('uses the stored token while it has more than two minutes left', async () => {
    connect('u1', { expiresAt: NOW + 121_000 })
    serveWhoop({ pages: {} })
    await handler({ mode: 'recent', userId: 'u1' })
    expect(calls.some((c) => c.path === 'token')).toBe(false)
  })

  it('refreshes inside the two-minute window and persists the rotated pair', async () => {
    connect('u1', { expiresAt: NOW + 119_000, status: 'active' })
    serveWhoop({ pages: {}, refresh: rotated })
    await handler({ mode: 'recent', userId: 'u1' })

    expect(calls[0]).toMatchObject({
      path: 'token',
      query: { grant_type: 'refresh_token', refresh_token: 'refresh-u1' },
    })
    expect(collectionCalls().every((c) => c.token === 'access-new')).toBe(true)
    expect(connection('u1')).toMatchObject({
      accessToken: 'access-new',
      refreshToken: 'refresh-new',
      expiresAt: NOW + 3_600_000,
      status: 'active',
    })
  })

  it('adopts the tokens a concurrent invocation rotated in during the 2.5 s wait', async () => {
    connect('u1', { expiresAt: NOW })
    serveWhoop({ pages: {} }) // our own refresh is refused: the token was already spent
    onWait = (ms) => {
      if (ms !== 2500) return
      putItem({
        ...connection('u1'),
        accessToken: 'access-winner',
        refreshToken: 'refresh-winner',
        expiresAt: NOW + 3_600_000,
      })
    }
    await handler({ mode: 'recent', userId: 'u1' })

    expect(waits).toContain(2500)
    expect(collectionCalls().every((c) => c.token === 'access-winner')).toBe(true)
    expect(connection('u1').status).toBe('active')
  })

  it('flags the connection for reconnect when the refresh token is really dead', async () => {
    connect('u1', { expiresAt: NOW })
    serveWhoop({ pages: {} })
    await expect(handler({ mode: 'recent', userId: 'u1' })).rejects.toThrow('WHOOP API 400')
    expect(connection('u1').status).toBe('error')
    expect(collectionCalls()).toEqual([])
  })
})
