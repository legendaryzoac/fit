import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  apiEvent,
  asResult,
  aws,
  bodyOf,
  getItem,
  itemsWithPrefix,
  jsonResponse,
  putItem,
  resetAws,
} from '../testing/aws'

vi.mock('../db', async () => (await import('../testing/aws')).dbMock())
vi.mock('@aws-sdk/client-s3', async () => (await import('../testing/aws')).s3Mock())
vi.mock('@aws-sdk/client-lambda', async () => (await import('../testing/aws')).lambdaMock())
vi.mock('@aws-sdk/client-ssm', async () => (await import('../testing/aws')).ssmMock())
vi.mock('aws-jwt-verify', async () => (await import('../testing/aws')).jwtMock())

// The strap's connect / callback / disconnect routes and its state in
// /api/me, driven through the real router with AWS and WHOOP stubbed.

const NOW = '2026-11-12T12:00:00.000Z'
const fetchMock = vi.fn<typeof fetch>()
let handler: (event: any) => Promise<unknown>

function configureWhoop(): void {
  aws.params.set('/fit/whoop/client-id', 'cid')
  aws.params.set('/fit/whoop/client-secret', 'csecret')
}

/** WHOOP's token and profile endpoints, answering one successful login. */
function whoopLogin(): void {
  fetchMock.mockImplementation(async (input) => {
    const url = String(input)
    if (url.endsWith('/oauth/oauth2/token')) {
      return jsonResponse({
        access_token: 'access-1',
        refresh_token: 'refresh-1',
        expires_in: 3600,
        scope: 'offline read:sleep',
      })
    }
    if (url.endsWith('/v2/user/profile/basic')) return jsonResponse({ user_id: 10129 })
    return new Response('not found', { status: 404 })
  })
}

async function startConnect(user = 'u1'): Promise<string> {
  const res = await handler(apiEvent('GET', '/api/whoop/connect', { user }))
  return new URL(bodyOf(res).url).searchParams.get('state')!
}

const location = (res: unknown) => asResult(res).headers.location

beforeEach(async () => {
  resetAws()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(NOW) })
  process.env.APP_URL = 'https://app.test'
  process.env.SYNC_FUNCTION_NAME = 'sync-fn'
  vi.resetModules()
  handler = (await import('../handler')).handler
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('auth', () => {
  it('rejects a request without a bearer token, or with a bad one', async () => {
    expect(asResult(await handler(apiEvent('GET', '/api/me'))).statusCode).toBe(401)
    expect(asResult(await handler(apiEvent('GET', '/api/me', { user: 'bad' }))).statusCode).toBe(401)
  })
})

describe('GET /api/whoop/connect', () => {
  it('answers 503 until the client credentials exist', async () => {
    const res = await handler(apiEvent('GET', '/api/whoop/connect', { user: 'u1' }))
    expect(asResult(res).statusCode).toBe(503)
    expect(aws.items.size).toBe(0)
  })

  it('returns the WHOOP authorize URL and stores a ten-minute state nonce', async () => {
    configureWhoop()
    const res = await handler(apiEvent('GET', '/api/whoop/connect', { user: 'u1' }))
    expect(asResult(res).statusCode).toBe(200)
    const url = new URL(bodyOf(res).url)
    expect(url.origin + url.pathname).toBe('https://api.prod.whoop.com/oauth/oauth2/auth')
    expect(url.searchParams.get('client_id')).toBe('cid')
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.test/api/whoop/callback')
    const nonce = url.searchParams.get('state')!
    expect(getItem(`OAUTH#${nonce}`, 'STATE')).toEqual({
      pk: `OAUTH#${nonce}`,
      sk: 'STATE',
      type: 'oauth-state',
      userId: 'u1',
      provider: 'whoop',
      ttl: Date.parse(NOW) / 1000 + 600,
    })
  })
})

