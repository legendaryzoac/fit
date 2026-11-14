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
import { googleNotLinked, googleScopes } from '../testing/google-fixtures'

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
      syncOnOpen: false,
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

// ---- a second band: Fitbit Air through Google ----

function configureGoogle(): void {
  aws.params.set('/fit/google/client-id', 'gid')
  aws.params.set('/fit/google/client-secret', 'gsecret')
}

/** Google's token and identity endpoints, answering one login. */
function googleLogin(opts: { scope?: string; identity?: () => Response } = {}): void {
  fetchMock.mockImplementation(async (input) => {
    const url = String(input)
    if (url === 'https://oauth2.googleapis.com/token') {
      return jsonResponse({
        access_token: 'g-access',
        refresh_token: 'g-refresh',
        expires_in: 3599,
        scope: opts.scope ?? googleScopes.join(' '),
      })
    }
    if (url.endsWith('/v4/users/me/identity')) {
      return opts.identity ? opts.identity() : jsonResponse({ healthUserId: 'abc123' })
    }
    return new Response('not found', { status: 404 })
  })
}

async function startGoogleConnect(user = 'u1'): Promise<string> {
  const res = await handler(apiEvent('GET', '/api/google/connect', { user }))
  return new URL(bodyOf(res).url).searchParams.get('state')!
}

const googleCallback = (query: Record<string, string>) =>
  handler(apiEvent('GET', '/api/google/callback', { query }))

