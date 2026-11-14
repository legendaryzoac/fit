import { randomUUID } from 'node:crypto'
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda'
import type {
  LambdaFunctionURLEvent,
  LambdaFunctionURLResult,
} from 'aws-lambda'
import { json, redirect } from '../http'
import { getCredentials } from './config'
import {
  consumeOauthState,
  deleteConnection,
  loadConnection,
  putMapping,
  putOauthState,
  saveConnection,
} from './store'
import { StrapNotLinkedError, type StrapProvider } from './types'

const lambda = new LambdaClient({})
const APP_URL = process.env.APP_URL ?? 'https://fit.zackwithers.com'
const SYNC_FUNCTION_NAME = process.env.SYNC_FUNCTION_NAME

export async function triggerSync(
  payload: Record<string, unknown>,
): Promise<void> {
  if (!SYNC_FUNCTION_NAME) return
  await lambda.send(
    new InvokeCommand({
      FunctionName: SYNC_FUNCTION_NAME,
      InvocationType: 'Event',
      Payload: JSON.stringify(payload),
    }),
  )
}

const callbackUrl = (provider: StrapProvider) =>
  `${APP_URL}/api/${provider.id}/callback`

/** Where the browser lands after the vendor's consent screen. */
const landing = (provider: StrapProvider, outcome: string) =>
  redirect(`${APP_URL}/?${provider.id}=${outcome}`)

/** GET /api/<provider>/connect (JWT-authenticated) → { url } to redirect to. */
export async function handleConnect(
  provider: StrapProvider,
  userId: string,
): Promise<LambdaFunctionURLResult> {
  const creds = await getCredentials(provider)
  if (!creds) {
    return json(503, {
      error: `${provider.label} credentials are not configured yet (SSM ${provider.ssmPrefix}/client-id + client-secret)`,
    })
  }
  // One strap per user: switching bands means disconnecting first
  const existing = await loadConnection(userId)
  if (existing && existing.provider !== provider.id) {
    return json(409, { error: 'another strap is connected', provider: existing.provider })
  }
  const nonce = randomUUID()
  await putOauthState(nonce, userId, provider.id)
  return json(200, {
    url: provider.authorizeUrl(creds, callbackUrl(provider), nonce),
  })
}

/** DELETE /api/<provider> (JWT-authenticated) — disconnect and forget the strap. */
export async function handleDisconnect(
  userId: string,
): Promise<LambdaFunctionURLResult> {
  const removed = await deleteConnection(userId)
  return json(200, { disconnected: removed })
}

/** GET /api/<provider>/callback?code&state — browser redirect from the vendor, no JWT. */
export async function handleCallback(
  provider: StrapProvider,
  event: LambdaFunctionURLEvent,
): Promise<LambdaFunctionURLResult> {
  try {
    const q = event.queryStringParameters ?? {}
    if (!q.code || !q.state) {
      // The vendor rejected the authorize request (scope mismatch, denial, …)
      // and sent error/error_description instead of a code — surface them.
      console.error(
        `${provider.id} callback missing code`,
        JSON.stringify({
          keys: Object.keys(q),
          error: q.error,
          error_description: q.error_description,
        }),
      )
      const reason = encodeURIComponent(q.error ?? 'missing-params')
      const detail = q.error_description
        ? `&detail=${encodeURIComponent(q.error_description)}`
        : ''
      return landing(provider, `error&reason=${reason}${detail}`)
    }
    const state = await consumeOauthState(q.state)
    if (!state || state.provider !== provider.id) {
      console.error(`${provider.id} callback: state nonce invalid or expired`)
      return landing(provider, 'error&reason=state')
    }
    const { userId } = state

    const creds = await getCredentials(provider)
    if (!creds) return landing(provider, 'error&reason=config')

    const existing = await loadConnection(userId)
    if (existing && existing.provider !== provider.id) {
      return landing(provider, 'error&reason=other-strap')
    }

    const tokens = await provider.exchangeCode(creds, q.code, callbackUrl(provider))
    const { externalUserId } = await provider.identify(tokens.accessToken)

    await saveConnection(userId, {
      ...tokens,
      provider: provider.id,
      externalUserId,
      status: 'active',
      connectedAt: new Date().toISOString(),
    })
    await putMapping(provider, externalUserId, userId)
    await triggerSync({ mode: 'backfill', userId })

    return landing(provider, 'connected')
  } catch (err) {
    console.error(`${provider.id} callback failed`, err)
    if (err instanceof StrapNotLinkedError) {
      return landing(provider, 'error&reason=not-linked')
    }
    return landing(provider, 'error&reason=exchange')
  }
}
