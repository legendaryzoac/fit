import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import type {
  LambdaFunctionURLEvent,
  LambdaFunctionURLResult,
} from 'aws-lambda'
import { TABLE_NAME, ddb } from './db'
import { json } from './http'

/**
 * Manually logged body weight. Keyed by local calendar date so one entry
 * per day overwrites cleanly, and kept independent of WHOOP so the app
 * still knows your mass when a strap or subscription goes away.
 */
interface WeightEntry {
  /** YYYY-MM-DD, the lifter's local date. */
  date: string
  lb: number
}

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined

function parseEntry(raw: unknown): WeightEntry | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const date = typeof r.date === 'string' ? r.date.slice(0, 10) : undefined
  const lb = num(r.lb)
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  if (lb == null || lb < 40 || lb > 1200) return null
  return { date, lb: Math.round(lb * 10) / 10 }
}

export async function handleListWeights(
  userId: string,
): Promise<LambdaFunctionURLResult> {
  const items: Record<string, any>[] = []
  let lastKey: Record<string, unknown> | undefined
  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `USER#${userId}`,
          ':prefix': 'WEIGHT#',
        },
        ExclusiveStartKey: lastKey,
      }),
    )
    items.push(...(res.Items ?? []))
    lastKey = res.LastEvaluatedKey
  } while (lastKey)

  return json(200, {
    weights: items.map(({ pk: _pk, sk: _sk, type: _t, ...rest }) => rest),
  })
}

export async function handleSaveWeight(
  userId: string,
  event: LambdaFunctionURLEvent,
): Promise<LambdaFunctionURLResult> {
  let raw: unknown
  try {
    const body = event.isBase64Encoded
      ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
      : (event.body ?? '')
    if (body.length > 2_000) return json(400, { error: 'too large' })
    raw = JSON.parse(body)
  } catch {
    return json(400, { error: 'invalid json' })
  }

  const entry = parseEntry(raw)
  if (!entry) return json(400, { error: 'invalid weight' })

  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk: `USER#${userId}`,
        sk: `WEIGHT#${entry.date}`,
        type: 'weight',
        ...entry,
        updatedAt: new Date().toISOString(),
      },
    }),
  )
  return json(200, { saved: entry.date })
}
