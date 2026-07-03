import {
  DeleteCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb'
import type {
  LambdaFunctionURLEvent,
  LambdaFunctionURLResult,
} from 'aws-lambda'
import { TABLE_NAME, ddb } from './db'
import { json } from './http'

interface WorkoutSet {
  weight?: number
  reps?: number
  rpe?: number
  durationSec?: number
  distanceM?: number
}

interface WorkoutExercise {
  name: string
  sets: WorkoutSet[]
}

interface IntervalSection {
  label: string
  durationSec: number
}

const KINDS = ['strength', 'speed', 'cardio'] as const
type WorkoutKind = (typeof KINDS)[number]

interface Workout {
  id: string
  start: string
  end?: string
  kind: WorkoutKind
  title?: string
  weightUnit: 'lb' | 'kg'
  notes?: string
  exercises: WorkoutExercise[]
  intervals?: IntervalSection[]
  linkedSessionSk?: string
  durationMin?: number
  distanceM?: number
  /** When an edit changed the start time: the old start whose row must go. */
  previousStart?: string
}

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined

const str = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.length > 0 && v.length <= max ? v : undefined

/** Whitelist-parse an incoming workout; returns null when structurally invalid. */
function parseWorkout(raw: unknown): Workout | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>

  const id = str(r.id, 64)
  const start = str(r.start, 40)
  if (!id || !start || Number.isNaN(Date.parse(start))) return null
  if (!KINDS.includes(r.kind as WorkoutKind)) return null
  const weightUnit = r.weightUnit === 'kg' ? 'kg' : 'lb'

  if (!Array.isArray(r.exercises) || r.exercises.length > 30) return null
  const exercises: WorkoutExercise[] = []
  for (const e of r.exercises) {
    const name = str((e as Record<string, unknown>)?.name, 80)
    const setsRaw = (e as Record<string, unknown>)?.sets
    if (!name || !Array.isArray(setsRaw) || setsRaw.length > 30) return null
    exercises.push({
      name,
      sets: setsRaw.map((s: Record<string, unknown>) => ({
        weight: num(s?.weight),
        reps: num(s?.reps),
        rpe: num(s?.rpe),
        durationSec: num(s?.durationSec),
        distanceM: num(s?.distanceM),
      })),
    })
  }

  // Interval-timer workouts (speed/cardio) record their executed plan
  let intervals: IntervalSection[] | undefined
  if (Array.isArray(r.intervals)) {
    if (r.intervals.length > 80) return null
    intervals = []
    for (const s of r.intervals) {
      const label = str((s as Record<string, unknown>)?.label, 40)
      const durationSec = num((s as Record<string, unknown>)?.durationSec)
      if (!label || durationSec == null || durationSec < 1 || durationSec > 7200) {
        return null
      }
      intervals.push({ label, durationSec: Math.round(durationSec) })
    }
  }

  return {
    id,
    start: new Date(start).toISOString(),
    end: str(r.end, 40),
    kind: r.kind as WorkoutKind,
    intervals,
    title: str(r.title, 120),
    weightUnit,
    notes: str(r.notes, 2000),
    exercises,
    linkedSessionSk:
      typeof r.linkedSessionSk === 'string' &&
      r.linkedSessionSk.startsWith('SESSION#')
        ? r.linkedSessionSk
        : undefined,
    durationMin: num(r.durationMin),
    distanceM: num(r.distanceM),
    previousStart:
      str(r.previousStart, 40) && !Number.isNaN(Date.parse(r.previousStart as string))
        ? new Date(r.previousStart as string).toISOString()
        : undefined,
  }
}

function parseBody(event: LambdaFunctionURLEvent): unknown {
  const body = event.isBase64Encoded
    ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
    : (event.body ?? '')
  if (body.length > 64_000) return null
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

export async function handleSaveWorkout(
  userId: string,
  event: LambdaFunctionURLEvent,
): Promise<LambdaFunctionURLResult> {
  const parsed = parseWorkout(parseBody(event))
  if (!parsed) return json(400, { error: 'invalid workout' })
  const { previousStart, ...workout } = parsed

  const item = {
    pk: `USER#${userId}`,
    // Server-derived key: same client id + start always lands on the
    // same item, which makes offline-queue retries idempotent.
    sk: `WORKOUT#${workout.start}#${workout.id}`,
    type: 'workout',
    source: 'manual',
    ...workout,
    updatedAt: new Date().toISOString(),
  }

  if (previousStart && previousStart !== workout.start) {
    // Backdated edit: the start time lives in the sort key, so a changed
    // start is a move — write the new row and drop the old one atomically.
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          { Put: { TableName: TABLE_NAME, Item: item } },
          {
            Delete: {
              TableName: TABLE_NAME,
              Key: {
                pk: `USER#${userId}`,
                sk: `WORKOUT#${previousStart}#${workout.id}`,
              },
            },
          },
        ],
      }),
    )
  } else {
    await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }))
  }
  return json(200, { saved: workout.id })
}

export async function handleListWorkouts(
  userId: string,
  event: LambdaFunctionURLEvent,
): Promise<LambdaFunctionURLResult> {
  const daysRaw = Number(event.queryStringParameters?.days ?? '120')
  const days = Math.min(Math.max(Number.isFinite(daysRaw) ? daysRaw : 120, 7), 730)
  const startIso = new Date(Date.now() - days * 86_400_000).toISOString()

  const items: Record<string, any>[] = []
  let lastKey: Record<string, unknown> | undefined
  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND sk BETWEEN :from AND :to',
        ExpressionAttributeValues: {
          ':pk': `USER#${userId}`,
          ':from': `WORKOUT#${startIso}`,
          ':to': 'WORKOUT#~',
        },
        ScanIndexForward: false,
        ExclusiveStartKey: lastKey,
      }),
    )
    items.push(...(res.Items ?? []))
    lastKey = res.LastEvaluatedKey
  } while (lastKey)

  return json(200, {
    workouts: items.map(({ pk: _pk, sk: _sk, type: _t, ...rest }) => rest),
  })
}

export async function handleDeleteWorkout(
  userId: string,
  event: LambdaFunctionURLEvent,
): Promise<LambdaFunctionURLResult> {
  const q = event.queryStringParameters ?? {}
  const id = str(q.id, 64)
  const start = str(q.start, 40)
  if (!id || !start || Number.isNaN(Date.parse(start))) {
    return json(400, { error: 'id and start required' })
  }
  await ddb.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: {
        pk: `USER#${userId}`,
        sk: `WORKOUT#${new Date(start).toISOString()}#${id}`,
      },
    }),
  )
  return json(200, { deleted: id })
}
