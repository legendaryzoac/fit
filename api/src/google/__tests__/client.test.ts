import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StrapConsentError, StrapNotLinkedError } from '../../providers/types'
import { jsonResponse } from '../../testing/aws'
import { googleNotLinked, googleScopes } from '../../testing/google-fixtures'
import {
  GoogleApiError,
  buildAuthorizeUrl,
  exchangeCode,
  fetchHealthUserId,
  healthGet,
  healthPost,
  isAuthDead,
  refreshTokens,
} from '../client'

const creds = { clientId: 'gid', clientSecret: 'gsecret' }
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

describe('Google OAuth', () => {
  it('asks for offline access to the three read scopes, forcing consent', () => {
    const url = new URL(buildAuthorizeUrl('gid', 'https://app.test/api/google/callback', 'nonce-1'))
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'gid',
      redirect_uri: 'https://app.test/api/google/callback',
      scope: googleScopes.join(' '),
      state: 'nonce-1',
      access_type: 'offline',
      prompt: 'consent',
    })
  })

  it('exchanges a code for tokens', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        access_token: 'a1',
        refresh_token: 'r1',
        expires_in: 3599,
        scope: googleScopes.join(' '),
      }),
    )
    const tokens = await exchangeCode(creds, 'the-code', 'https://app.test/api/google/callback')
    expect(fetchMock.mock.calls[0][0]).toBe('https://oauth2.googleapis.com/token')
    expect(formOf(0)).toEqual({
      grant_type: 'authorization_code',
      code: 'the-code',
      client_id: 'gid',
      client_secret: 'gsecret',
      redirect_uri: 'https://app.test/api/google/callback',
    })
    expect(tokens).toEqual({
      accessToken: 'a1',
      refreshToken: 'r1',
      expiresAt: Date.parse('2026-11-12T12:59:59Z'),
      scope: googleScopes.join(' '),
    })
  })

  it('accepts a partial grant but refuses one with no Health scope at all', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ access_token: 'a', refresh_token: 'r', expires_in: 3599, scope: googleScopes[0] }),
    )
    await expect(exchangeCode(creds, 'c', 'https://x')).resolves.toMatchObject({
      scope: googleScopes[0],
    })
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ access_token: 'a', refresh_token: 'r', expires_in: 3599, scope: 'openid' }),
    )
    await expect(exchangeCode(creds, 'c', 'https://x')).rejects.toBeInstanceOf(StrapConsentError)
  })

  it('fails an exchange that comes back without a refresh token', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ access_token: 'a', expires_in: 3599, scope: googleScopes.join(' ') }),
    )
    await expect(exchangeCode(creds, 'c', 'https://x')).rejects.toThrow('no refresh token')
  })

  it('keeps the stored refresh token when a refresh returns none', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ access_token: 'a2', expires_in: 3599, scope: googleScopes.join(' ') }),
    )
    const tokens = await refreshTokens(creds, 'r1')
    expect(formOf(0)).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'r1',
      client_id: 'gid',
      client_secret: 'gsecret',
    })
    expect(tokens.accessToken).toBe('a2')
    expect(tokens.refreshToken).toBe('r1')
  })

  it('treats invalid_grant as a dead connection, and nothing else', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400),
    )
    const dead = await refreshTokens(creds, 'r1').catch((e) => e)
    expect(dead).toBeInstanceOf(GoogleApiError)
    expect(isAuthDead(dead)).toBe(true)

    fetchMock.mockResolvedValueOnce(new Response('upstream unavailable', { status: 503 }))
    const transient = await refreshTokens(creds, 'r1').catch((e) => e)
    expect(isAuthDead(transient)).toBe(false)
    expect(isAuthDead(new Error('network'))).toBe(false)
  })
})

describe('Google Health API calls', () => {
  it('GETs with the bearer token and query', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ dataPoints: [] }))
    await healthGet('/users/me/dataTypes/sleep/dataPoints:reconcile', 'tok', {
      filter: 'sleep.interval.civil_end_time >= "2026-11-08"',
      pageSize: '25',
    })
    const [url, init] = fetchMock.mock.calls[0]
    const parsed = new URL(String(url))
    expect(parsed.origin + parsed.pathname).toBe(
      'https://health.googleapis.com/v4/users/me/dataTypes/sleep/dataPoints:reconcile',
    )
    expect(parsed.searchParams.get('filter')).toBe('sleep.interval.civil_end_time >= "2026-11-08"')
    expect(init!.method).toBe('GET')
    expect((init!.headers as Record<string, string>).authorization).toBe('Bearer tok')
  })

  it('POSTs a JSON body', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ rollupDataPoints: [] }))
    await healthPost('/users/me/dataTypes/steps/dataPoints:dailyRollUp', 'tok', { windowSizeDays: 1 })
    const init = fetchMock.mock.calls[0][1]!
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ windowSizeDays: 1 })
  })

  it('waits and retries once on a 429', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('quota', { status: 429 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
    expect(await healthGet('/users/me/identity', 'tok')).toEqual({ ok: true })
    expect(waits).toEqual([10_000])
  })

  it('reads the Google Health user id', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ name: 'users/me/identity', legacyUserId: 'A1B2C3', healthUserId: 'abc123' }),
    )
    expect(await fetchHealthUserId('tok')).toBe('abc123')
  })

  it('recognises a Google account with no Google Health profile', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(googleNotLinked, 400))
    await expect(fetchHealthUserId('tok')).rejects.toBeInstanceOf(StrapNotLinkedError)
  })

  it('passes other API errors through with their status', async () => {
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }))
    const err = await fetchHealthUserId('tok').catch((e) => e)
    expect(err).toBeInstanceOf(GoogleApiError)
    expect(err.status).toBe(500)
  })
})