describe('GET /api/whoop/callback', () => {
  beforeEach(configureWhoop)

  it('needs no bearer token', async () => {
    const res = await handler(apiEvent('GET', '/api/whoop/callback', { query: {} }))
    expect(asResult(res).statusCode).toBe(302)
  })

  it('reports a missing code, passing on what WHOOP said', async () => {
    expect(location(await handler(apiEvent('GET', '/api/whoop/callback', { query: {} })))).toBe(
      'https://app.test/?whoop=error&reason=missing-params',
    )
    const denied = await handler(
      apiEvent('GET', '/api/whoop/callback', {
        query: { error: 'access_denied', error_description: 'The user said no' },
      }),
    )
    expect(location(denied)).toBe(
      'https://app.test/?whoop=error&reason=access_denied&detail=The%20user%20said%20no',
    )
  })

  it('rejects an unknown state', async () => {
    const res = await handler(
      apiEvent('GET', '/api/whoop/callback', { query: { code: 'c', state: 'nope' } }),
    )
    expect(location(res)).toBe('https://app.test/?whoop=error&reason=state')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects an expired state even before TTL deletion catches up', async () => {
    const state = await startConnect()
    vi.setSystemTime(Date.parse(NOW) + 601_000)
    const res = await handler(
      apiEvent('GET', '/api/whoop/callback', { query: { code: 'c', state } }),
    )
    expect(location(res)).toBe('https://app.test/?whoop=error&reason=state')
  })

  it('saves the connection and mapping, starts a backfill and lands on success', async () => {
    whoopLogin()
    const state = await startConnect()
    const res = await handler(
      apiEvent('GET', '/api/whoop/callback', { query: { code: 'the-code', state } }),
    )
    expect(location(res)).toBe('https://app.test/?whoop=connected')

    const exchange = new URLSearchParams(fetchMock.mock.calls[0][1]!.body as URLSearchParams)
    expect(exchange.get('code')).toBe('the-code')
    expect(exchange.get('redirect_uri')).toBe('https://app.test/api/whoop/callback')

    expect(getItem('USER#u1', 'WHOOP#CONNECTION')).toEqual({
      pk: 'USER#u1',
      sk: 'WHOOP#CONNECTION',
      type: 'whoop-connection',
      gsi1pk: 'WHOOPCONN',
      gsi1sk: 'u1',
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: Date.parse(NOW) + 3_600_000,
      scope: 'offline read:sleep',
      provider: 'whoop',
      externalUserId: '10129',
      whoopUserId: '10129',
      status: 'active',
      connectedAt: NOW,
    })
    expect(getItem('WHOOP#10129', 'MAPPING')).toEqual({
      pk: 'WHOOP#10129',
      sk: 'MAPPING',
      type: 'whoop-mapping',
      userId: 'u1',
    })
    expect(aws.invokes).toEqual([
      {
        FunctionName: 'sync-fn',
        InvocationType: 'Event',
        payload: { mode: 'backfill', userId: 'u1' },
      },
    ])
  })

  it('spends the state: a replayed callback is refused', async () => {
    whoopLogin()
    const state = await startConnect()
    await handler(apiEvent('GET', '/api/whoop/callback', { query: { code: 'c', state } }))
    const replay = await handler(
      apiEvent('GET', '/api/whoop/callback', { query: { code: 'c', state } }),
    )
    expect(location(replay)).toBe('https://app.test/?whoop=error&reason=state')
  })

  it('lands on an exchange error when WHOOP refuses the code', async () => {
    fetchMock.mockImplementation(async () => new Response('invalid_grant', { status: 400 }))
    const state = await startConnect()
    const res = await handler(
      apiEvent('GET', '/api/whoop/callback', { query: { code: 'c', state } }),
    )
    expect(location(res)).toBe('https://app.test/?whoop=error&reason=exchange')
    expect(getItem('USER#u1', 'WHOOP#CONNECTION')).toBeUndefined()
    expect(aws.invokes).toEqual([])
  })
})

describe('DELETE /api/whoop', () => {
  it('forgets the connection and mapping but keeps the synced history', async () => {
    putItem({ pk: 'USER#u1', sk: 'WHOOP#CONNECTION', whoopUserId: '10129', status: 'active' })
    putItem({ pk: 'WHOOP#10129', sk: 'MAPPING', userId: 'u1' })
    putItem({ pk: 'USER#u1', sk: 'SLEEP#2026-11-10T10:00:00.000Z#s1', type: 'sleep' })

    const res = await handler(apiEvent('DELETE', '/api/whoop', { user: 'u1' }))
    expect(bodyOf(res)).toEqual({ disconnected: true })
    expect(getItem('USER#u1', 'WHOOP#CONNECTION')).toBeUndefined()
    expect(getItem('WHOOP#10129', 'MAPPING')).toBeUndefined()
    expect(itemsWithPrefix('USER#u1', 'SLEEP#')).toHaveLength(1)
  })

  it('says so when there was nothing to disconnect', async () => {
    const res = await handler(apiEvent('DELETE', '/api/whoop', { user: 'u1' }))
    expect(bodyOf(res)).toEqual({ disconnected: false })
  })
})

describe('GET /api/me', () => {
  it('creates the profile on first sight and reports no strap', async () => {
    const res = await handler(apiEvent('GET', '/api/me', { user: 'u1' }))
    expect(bodyOf(res)).toEqual({
      userId: 'u1',
      createdAt: NOW,
      whoop: { connected: false },
      strap: { connected: false },
      providers: [],
    })
    expect(getItem('USER#u1', 'PROFILE')).toEqual({
      pk: 'USER#u1',
      sk: 'PROFILE',
      type: 'profile',
      userId: 'u1',
      createdAt: NOW,
    })
  })

  it('reports an active strap without leaking tokens', async () => {
    putItem({
      pk: 'USER#u1',
      sk: 'WHOOP#CONNECTION',
      accessToken: 'secret-a',
      refreshToken: 'secret-r',
      status: 'active',
      lastSyncAt: '2026-11-12T11:00:00.000Z',
      backfillDone: true,
      bodyWeightKg: 80,
    })
    const res = await handler(apiEvent('GET', '/api/me', { user: 'u1' }))
    expect(bodyOf(res).whoop).toEqual({
      connected: true,
      status: 'active',
      lastSyncAt: '2026-11-12T11:00:00.000Z',
      backfillDone: true,
      bodyWeightLb: 176.4,
    })
    expect(bodyOf(res).strap).toEqual({
      provider: 'whoop',
      connected: true,
      status: 'active',
      lastSyncAt: '2026-11-12T11:00:00.000Z',
      backfillDone: true,
      bodyWeightLb: 176.4,
      capabilities: { recoveryScore: true, strain: true, sessions: true, steps: false },
    })
    expect(asResult(res).body).not.toContain('secret-')
  })

  it('lists only the bands whose credentials are configured', async () => {
    configureWhoop()
    const res = await handler(apiEvent('GET', '/api/me', { user: 'u1' }))
    expect(bodyOf(res).providers).toEqual([{ id: 'whoop', label: 'WHOOP' }])
  })

  it('reports a strap that needs a reconnect as not connected, status error', async () => {
    putItem({ pk: 'USER#u1', sk: 'WHOOP#CONNECTION', status: 'error' })
    const res = await handler(apiEvent('GET', '/api/me', { user: 'u1' }))
    expect(bodyOf(res).whoop).toEqual({
      connected: false,
      status: 'error',
      lastSyncAt: null,
      backfillDone: false,
    })
  })
})
