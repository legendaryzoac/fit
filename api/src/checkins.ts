import { DeleteCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import type {
  LambdaFunctionURLEvent,
  LambdaFunctionURLResult,
} from 'aws-lambda'
import { TABLE_NAME, ddb } from './db'
import { json } from './http'

/**
 * Daily subjective check-in — the wearable-free readiness signal. Four
 * single items (sleep quality, fatigue, soreness, stress) on 1–5 plus an
 * optional 0–10 Perceived Recovery Status taken before a session. Keyed by
 * the lifter's LOCAL calendar date (like WEIGHT#) so one row per day
 * overwrites cleanly and offline retries are idempotent. Stored per item,
 * never as a composite: the literature is clear that the items carry the
 * signal and a summed score hides it.
 *
 * NOT under the RECOVERY# prefix — that belongs to WHOOP recovery scores
 * and is range-swept by /api/metrics.
 */
interface CheckinEntry {
  /** YYYY-MM-DD, local date. */
  date: string
  sleep?: number
  fatigue?: number
  soreness?: number
  stress?: number
  mood?: number
  /** Body regions that feel sore; free vocabulary, capped. */
  soreRegions?: string[]
  /** Perceived Recovery Status, 0 = very poorly … 10 = fully recovered. */
  prs?: number
  /** Manual morning measurements, optional. */
  restingHr?: number
  hrvMs?: number
  note?: string
}

const int = (v: unknown, lo: number, hi: number): number | undefined =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi
    ? v
    : undefined

const num = (v: unknown, lo: number, hi: number): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi
    ? v
    : undefined

const str = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= max
    ? v.trim()
    : undefined

function parseEntry(raw: unknown): CheckinEntry | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const date = typeof r.date === 'string' ? r.date.slice(0, 10) : undefined
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null

  let soreRegions: string[] | undefined
  if (Array.isArray(r.soreRegions)) {
    soreRegions = r.soreRegions
      .map((s) => str(s, 40))
      .filter((s): s is string => s !== undefined)
      .slice(0, 10)
    if (soreRegions.length === 0) soreRegions = undefined
  }

  const entry: CheckinEntry = {
    date,
    sleep: int(r.sleep, 1, 5),
    fatigue: int(r.fatigue, 1, 5),
    soreness: int(r.soreness, 1, 5),
    stress: int(r.stress, 1, 5),
    mood: int(r.mood, 1, 5),
    soreRegions,
    prs: int(r.prs, 0, 10),
    restingHr:
      num(r.restingHr, 30, 220) !== undefined
        ? Math.round(r.restingHr as number)
        : undefined,
    hrvMs:
      num(r.hrvMs, 1, 400) !== undefined
        ? Math.round((r.hrvMs as number) * 10) / 10
        : undefined,
    note: str(r.note, 300),
  }

  // A date alone is not a check-in.
  const hasContent = (Object.keys(entry) as Array<keyof CheckinEntry>).some(
    (k) => k !== 'date' && entry[k] !== undefined,
  )
  if (!hasContent) return null
  return entry
}

export async function handleListCheckins(
  userId: string,
  event: LambdaFunctionURLEvent,
): Promise<LambdaFunctionURLResult> {
  const daysRaw = Number(event.queryStringParameters?.days ?? '90')
  const days = Math.min(
    Math.max(Number.isFinite(daysRaw) ? daysRaw : 90, 7),
    730,
  )
  // Local-date keys sort lexically; one extra day covers the UTC/local skew.
  const from = new Date(Date.now() - (days + 1) * 86_400_000)
    .toISOString()
    .slice(0, 10)

  const items: Record<string, any>[] = []
  let lastKey: Record<string, unknown> | undefined
  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND sk BETWEEN :from AND :to',
        ExpressionAttributeValues: {
          ':pk': `USER#${userId}`,
          ':from': `CHECKIN#${from}`,
          ':to': 'CHECKIN#~',
        },
        ExclusiveStartKey: lastKey,
      }),
    )
    items.push(...(res.Items ?? []))
    lastKey = res.LastEvaluatedKey
  } while (lastKey)

  return json(200, {
    days,
    checkins: items.map(({ pk: _pk, sk: _sk, type: _t, ...rest }) => rest),
  })
}

export async function handleSaveCheckin(
  userId: string,
  event: LambdaFunctionURLEvent,
): Promise<LambdaFunctionURLResult> {
  let raw: unknown
  try {
    const body = event.isBase64Encoded
      ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
      : (event.body ?? '')
    if (body.length > 4_000) return json(400, { error: 'too large' })
    raw = JSON.parse(body)
  } catch {
    return json(400, { error: 'invalid json' })
  }

  const entry = parseEntry(raw)
  if (!entry) return json(400, { error: 'invalid checkin' })

  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk: `USER#${userId}`,
        sk: `CHECKIN#${entry.date}`,
        type: 'checkin',
        source: 'manual',
        ...entry,
        updatedAt: new Date().toISOString(),
      },
    }),
  )
  return json(200, { saved: entry.date })
}

export async function handleDeleteCheckin(
  userId: string,
  event: LambdaFunctionURLEvent,
): Promise<LambdaFunctionURLResult> {
  const date = event.queryStringParameters?.date?.slice(0, 10)
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return json(400, { error: 'date required' })
  }
  await ddb.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { pk: `USER#${userId}`, sk: `CHECKIN#${date}` },
    }),
  )
  return json(200, { deleted: date })
}
