import type { Api } from './api'
import { storageKey } from './storage'

export type WorkoutKind = 'strength' | 'speed' | 'cardio'

export interface WorkoutSet {
  weight?: number
  reps?: number
  rpe?: number
  durationSec?: number
  distanceM?: number
  /** Session-screen check-off state; stripped before the API sees it. */
  done?: boolean
}

export interface WorkoutExercise {
  name: string
  sets: WorkoutSet[]
}

export interface IntervalSection {
  label: string
  durationSec: number
}

export interface Workout {
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
  updatedAt?: string
  /** Set when an edit changes start: tells the API to move, not duplicate. */
  previousStart?: string
}

/** Drop rows the lifter never filled in and strip client-only flags. */
export function finalizeWorkout(w: Workout): Workout {
  return {
    ...w,
    exercises: w.exercises
      .map((e) => ({
        ...e,
        sets: e.sets
          .filter(
            (s) =>
              s.weight != null ||
              s.reps != null ||
              s.durationSec != null ||
              s.distanceM != null,
          )
          .map(({ done: _done, ...rest }) => rest),
      }))
      .filter((e) => e.sets.length > 0),
  }
}

export interface SessionRecord {
  sk: string
  sport?: string
  start: string
  end?: string
  timezoneOffset?: string
  strain?: number
  avgHr?: number
  maxHr?: number
  kilojoule?: number
  distanceM?: number
  zoneMin?: {
    z0?: number
    z1?: number
    z2?: number
    z3?: number
    z4?: number
    z5?: number
  }
  scoreState?: string
}

export function newWorkout(kind: WorkoutKind): Workout {
  return {
    id: crypto.randomUUID(),
    start: new Date().toISOString(),
    kind,
    weightUnit: 'lb',
    exercises: [],
  }
}

// ---- active-session draft ----
// The in-progress workout survives phone locks and reloads at the gym.

const DRAFT_KEY = 'fit.activeWorkoutDraft'

export function loadDraft(): Workout | null {
  try {
    const raw = localStorage.getItem(storageKey(DRAFT_KEY))
    return raw ? (JSON.parse(raw) as Workout) : null
  } catch {
    return null
  }
}

export function saveDraft(workout: Workout | null): void {
  if (workout === null) localStorage.removeItem(storageKey(DRAFT_KEY))
  else localStorage.setItem(storageKey(DRAFT_KEY), JSON.stringify(workout))
}

// ---- interval-timer draft (speed/cardio sessions) ----

export interface TimerDraft {
  kind: WorkoutKind
  title?: string
  sections: IntervalSection[]
  startEpoch: number
  /** Skipped time gets added to real elapsed so sections jump forward. */
  skipOffsetMs: number
  paused: boolean
  pausedElapsedMs: number
}

const TIMER_KEY = 'fit.activeTimerDraft'

export function loadTimerDraft(): TimerDraft | null {
  try {
    const raw = localStorage.getItem(storageKey(TIMER_KEY))
    return raw ? (JSON.parse(raw) as TimerDraft) : null
  } catch {
    return null
  }
}

export function saveTimerDraft(draft: TimerDraft | null): void {
  if (draft === null) localStorage.removeItem(storageKey(TIMER_KEY))
  else localStorage.setItem(storageKey(TIMER_KEY), JSON.stringify(draft))
}

// ---- offline write queue ----
// Saves land here first; flush pushes them to the API and drops only entries
// the server can never accept (400/422 = malformed payload). Auth-expiry and
// transient statuses stay queued so a stale token never eats a workout.

const PENDING_KEY = 'fit.pendingWorkouts'
const CACHE_KEY = 'fit.workoutsCache'

export function loadPending(): Workout[] {
  try {
    return JSON.parse(localStorage.getItem(storageKey(PENDING_KEY)) ?? '[]')
  } catch {
    return []
  }
}

function savePending(list: Workout[]): void {
  localStorage.setItem(storageKey(PENDING_KEY), JSON.stringify(list))
}

export function enqueue(workout: Workout): void {
  const list = loadPending().filter((w) => w.id !== workout.id)
  list.push(workout)
  savePending(list)
}

export async function flushQueue(
  api: Api,
): Promise<{ flushed: number; remaining: number }> {
  const pending = loadPending()
  const remaining: Workout[] = []
  let flushed = 0
  for (const workout of pending) {
    try {
      const res = await api.send('POST', '/api/workouts', workout)
      // Drop only on hard validation errors — a malformed payload will never
      // succeed. Keep everything else queued: 401/403 (token to refresh),
      // 404/408/429 and 5xx (transient) all deserve a later retry.
      if (res.ok || res.status === 400 || res.status === 422) {
        flushed += res.ok ? 1 : 0
      } else {
        remaining.push(workout) // retryable — try again later
      }
    } catch {
      remaining.push(workout) // offline
    }
  }
  savePending(remaining)
  return { flushed, remaining: remaining.length }
}

// ---- read cache so the timeline renders offline ----

export function loadWorkoutCache(): Workout[] {
  try {
    return JSON.parse(localStorage.getItem(storageKey(CACHE_KEY)) ?? '[]')
  } catch {
    return []
  }
}

export function saveWorkoutCache(list: Workout[]): void {
  localStorage.setItem(storageKey(CACHE_KEY), JSON.stringify(list))
}
