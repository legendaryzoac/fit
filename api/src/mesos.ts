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

interface MesoDay {
  label: string
  exercises: Array<{ name: string; setCount: number; muscle?: string }>
  /** 0=Mon … 6=Sun; two days may share one weekday (AM/PM double). */
  weekday?: number
  /** 'cardio' days run the interval timer instead of the ledger. */
  kind?: 'strength' | 'cardio'
  /** Cardio interval plan; empty/absent = stopwatch. */
  sections?: IntervalSection[]
}

interface Mesocycle {
  id: string
  name: string
  /** Total length including the final deload week. */
  weeks: number
  /** Muscle groups being emphasized this block (0–3). */
  focus: string[]
  /** The repeating microcycle — one entry per training day. */
  days: MesoDay[]
  startDate: string
  status: 'active' | 'completed' | 'abandoned'
}

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined

const str = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.length > 0 && v.length <= max ? v : undefined

function parseMeso(raw: unknown): Mesocycle | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>

  const id = str(r.id, 64)
  const name = str(r.name, 80)
  const weeks = num(r.weeks)
  const startDate = str(r.startDate, 40)
  if (!id || !name || weeks == null || weeks < 2 || weeks > 12) return null
  if (!startDate || Number.isNaN(Date.parse(startDate))) return null
  if (
    r.status !== 'active' &&
    r.status !== 'completed' &&
    r.status !== 'abandoned'
  ) {
    return null
  }

  if (!Array.isArray(r.focus) || r.focus.length > 3) return null
  const focus: string[] = []
  for (const f of r.focus) {
    const muscle = str(f, 40)
    if (!muscle) return null
    focus.push(muscle)
  }

  // Up to two sessions per weekday (AM cardio + PM lift) — 14 max.
  if (!Array.isArray(r.days) || r.days.length < 1 || r.days.length > 14) {
    return null
  }
  const days: MesoDay[] = []
  for (const d of r.days) {
    const day = d as Record<string, unknown>
    const label = str(day?.label, 60)
    if (!label || !Array.isArray(day.exercises) || day.exercises.length > 30) {
      return null
    }
    const exercises: MesoDay['exercises'] = []
    for (const e of day.exercises) {
      const ex = e as Record<string, unknown>
      const exName = str(ex?.name, 80)
      const setCount = num(ex?.setCount)
      if (!exName || setCount == null || setCount < 1 || setCount > 30) {
        return null
      }
      const muscle = str(ex?.muscle, 40)
      exercises.push({
        name: exName,
        setCount: Math.round(setCount),
        ...(muscle !== undefined && { muscle }),
      })
    }

    const weekday =
      num(day.weekday) !== undefined &&
      Number.isInteger(day.weekday) &&
      (day.weekday as number) >= 0 &&
      (day.weekday as number) <= 6
        ? (day.weekday as number)
        : undefined
    const kind =
      day.kind === 'cardio' || day.kind === 'strength'
        ? day.kind
        : undefined

    let sections: IntervalSection[] | undefined
    if (Array.isArray(day.sections)) {
      if (day.sections.length > 80) return null
      sections = []
      for (const s of day.sections) {
        const sec = s as Record<string, unknown>
        const secLabel = str(sec?.label, 40)
        const durationSec = num(sec?.durationSec)
        if (
          !secLabel ||
          durationSec == null ||
          durationSec < 1 ||
          durationSec > 7200
        ) {
          return null
        }
        sections.push({ label: secLabel, durationSec: Math.round(durationSec) })
      }
    }

    days.push({
      label,
      exercises,
      ...(weekday !== undefined && { weekday }),
      ...(kind !== undefined && { kind }),
      ...(sections !== undefined && { sections }),
    })
  }

  return {
    id,
    name,
    weeks: Math.round(weeks),
    focus,
    days,
    startDate: new Date(startDate).toISOString(),
    status: r.status,
  }
}

export async function handleListMesos(
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
          ':prefix': 'MESO#',
        },
        ExclusiveStartKey: lastKey,
      }),
    )
    items.push(...(res.Items ?? []))
    lastKey = res.LastEvaluatedKey
  } while (lastKey)

  return json(200, {
    mesos: items.map(({ pk: _pk, sk: _sk, type: _t, ...rest }) => rest),
  })
}

export async function handleSaveMeso(
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

  const meso = parseMeso(raw)
  if (!meso) return json(400, { error: 'invalid mesocycle' })

  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk: `USER#${userId}`,
        sk: `MESO#${meso.id}`,
        type: 'mesocycle',
        ...meso,
        updatedAt: new Date().toISOString(),
      },
    }),
  )
  return json(200, { saved: meso.id })
}

export async function handleDeleteMeso(
  userId: string,
  event: LambdaFunctionURLEvent,
): Promise<LambdaFunctionURLResult> {
  const id = str(event.queryStringParameters?.id, 64)
  if (!id) return json(400, { error: 'id required' })
  await ddb.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { pk: `USER#${userId}`, sk: `MESO#${id}` },
    }),
  )
  return json(200, { deleted: id })
}
