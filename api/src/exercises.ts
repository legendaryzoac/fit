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
    exercises: (res.Items ?? []).map((i) => ({
      name: i.name,
      muscle: i.muscle,
    })),
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
