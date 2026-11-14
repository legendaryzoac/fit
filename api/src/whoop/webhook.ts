import { createHmac, timingSafeEqual } from 'node:crypto'
import type {
  LambdaFunctionURLEvent,
  LambdaFunctionURLResult,
} from 'aws-lambda'
import { json } from '../http'
import { getCredentials } from '../providers/config'
import { triggerSync } from '../providers/routes'
import { getMappedUserId } from '../providers/store'
import { whoop } from './provider'

/**
 * POST (WHOOP webhook function URL) — signature-verified, no JWT. Acks fast
 * (WHOOP expects 2xx within ~1s) and hands the actual fetching to the sync
 * Lambda.
 */
export async function handleWhoopWebhook(
  event: LambdaFunctionURLEvent,
): Promise<LambdaFunctionURLResult> {
  const creds = await getCredentials(whoop)
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
  const userId = await getMappedUserId(whoop, String(payload.user_id))
  // Unknown users still get a 200 — nothing to retry, nothing to leak
  if (userId) {
    await triggerSync({ mode: 'recent', userId, reason: payload.type })
  }
  return json(200, { received: true })
}
