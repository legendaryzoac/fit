import { DeleteCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import type {
  LambdaFunctionURLEvent,
  LambdaFunctionURLResult,
} from 'aws-lambda'
import { TABLE_NAME, ddb } from './db'
import { json } from './http'

interface IntervalSection {
  label: string
  durationSec: number
}

interface Template {
  id: string
  name: string
  kind: 'strength' | 'speed' | 'cardio'
  exercises?: Array<{ name: string; setCount: number }>
  sections?: IntervalSection[]
}

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined

const str = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.length > 0 && v.length <= max ? v : undefined

function parseTemplate(raw: unknown): Template | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>

  const id = str(r.id, 64)
  const name = str(r.name, 60)
  if (!id || !name) return null
  if (r.kind !== 'strength' && r.kind !== 'speed' && r.kind !== 'cardio') {
    return null
  }

  let exercises: Template['exercises']
  if (Array.isArray(r.exercises)) {
    if (r.exercises.length > 30) return null
    exercises = []
    for (const e of r.exercises) {
      const exName = str((e as Record<string, unknown>)?.name, 80)
      const setCount = num((e as Record<string, unknown>)?.setCount)
      if (!exName || setCount == null || setCount < 1 || setCount > 30) {
        return null
      }
      exercises.push({ name: exName, setCount: Math.round(setCount) })
    }
  }

  let sections: Template['sections']
  if (Array.isArray(r.sections)) {
    if (r.sections.length > 80) return null
    sections = []
    for (const s of r.sections) {
      const label = str((s as Record<string, unknown>)?.label, 40)
      const durationSec = num((s as Record<string, unknown>)?.durationSec)
      if (!label || durationSec == null || durationSec < 1 || durationSec > 7200) {
        return null
      }
      sections.push({ label, durationSec: Math.round(durationSec) })
    }
  }

  return { id, name, kind: r.kind, exercises, sections }
}

export async function handleListTemplates(
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
          ':prefix': 'TEMPLATE#',
        },
        ExclusiveStartKey: lastKey,
      }),
    )
    items.push(...(res.Items ?? []))
    lastKey = res.LastEvaluatedKey
  } while (lastKey)

  return json(200, {
    templates: items.map(({ pk: _pk, sk: _sk, type: _t, ...rest }) => rest),
  })
}

export async function handleSaveTemplate(
  userId: string,
  event: LambdaFunctionURLEvent,
): Promise<LambdaFunctionURLResult> {
  let raw: unknown
  try {
    const body = event.isBase64Encoded
      ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
      : (event.body ?? '')
    if (body.length > 32_000) return json(400, { error: 'too large' })
    raw = JSON.parse(body)
  } catch {
    return json(400, { error: 'invalid json' })
  }

  const template = parseTemplate(raw)
  if (!template) return json(400, { error: 'invalid template' })

  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk: `USER#${userId}`,
        sk: `TEMPLATE#${template.id}`,
        type: 'template',
        ...template,
        updatedAt: new Date().toISOString(),
      },
    }),
  )
  return json(200, { saved: template.id })
}

export async function handleDeleteTemplate(
  userId: string,
  event: LambdaFunctionURLEvent,
): Promise<LambdaFunctionURLResult> {
  const id = str(event.queryStringParameters?.id, 64)
  if (!id) return json(400, { error: 'id required' })
  await ddb.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { pk: `USER#${userId}`, sk: `TEMPLATE#${id}` },
    }),
  )
  return json(200, { deleted: id })
}