describe('Fitbit Air (Google) connect', () => {
  beforeEach(() => {
    configureWhoop()
    configureGoogle()
  })

  it('offers both bands once both are configured', async () => {
    const res = await handler(apiEvent('GET', '/api/me', { user: 'u1' }))
    expect(bodyOf(res).providers).toEqual([
      { id: 'whoop', label: 'WHOOP' },
      { id: 'google', label: 'Fitbit Air' },
    ])
  })

  it('sends the browser to Google with its own callback', async () => {
    const res = await handler(apiEvent('GET', '/api/google/connect', { user: 'u1' }))
    const url = new URL(bodyOf(res).url)
    expect(url.host).toBe('accounts.google.com')
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.test/api/google/callback')
    const nonce = url.searchParams.get('state')!
    expect(getItem(`OAUTH#${nonce}`, 'STATE')).toMatchObject({ userId: 'u1', provider: 'google' })
  })

  it('saves the connection under its own keys and starts a backfill', async () => {
    googleLogin()
    const state = await startGoogleConnect()
    const res = await googleCallback({ code: 'the-code', state })
    expect(location(res)).toBe('https://app.test/?google=connected')

    expect(getItem('USER#u1', 'GOOGLE#CONNECTION')).toEqual({
      pk: 'USER#u1',
      sk: 'GOOGLE#CONNECTION',
      type: 'google-connection',
      gsi1pk: 'GOOGLECONN',
      gsi1sk: 'u1',
      accessToken: 'g-access',
      refreshToken: 'g-refresh',
      expiresAt: Date.parse(NOW) + 3_599_000,
      scope: googleScopes.join(' '),
      provider: 'google',
      externalUserId: 'abc123',
      status: 'active',
      connectedAt: NOW,
    })
    expect(getItem('GOOGLE#abc123', 'MAPPING')).toEqual({
      pk: 'GOOGLE#abc123',
      sk: 'MAPPING',
      type: 'google-mapping',
      userId: 'u1',
    })
    expect(aws.invokes).toEqual([
      { FunctionName: 'sync-fn', InvocationType: 'Event', payload: { mode: 'backfill', userId: 'u1' } },
    ])
  })

  it('reports the strap and its capabilities in /api/me, leaving the whoop key empty', async () => {
    googleLogin()
    await googleCallback({ code: 'c', state: await startGoogleConnect() })
    const me = bodyOf(await handler(apiEvent('GET', '/api/me', { user: 'u1' })))
    expect(me.whoop).toEqual({ connected: false })
    expect(me.strap).toEqual({
      provider: 'google',
      connected: true,
      status: 'active',
      lastSyncAt: null,
      backfillDone: false,
      capabilities: { recoveryScore: false, strain: false, sessions: false, steps: true },
      syncOnOpen: true,
    })
  })

  it('tells the user to set up Google Health when the account has no profile', async () => {
    googleLogin({ identity: () => jsonResponse(googleNotLinked, 400) })
    const res = await googleCallback({ code: 'c', state: await startGoogleConnect() })
    expect(location(res)).toBe('https://app.test/?google=error&reason=not-linked')
    expect(getItem('USER#u1', 'GOOGLE#CONNECTION')).toBeUndefined()
    expect(aws.invokes).toEqual([])
  })

  it('reports a consent screen where every scope was unticked', async () => {
    googleLogin({ scope: 'openid' })
    const res = await googleCallback({ code: 'c', state: await startGoogleConnect() })
    expect(location(res)).toBe('https://app.test/?google=error&reason=consent')
    expect(getItem('USER#u1', 'GOOGLE#CONNECTION')).toBeUndefined()
  })

  it('refuses a state issued for the other band', async () => {
    googleLogin()
    const whoopState = await startConnect()
    const res = await googleCallback({ code: 'c', state: whoopState })
    expect(location(res)).toBe('https://app.test/?google=error&reason=state')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('one strap per user', () => {
  beforeEach(() => {
    configureWhoop()
    configureGoogle()
    putItem({ pk: 'USER#u1', sk: 'WHOOP#CONNECTION', whoopUserId: '10129', status: 'active' })
    putItem({ pk: 'WHOOP#10129', sk: 'MAPPING', userId: 'u1' })
  })

  it('answers 409 to connecting a second band', async () => {
    const res = await handler(apiEvent('GET', '/api/google/connect', { user: 'u1' }))
    expect(asResult(res).statusCode).toBe(409)
    expect(bodyOf(res).provider).toBe('whoop')
  })

  it('still lets the linked band be reconnected', async () => {
    const res = await handler(apiEvent('GET', '/api/whoop/connect', { user: 'u1' }))
    expect(asResult(res).statusCode).toBe(200)
  })

  it('re-checks at the callback, in case the other band was linked meanwhile', async () => {
    aws.items.delete('USER#u1|WHOOP#CONNECTION')
    const state = await startGoogleConnect()
    putItem({ pk: 'USER#u1', sk: 'WHOOP#CONNECTION', whoopUserId: '10129', status: 'active' })
    googleLogin()
    const res = await googleCallback({ code: 'c', state })
    expect(location(res)).toBe('https://app.test/?google=error&reason=other-strap')
    expect(getItem('USER#u1', 'GOOGLE#CONNECTION')).toBeUndefined()
  })

  it('disconnects whichever band is linked, whatever the route names', async () => {
    const res = await handler(apiEvent('DELETE', '/api/google', { user: 'u1' }))
    expect(bodyOf(res)).toEqual({ disconnected: true })
    expect(getItem('USER#u1', 'WHOOP#CONNECTION')).toBeUndefined()
    expect(getItem('WHOOP#10129', 'MAPPING')).toBeUndefined()
  })

  it('leaves unrelated DELETE routes alone', async () => {
    const res = await handler(apiEvent('DELETE', '/api/strap', { user: 'u1' }))
    expect(asResult(res).statusCode).toBe(404)
    expect(getItem('USER#u1', 'WHOOP#CONNECTION')).toBeDefined()
  })
})

describe('POST /api/strap/sync', () => {
  const sync = (user = 'u1') => handler(apiEvent('POST', '/api/strap/sync', { user }))
  const google = (over: Record<string, unknown> = {}) =>
    putItem({ pk: 'USER#u1', sk: 'GOOGLE#CONNECTION', status: 'active', ...over })

  it('starts a recent sync for a band that does not push changes', async () => {
    google({ lastSyncAt: '2026-11-12T11:00:00.000Z' })
    expect(bodyOf(await sync())).toEqual({ started: true })
    expect(aws.invokes).toEqual([
      {
        FunctionName: 'sync-fn',
        InvocationType: 'Event',
        payload: { mode: 'recent', userId: 'u1', reason: 'app-open' },
      },
    ])
    expect(getItem('USER#u1', 'GOOGLE#CONNECTION')!.syncRequestedAt).toBe(NOW)
  })

  it('does nothing within ten minutes of the last sync or request', async () => {
    google({ lastSyncAt: '2026-11-12T11:51:00.000Z' })
    expect(bodyOf(await sync())).toEqual({ started: false, reason: 'recent' })
    google({ lastSyncAt: '2026-11-12T09:00:00.000Z' })
    expect(bodyOf(await sync())).toEqual({ started: true })
    // The request itself now holds the next one off, before any sync lands
    expect(bodyOf(await sync())).toEqual({ started: false, reason: 'recent' })
    expect(aws.invokes).toHaveLength(1)
  })

  it('syncs a freshly connected band that has never synced', async () => {
    google()
    expect(bodyOf(await sync())).toEqual({ started: true })
  })

  it('leaves WHOOP to its webhooks', async () => {
    putItem({ pk: 'USER#u1', sk: 'WHOOP#CONNECTION', status: 'active' })
    expect(bodyOf(await sync())).toEqual({ started: false, reason: 'pushed' })
    expect(aws.invokes).toEqual([])
  })

  it('does nothing without a strap, or with one awaiting reconnect', async () => {
    expect(bodyOf(await sync())).toEqual({ started: false, reason: 'not-connected' })
    google({ status: 'error' })
    expect(bodyOf(await sync())).toEqual({ started: false, reason: 'not-connected' })
    expect(aws.invokes).toEqual([])
  })
})
