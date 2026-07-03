import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda'
import type {
  LambdaFunctionURLEvent,
  LambdaFunctionURLResult,
} from 'aws-lambda'
import { json, redirect } from '../http'
import { buildAuthorizeUrl, exchangeCode, fetchWhoopProfile } from './client'
import { getWhoopCredentials } from './config'
import {
  consumeOauthState,
  getMappedUserId,
  putMapping,
  putOauthState,
  saveConnection,
} from './store'

const lambda = new LambdaClient({})
const APP_URL = process.env.APP_URL ?? 'https://fit.zackwithers.com'
const SYNC_FUNCTION_NAME = process.env.SYNC_FUNCTION_NAME

async function triggerSync(
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

/** GET /api/whoop/connect (JWT-authenticated) → { url } to redirect to. */
export async function handleWhoopConnect(
  userId: string,
): Promise<LambdaFunctionURLResult> {
  const creds = await getWhoopCredentials()
  if (!creds) {
    return json(503, {
      error:
        'WHOOP credentials are not configured yet (SSM /fit/whoop/client-id + client-secret)',
    })
  }
  const nonce = randomUUID()
  await putOauthState(nonce, userId)
  return json(200, {
    url: buildAuthorizeUrl(
      creds.clientId,
      `${APP_URL}/api/whoop/callback`,
      nonce,
    ),
  })
}

/** GET /api/whoop/callback?code&state — browser redirect from WHOOP, no JWT. */
export async function handleWhoopCallback(
  event: LambdaFunctionURLEvent,
): Promise<LambdaFunctionURLResult> {
  try {
    const q = event.queryStringParameters ?? {}
    if (!q.code || !q.state) {
      // WHOOP rejected the authorize request (scope mismatch, denial, …) and
      // sent error/error_description instead of a code — surface them.
      console.error(
        'whoop callback missing code',
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
      return redirect(`${APP_URL}/?whoop=error&reason=${reason}${detail}`)
    }
    const userId = await consumeOauthState(q.state)
    if (!userId) {
      console.error('whoop callback: state nonce invalid or expired')
      return redirect(`${APP_URL}/?whoop=error&reason=state`)
    }

    const creds = await getWhoopCredentials()
    if (!creds) return redirect(`${APP_URL}/?whoop=error&reason=config`)

    const tokens = await exchangeCode(
      creds,
      q.code,
      `${APP_URL}/api/whoop/callback`,
    )
    const profile = await fetchWhoopProfile(tokens.accessToken)
    const whoopUserId = String(profile.user_id)

    await saveConnection(userId, {
      ...tokens,
      whoopUserId,
      status: 'active',
      connectedAt: new Date().toISOString(),
    })
    await putMapping(whoopUserId, userId)
    await triggerSync({ mode: 'backfill', userId })

    return redirect(`${APP_URL}/?whoop=connected`)
  } catch (err) {
    console.error('whoop callback failed', err)
    return redirect(`${APP_URL}/?whoop=error&reason=exchange`)
  }
}

/**
 * POST /api/whoop/webhook — signature-verified, no JWT. Acks fast (WHOOP
 * expects 2xx within ~1s) and hands the actual fetching to the sync Lambda.
 */
export async function handleWhoopWebhook(
  event: LambdaFunctionURLEvent,
): Promise<LambdaFunctionURLResult> {
  const creds = await getWhoopCredentials()
  if (!creds) return json(503, { error: 'not configured' })

  const signature = event.headers?.['x-whoop-signature']
  const timestamp = event.headers?.['x-whoop-signature-timestamp']
  if (!signature || !timestamp) return json(401, { error: 'unsigned' })
  if (Math.abs(Date.now() - Number(timestamp)) > 5 * 60_000) {
    return json(401, { error: 'stale timestamp' })
  }

  const body = event.isBase64Encoded
    ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
    : (event.body ?? '')
  const expected = createHmac('sha256', creds.clientSecret)
    .update(timestamp + body)
    .digest()
  const provided = Buffer.from(signature, 'base64')
  if (
    expected.length !== provided.length ||
    !timingSafeEqual(expected, provided)
  ) {
    return json(401, { error: 'bad signature' })
  }

  const payload = JSON.parse(body) as { user_id: number; type?: string }
  const userId = await getMappedUserId(String(payload.user_id))
  // Unknown users still get a 200 — nothing to retry, nothing to leak
  if (userId) {
    await triggerSync({ mode: 'recent', userId, reason: payload.type })
  }
  return json(200, { received: true })
}
