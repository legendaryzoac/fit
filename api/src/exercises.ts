import { DeleteCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import type {
  LambdaFunctionURLEvent,
  LambdaFunctionURLResult,
} from 'aws-lambda'
import { TABLE_NAME, ddb } from './db'
import { json } from './http'

const str = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= max
    ? v.trim()
    : undefined

const EQUIPMENT = new Set([
  'barbell',
  'dumbbell',
  'kettlebell',
  'machine',
  'cable',
  'band',
  'bodyweight',
  'weighted',
  'other',
])

/** Optional equipment tag; anything outside the known set is dropped. */
const equipmentOf = (v: unknown): string | undefined =>
  typeof v === 'string' && EQUIPMENT.has(v) ? v : undefined

/** Custom exercises a user typed in by hand, keyed by normalized name. */
export async function handleListExercises(
  userId: string,
): Promise<LambdaFunctionURLResult> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :p)',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':p': 'EXERCISE#',
      },
    }),
  )
  return json(200, {
    exercises: (res.Items ?? []).map((i) => {
      const equipment = equipmentOf(i.equipment)
      return {
        name: i.name,
        muscle: i.muscle,
        ...(equipment && { equipment }),
      }
    }),
  })
}

export async function handleSaveExercise(
  userId: string,
  event: LambdaFunctionURLEvent,
): Promise<LambdaFunctionURLResult> {
  let raw: unknown
  try {
    const body = event.isBase64Encoded
      ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
      : (event.body ?? '')
    if (body.length > 2000) return json(400, { error: 'too large' })
    raw = JSON.parse(body)
  } catch {
    return json(400, { error: 'invalid json' })
  }
  const r = raw as Record<string, unknown>
  const name = str(r?.name, 80)
  const muscle = str(r?.muscle, 30) ?? 'other'
  const equipment = equipmentOf(r?.equipment)
  if (!name) return json(400, { error: 'name required' })

  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk: `USER#${userId}`,
        sk: `EXERCISE#${name.toLowerCase()}`,
        type: 'exercise',
        name,
        muscle,
        ...(equipment && { equipment }),
        updatedAt: new Date().toISOString(),
      },
    }),
  )
  return json(200, { saved: name })
}

export async function handleDeleteExercise(
  userId: string,
  event: LambdaFunctionURLEvent,
): Promise<LambdaFunctionURLResult> {
  const name = str(event.queryStringParameters?.name, 80)
  if (!name) return json(400, { error: 'name required' })
  await ddb.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { pk: `USER#${userId}`, sk: `EXERCISE#${name.toLowerCase()}` },
    }),
  )
  return json(200, { deleted: name })
}
