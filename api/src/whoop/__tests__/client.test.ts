import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { jsonResponse } from '../../testing/aws'
import {
  WhoopApiError,
  buildAuthorizeUrl,
  exchangeCode,
  fetchWhoopProfile,
  refreshTokens,
  whoopGet,
} from '../client'

const creds = { clientId: 'cid', clientSecret: 'csecret' }
const fetchMock = vi.fn<typeof fetch>()
const waits: number[] = []

beforeEach(() => {
  fetchMock.mockReset()
  waits.length = 0
  vi.stubGlobal('fetch', fetchMock)
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-12T12:00:00Z') })
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
    waits.push(ms ?? 0)
    fn()
    return 0
  }) as unknown as typeof setTimeout)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const formOf = (call: number) =>
  Object.fromEntries(new URLSearchParams(fetchMock.mock.calls[call][1]!.body as URLSearchParams))

describe('WHOOP client', () => {
  it('builds the authorize URL with the offline scope set', () => {
    const url = new URL(buildAuthorizeUrl('cid', 'https://app.test/api/whoop/callback', 'nonce-1'))
    expect(url.origin + url.pathname).toBe('https://api.prod.whoop.com/oauth/oauth2/auth')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'cid',
      redirect_uri: 'https://app.test/api/whoop/callback',
      scope:
        'offline read:profile read:recovery read:cycles read:sleep read:workout read:body_measurement',
      state: 'nonce-1',
    })
  })

  it('exchanges a code for tokens with an absolute expiry', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ access_token: 'a1', refresh_token: 'r1', expires_in: 3600, scope: 'offline' }),
    )
    const tokens = await exchangeCode(creds, 'the-code', 'https://app.test/api/whoop/callback')
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.prod.whoop.com/oauth/oauth2/token')
    expect(fetchMock.mock.calls[0][1]!.method).toBe('POST')
    expect(formOf(0)).toEqual({
      grant_type: 'authorization_code',
      code: 'the-code',
      client_id: 'cid',
      client_secret: 'csecret',
      redirect_uri: 'https://app.test/api/whoop/callback',
    })
    expect(tokens).toEqual({
      accessToken: 'a1',
      refreshToken: 'r1',
      expiresAt: Date.parse('2026-11-12T13:00:00Z'),
      scope: 'offline',
    })
  })

  it('refreshes with the offline scope and defaults a missing scope to empty', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ access_token: 'a2', refresh_token: 'r2', expires_in: 60 }),
    )
    const tokens = await refreshTokens(creds, 'r1')
    expect(formOf(0)).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'r1',
      client_id: 'cid',
      client_secret: 'csecret',
      scope: 'offline',
    })
    expect(tokens.scope).toBe('')
    expect(tokens.refreshToken).toBe('r2')
  })

  it('raises a WhoopApiError carrying the status on a failed token request', async () => {
    fetchMock.mockResolvedValueOnce(new Response('invalid_grant', { status: 400 }))
    const err = await refreshTokens(creds, 'dead').catch((e) => e)
    expect(err).toBeInstanceOf(WhoopApiError)
    expect(err.status).toBe(400)
  })

  it('GETs with the bearer token and query parameters', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ records: [] }))
    await whoopGet('/v2/cycle', 'tok', { limit: '25', nextToken: 'n1' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://api.prod.whoop.com/developer/v2/cycle?limit=25&nextToken=n1')
    expect(init!.headers).toEqual({ authorization: 'Bearer tok' })
    expect(waits).toEqual([])
  })

  it('waits 15 s and retries once on a 429', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('slow down', { status: 429 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
    expect(await whoopGet('/v2/cycle', 'tok')).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(waits).toEqual([15_000])
  })

  it('gives up after the one retry', async () => {
    fetchMock.mockImplementation(async () => new Response('slow down', { status: 429 }))
    const err = await whoopGet('/v2/cycle', 'tok').catch((e) => e)
    expect(err).toBeInstanceOf(WhoopApiError)
    expect(err.status).toBe(429)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('reads the basic profile', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ user_id: 10129 }))
    expect(await fetchWhoopProfile('tok')).toEqual({ user_id: 10129 })
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'https://api.prod.whoop.com/developer/v2/user/profile/basic',
    )
  })
})
