import type { Api } from './api'

export interface WorkoutSet {
  weight?: number
  reps?: number
  rpe?: number
}

export interface WorkoutExercise {
  name: string
  sets: WorkoutSet[]
}

export interface Workout {
  id: string
  start: string
  end?: string
  kind: 'strength' | 'cardio'
  title?: string
  weightUnit: 'lb' | 'kg'
  notes?: string
  exercises: WorkoutExercise[]
  linkedSessionSk?: string
  durationMin?: number
  distanceM?: number
  updatedAt?: string
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

export function newWorkout(kind: Workout['kind']): Workout {
  return {
    id: crypto.randomUUID(),
    start: new Date().toISOString(),
    kind,
    weightUnit: 'lb',
    exercises: [],
  }
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
