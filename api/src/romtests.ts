import { DeleteCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import type {
  LambdaFunctionURLEvent,
  LambdaFunctionURLResult,
} from 'aws-lambda'
import { TABLE_NAME, ddb } from './db'
import { json } from './http'

/**
 * Range-of-motion field tests — the slow, honest outcome for stretching
 * (stretching moves ROM, not soreness). Self-administered with a tape
 * measure every few weeks: toe-touch (fingertip-to-floor, cm; negative =
 * past the floor on a box), knee-to-wall per side (cm), hand-behind-back
 * gap per side (cm). Keyed by local date, one row per day.
 */
interface RomTest {
  date: string
  toeTouchCm?: number
  kneeToWallLCm?: number
  kneeToWallRCm?: number
  handBehindBackLCm?: number
  handBehindBackRCm?: number
  note?: string
}

const num = (v: unknown, lo: number, hi: number): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi
    ? Math.round(v * 10) / 10
    : undefined

function parseTest(raw: unknown): RomTest | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const date = typeof r.date === 'string' ? r.date.slice(0, 10) : undefined
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const test: RomTest = {
    date,
    toeTouchCm: num(r.toeTouchCm, -40, 80),
    kneeToWallLCm: num(r.kneeToWallLCm, 0, 30),
    kneeToWallRCm: num(r.kneeToWallRCm, 0, 30),
    handBehindBackLCm: num(r.handBehindBackLCm, 0, 80),
    handBehindBackRCm: num(r.handBehindBackRCm, 0, 80),
    note:
      typeof r.note === 'string' && r.note.trim().length > 0 && r.note.length <= 300
        ? r.note.trim()
        : undefined,
  }
  const measured = (Object.keys(test) as Array<keyof RomTest>).some(
    (k) => k !== 'date' && k !== 'note' && test[k] !== undefined,
  )
  return measured ? test : null
}

export async function handleListRomTests(
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
          ':prefix': 'ROMTEST#',
        },
        ExclusiveStartKey: lastKey,
      }),
    )
    items.push(...(res.Items ?? []))
    lastKey = res.LastEvaluatedKey
  } while (lastKey)

  return json(200, {
    tests: items.map(({ pk: _pk, sk: _sk, type: _t, ...rest }) => rest),
  })
}

export async function handleSaveRomTest(
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

  const test = parseTest(raw)
  if (!test) return json(400, { error: 'invalid rom test' })

  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk: `USER#${userId}`,
        sk: `ROMTEST#${test.date}`,
        type: 'romtest',
        source: 'manual',
        ...test,
        updatedAt: new Date().toISOString(),
      },
    }),
  )
  return json(200, { saved: test.date })
}

export async function handleDeleteRomTest(
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
      Key: { pk: `USER#${userId}`, sk: `ROMTEST#${date}` },
    }),
  )
  return json(200, { deleted: date })
}
