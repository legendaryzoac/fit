import {
  StrapConsentError,
  StrapNotLinkedError,
  type Credentials,
  type Tokens,
} from '../providers/types'

// The Google Health API (v4): the only route to data from a Fitbit Air.
// The band syncs to the Google Health phone app, the app to Google's
// cloud, and this reads the cloud. https://developers.google.com/health

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const API_BASE = 'https://health.googleapis.com/v4'
const SCOPE_BASE = 'https://www.googleapis.com/auth/googlehealth'

export const SCOPE = {
  sleep: `${SCOPE_BASE}.sleep.readonly`,
  vitals: `${SCOPE_BASE}.health_metrics_and_measurements.readonly`,
  activity: `${SCOPE_BASE}.activity_and_fitness.readonly`,
} as const

export const GOOGLE_SCOPES = Object.values(SCOPE)

export class GoogleApiError extends Error {
  readonly status: number
  /** OAuth's `error` code, or the API error's ErrorInfo reason. */
  readonly reason?: string

  constructor(status: number, body: string) {
    super(`Google API ${status}: ${body.slice(0, 300)}`)
    this.status = status
    try {
      const parsed = JSON.parse(body)
      this.reason =
        typeof parsed.error === 'string'
          ? parsed.error
          : parsed.error?.details?.find((d: { reason?: string }) => d.reason)?.reason
    } catch {
      // not JSON — the status is all we know
    }
  }
}

export function buildAuthorizeUrl(
  clientId: string,
  redirectUri: string,
  state: string,
): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: GOOGLE_SCOPES.join(' '),
    state,
    // Both are needed to be handed a refresh token
    access_type: 'offline',
    prompt: 'consent',
  })
  return `${AUTH_URL}?${params}`
}

async function tokenRequest(
  body: Record<string, string>,
  keepRefreshToken?: string,
): Promise<Tokens> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  })
  const text = await res.text()
  if (!res.ok) throw new GoogleApiError(res.status, text)
  const json = JSON.parse(text)
  const refreshToken = json.refresh_token ?? keepRefreshToken
  if (!refreshToken) throw new Error('Google returned no refresh token')
  return {
    accessToken: json.access_token,
    refreshToken,
    expiresAt: Date.now() + json.expires_in * 1000,
    scope: json.scope ?? '',
  }
}

export async function exchangeCode(
  creds: Credentials,
  code: string,
  redirectUri: string,
): Promise<Tokens> {
  const tokens = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    redirect_uri: redirectUri,
  })
  // The consent screen lets the user untick any scope, or all of them
  const granted = tokens.scope.split(' ')
  if (!GOOGLE_SCOPES.some((scope) => granted.includes(scope))) {
    throw new StrapConsentError('no Google Health scope was granted')
  }
  return tokens
}

/** Google keeps the same refresh token; the response carries only a new access token. */
export function refreshTokens(
  creds: Credentials,
  refreshToken: string,
): Promise<Tokens> {
  return tokenRequest(
    {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    },
    refreshToken,
  )
}

/** Revoked, expired (7 days while the OAuth app is in "Testing") or unused too long. */
export function isAuthDead(err: unknown): boolean {
  return err instanceof GoogleApiError && err.reason === 'invalid_grant'
}

async function healthFetch(
  path: string,
  accessToken: string,
  init: { query?: Record<string, string>; body?: unknown } = {},
): Promise<any> {
  const url = new URL(`${API_BASE}${path}`)
  for (const [k, v] of Object.entries(init.query ?? {})) {
    url.searchParams.set(k, v)
  }
  const request = () =>
    fetch(url, {
      method: init.body === undefined ? 'GET' : 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: 'application/json',
        ...(init.body !== undefined && { 'content-type': 'application/json' }),
      },
      ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
    })
  let res = await request()
  if (res.status === 429) {
    // 300 req/min per user; one wait-and-retry
    await new Promise((r) => setTimeout(r, 10_000))
    res = await request()
  }
  const text = await res.text()
  if (!res.ok) throw new GoogleApiError(res.status, text)
  return JSON.parse(text)
}

export const healthGet = (
  path: string,
  accessToken: string,
  query?: Record<string, string>,
) => healthFetch(path, accessToken, { query })

export const healthPost = (path: string, accessToken: string, body: unknown) =>
  healthFetch(path, accessToken, { body })

/**
 * The account's stable Google Health id (the one webhooks carry). Google
 * sign-in succeeds for any Google account, so this is also the check that
 * the account has a Google Health profile at all.
 */
export async function fetchHealthUserId(accessToken: string): Promise<string> {
  try {
    const identity = await healthGet('/users/me/identity', accessToken)
    return String(identity.healthUserId)
  } catch (err) {
    if (err instanceof GoogleApiError && err.reason === 'ACCOUNT_NOT_LINKED') {
      throw new StrapNotLinkedError('Google account has no Google Health profile')
    }
    throw err
  }
}
