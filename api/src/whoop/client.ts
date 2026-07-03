import type { WhoopCredentials } from './config'

const AUTH_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth'
const TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token'
const API_BASE = 'https://api.prod.whoop.com/developer'

// `offline` is required to receive a refresh token
export const WHOOP_SCOPES =
  'offline read:profile read:recovery read:cycles read:sleep read:workout read:body_measurement'

export interface WhoopTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number // epoch ms
  scope: string
}

export class WhoopApiError extends Error {
  readonly status: number

  constructor(status: number, body: string) {
    super(`WHOOP API ${status}: ${body.slice(0, 300)}`)
    this.status = status
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
    scope: WHOOP_SCOPES,
    state,
  })
  return `${AUTH_URL}?${params}`
}

async function tokenRequest(
  body: Record<string, string>,
): Promise<WhoopTokens> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  })
  const text = await res.text()
  if (!res.ok) throw new WhoopApiError(res.status, text)
  const json = JSON.parse(text)
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + json.expires_in * 1000,
    scope: json.scope ?? '',
  }
}

export function exchangeCode(
  creds: WhoopCredentials,
  code: string,
  redirectUri: string,
): Promise<WhoopTokens> {
  return tokenRequest({
    grant_type: 'authorization_code',
    code,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    redirect_uri: redirectUri,
  })
}

/** WHOOP rotates both tokens on refresh — callers must persist the result. */
export function refreshTokens(
  creds: WhoopCredentials,
  refreshToken: string,
): Promise<WhoopTokens> {
  return tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    scope: 'offline',
  })
}

export async function whoopGet(
  path: string,
  accessToken: string,
  query?: Record<string, string>,
): Promise<any> {
  const url = new URL(`${API_BASE}${path}`)
  for (const [k, v] of Object.entries(query ?? {})) {
    url.searchParams.set(k, v)
  }
  let res = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
  })
  if (res.status === 429) {
    // 100 req/min per client; one generous wait-and-retry
    await new Promise((r) => setTimeout(r, 15_000))
    res = await fetch(url, {
      headers: { authorization: `Bearer ${accessToken}` },
    })
  }
  const text = await res.text()
  if (!res.ok) throw new WhoopApiError(res.status, text)
  return JSON.parse(text)
}

export function fetchWhoopProfile(
  accessToken: string,
): Promise<{ user_id: number; first_name?: string; last_name?: string }> {
  return whoopGet('/v2/user/profile/basic', accessToken)
}
