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
  /** Recovery holds: which side this set was (absent = bilateral). */
  side?: 'L' | 'R'
}

interface WorkoutExercise {
  name: string
  sets: WorkoutSet[]
}

interface IntervalSection {
  label: string
  durationSec: number
}

const KINDS = ['strength', 'speed', 'cardio', 'recovery'] as const
type WorkoutKind = (typeof KINDS)[number]

// Recovery sessions: guided routines (stretch/mobility/foamroll/breath) run
// in the timer; the rest are quick logs. Stored on the same WORKOUT# row so
// history, drafts and the offline queue need nothing new.
const MODALITIES = [
  'stretch',
  'mobility',
  'foamroll',
  'breath',
  'cold',
  'sauna',
  'contrast',
  'walk',
  'massage',
  'other',
] as const
type Modality = (typeof MODALITIES)[number]

/** Per-modality dose: temperature/rounds for heat & cold, region for rolling. */
interface RecoveryDose {
  tempC?: number
  rounds?: number
  region?: string
}

/** Pre/post stiffness or feel, 1–5. Deliberately NOT WorkoutFeedback: that
 * shape carries RP autoregulation semantics read by the progression engine. */
interface RecoveryRating {
  pre?: number
  post?: number
}

const DIFFICULTIES = ['easy', 'right', 'hard'] as const
const VOLUMES = ['low', 'right', 'high'] as const
type Difficulty = (typeof DIFFICULTIES)[number]
type VolumeRating = (typeof VOLUMES)[number]

interface WorkoutFeedback {
  overall?: Difficulty
  muscles: Record<string, { difficulty: Difficulty; volume: VolumeRating }>
}

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
  /** End-of-session autoregulation ratings (per muscle group). */
  feedback?: WorkoutFeedback
  /** Ties the workout to the mesocycle that prescribed it. */
  mesoId?: string
  /** Which microcycle day this session was (index into the meso's days). */
  mesoDayIndex?: number
  /** Recovery kind only (accepted on any kind, ignored elsewhere). */
  modality?: Modality
  dose?: RecoveryDose
  rating?: RecoveryRating
  /** Whole-session CR-10 (0–10, half steps) — session-RPE load = rpe × min. */
  sessionRpe?: number
  /** When an edit changed the start time: the old start whose row must go. */
  previousStart?: string
}

const int = (v: unknown, lo: number, hi: number): number | undefined =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi
    ? v
    : undefined

const parseSide = (v: unknown): 'L' | 'R' | undefined =>
  v === 'L' || v === 'R' ? v : undefined

/** Optional enhancement: malformed dose is dropped, not a 400. */
function parseDose(raw: unknown): RecoveryDose | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const r = raw as Record<string, unknown>
  const tempC =
    typeof r.tempC === 'number' &&
    Number.isFinite(r.tempC) &&
    r.tempC >= -30 &&
    r.tempC <= 120
      ? Math.round(r.tempC * 10) / 10
      : undefined
  const rounds = int(r.rounds, 1, 20)
  const region = str(r.region, 40)
  if (tempC === undefined && rounds === undefined && region === undefined) {
    return undefined
  }
  return {
    ...(tempC !== undefined && { tempC }),
    ...(rounds !== undefined && { rounds }),
    ...(region !== undefined && { region }),
  }
}

/** Optional enhancement: malformed rating is dropped, not a 400. */
function parseRating(raw: unknown): RecoveryRating | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const r = raw as Record<string, unknown>
  const pre = int(r.pre, 1, 5)
  const post = int(r.post, 1, 5)
  if (pre === undefined && post === undefined) return undefined
  return {
    ...(pre !== undefined && { pre }),
    ...(post !== undefined && { post }),
  }
}

/** Optional enhancement field: malformed feedback is dropped, not a 400. */
function parseFeedback(raw: unknown): WorkoutFeedback | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const r = raw as Record<string, unknown>
  const overall = DIFFICULTIES.includes(r.overall as Difficulty)
    ? (r.overall as Difficulty)
    : undefined
  const muscles: WorkoutFeedback['muscles'] = {}
  if (typeof r.muscles === 'object' && r.muscles !== null) {
    for (const [key, value] of Object.entries(r.muscles)) {
      if (key.length === 0 || key.length > 40) continue
      const m = value as Record<string, unknown>
      if (
        DIFFICULTIES.includes(m?.difficulty as Difficulty) &&
        VOLUMES.includes(m?.volume as VolumeRating)
      ) {
        muscles[key] = {
          difficulty: m.difficulty as Difficulty,
          volume: m.volume as VolumeRating,
        }
      }
      if (Object.keys(muscles).length >= 20) break
    }
  }
  if (overall === undefined && Object.keys(muscles).length === 0) {
    return undefined
  }
  return { ...(overall && { overall }), muscles }
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
        side: parseSide(s?.side),
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
    feedback: parseFeedback(r.feedback),
    modality: MODALITIES.includes(r.modality as Modality)
      ? (r.modality as Modality)
      : undefined,
    dose: parseDose(r.dose),
    rating: parseRating(r.rating),
    // CR-10 in half steps; anything outside 0–10 is dropped, never a 400,
    // so an older client's queued saves keep flushing.
    sessionRpe:
      typeof r.sessionRpe === 'number' &&
      Number.isFinite(r.sessionRpe) &&
      r.sessionRpe >= 0 &&
      r.sessionRpe <= 10
        ? Math.round(r.sessionRpe * 2) / 2
        : undefined,
    mesoId: str(r.mesoId, 64),
    // 0..13 — must match the 14-session microcycle cap in mesos.ts
    mesoDayIndex:
      num(r.mesoDayIndex) !== undefined &&
      Number.isInteger(r.mesoDayIndex) &&
      (r.mesoDayIndex as number) >= 0 &&
      (r.mesoDayIndex as number) <= 13
        ? (r.mesoDayIndex as number)
        : undefined,
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
