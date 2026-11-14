import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { asResult, aws, bodyOf, putItem, resetAws } from '../testing/aws'

vi.mock('../db', async () => (await import('../testing/aws')).dbMock())
vi.mock('@aws-sdk/client-s3', async () => (await import('../testing/aws')).s3Mock())
vi.mock('@aws-sdk/client-lambda', async () => (await import('../testing/aws')).lambdaMock())
vi.mock('@aws-sdk/client-ssm', async () => (await import('../testing/aws')).ssmMock())

// The public WHOOP webhook receiver: the HMAC is its only authentication.

const NOW = Date.parse('2026-11-12T12:00:00.000Z')
let handler: (event: any) => Promise<unknown>

function signed(
  payload: unknown,
  opts: { secret?: string; timestamp?: number; base64?: boolean } = {},
): any {
  const body = JSON.stringify(payload)
  const timestamp = String(opts.timestamp ?? NOW)
  const signature = createHmac('sha256', opts.secret ?? 'csecret')
    .update(timestamp + body)
    .digest('base64')
  return {
    headers: { 'x-whoop-signature': signature, 'x-whoop-signature-timestamp': timestamp },
    body: opts.base64 ? Buffer.from(body).toString('base64') : body,
    isBase64Encoded: opts.base64 ?? false,
  }
}

beforeEach(async () => {
  resetAws()
  aws.params.set('/fit/whoop/client-id', 'cid')
  aws.params.set('/fit/whoop/client-secret', 'csecret')
  putItem({ pk: 'WHOOP#10129', sk: 'MAPPING', userId: 'u1' })
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(NOW) })
  process.env.SYNC_FUNCTION_NAME = 'sync-fn'
  vi.resetModules()
  handler = (await import('../webhook')).handler as typeof handler
})

afterEach(() => {
  vi.useRealTimers()
})

describe('WHOOP webhook', () => {
  it('answers 503 while the client secret is not configured', async () => {
    aws.params.clear()
    vi.resetModules()
    handler = (await import('../webhook')).handler as typeof handler
    expect(asResult(await handler(signed({ user_id: 10129 }))).statusCode).toBe(503)
  })

  it('refuses an unsigned request', async () => {
    const res = await handler({ headers: {}, body: '{}', isBase64Encoded: false })
    expect(asResult(res).statusCode).toBe(401)
    expect(aws.invokes).toEqual([])
  })

  it('refuses a timestamp more than five minutes off', async () => {
    const res = await handler(signed({ user_id: 10129 }, { timestamp: NOW - 6 * 60_000 }))
    expect(asResult(res).statusCode).toBe(401)
    expect(bodyOf(res)).toEqual({ error: 'stale timestamp' })
  })

  it('refuses a signature made with another secret, or over another body', async () => {
    const wrongSecret = await handler(signed({ user_id: 10129 }, { secret: 'other' }))
    expect(asResult(wrongSecret).statusCode).toBe(401)
    const tampered = { ...signed({ user_id: 10129 }), body: JSON.stringify({ user_id: 99999 }) }
    expect(asResult(await handler(tampered)).statusCode).toBe(401)
    expect(aws.invokes).toEqual([])
  })

  it('starts a recent sync for the mapped user and acks', async () => {
    const res = await handler(signed({ user_id: 10129, type: 'recovery.updated' }))
    expect(asResult(res).statusCode).toBe(200)
    expect(bodyOf(res)).toEqual({ received: true })
    expect(aws.invokes).toEqual([
      {
        FunctionName: 'sync-fn',
        InvocationType: 'Event',
        payload: { mode: 'recent', userId: 'u1', reason: 'recovery.updated' },
      },
    ])
  })

  it('verifies a base64-encoded body against its decoded text', async () => {
    const res = await handler(signed({ user_id: 10129, type: 'sleep.updated' }, { base64: true }))
    expect(asResult(res).statusCode).toBe(200)
    expect(aws.invokes).toHaveLength(1)
  })

  it('acks an unknown WHOOP user without syncing anything', async () => {
    const res = await handler(signed({ user_id: 555 }))
    expect(asResult(res).statusCode).toBe(200)
    expect(aws.invokes).toEqual([])
  })
})
