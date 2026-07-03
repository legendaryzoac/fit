import type { Api } from './api'

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

export interface Workout {
  id: string
  start: string
  end?: string
  kind: WorkoutKind
  title?: string
  weightUnit: 'lb' | 'kg'
  notes?: string
  exercises: WorkoutExercise[]
  linkedSessionSk?: string
  durationMin?: number
  distanceM?: number
  updatedAt?: string
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
    const raw = localStorage.getItem(DRAFT_KEY)
    return raw ? (JSON.parse(raw) as Workout) : null
  } catch {
    return null
  }
}

export function saveDraft(workout: Workout | null): void {
  if (workout === null) localStorage.removeItem(DRAFT_KEY)
  else localStorage.setItem(DRAFT_KEY, JSON.stringify(workout))
}

// ---- offline write queue ----
// Saves land here first; flush pushes them to the API and drops entries the
// server permanently rejects (4xx = client bug, retrying forever won't help).

const PENDING_KEY = 'fit.pendingWorkouts'
const CACHE_KEY = 'fit.workoutsCache'

export function loadPending(): Workout[] {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) ?? '[]')
  } catch {
    return []
  }
}

function savePending(list: Workout[]): void {
  localStorage.setItem(PENDING_KEY, JSON.stringify(list))
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
      if (res.ok || (res.status >= 400 && res.status < 500)) {
        flushed += res.ok ? 1 : 0
      } else {
        remaining.push(workout) // 5xx — try again later
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
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? '[]')
  } catch {
    return []
  }
}

export function saveWorkoutCache(list: Workout[]): void {
  localStorage.setItem(CACHE_KEY, JSON.stringify(list))
}
