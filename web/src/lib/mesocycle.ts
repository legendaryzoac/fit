// Opt-in mesocycle layer on top of the existing logger: a meso is a named
// block of N weeks (last week = deload) built from a repeating microcycle
// of training days. Focus muscles ramp sets week over week toward their
// MRV while everything else holds its base volume, and every session's
// weights/reps are prescribed from what the lifter ACTUALLY logged last
// time in this meso — enter 355 where the plan said 335 and the next
// session builds on 355. Constants follow PROGRESSION.md §6.

import { isBodyweight } from './exercises'
import {
  applyRecommendations,
  recommendations,
  SESSION_SET_CAP,
} from './progression'
import { storageKey } from './storage'
import type { Workout } from './workouts'

export interface MesoExercise {
  name: string
  setCount: number
  muscle?: string
}

export interface MesoDay {
  label: string
  exercises: MesoExercise[]
}

export interface Mesocycle {
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
  updatedAt?: string
}

// ---- cache so the meso card renders offline ----

const CACHE_KEY = 'fit.mesosCache'

export function loadMesoCache(): Mesocycle[] {
  try {
    return JSON.parse(localStorage.getItem(storageKey(CACHE_KEY)) ?? '[]')
  } catch {
    return []
  }
}

export function saveMesoCache(list: Mesocycle[]): void {
  localStorage.setItem(storageKey(CACHE_KEY), JSON.stringify(list))
}

export function activeMeso(list: Mesocycle[]): Mesocycle | undefined {
  return list.find((m) => m.status === 'active')
}

// ---- calendar math ----
// Weeks count in LOCAL calendar days, not fixed 168-hour spans — a DST
// shift must not flip a boundary session into the adjacent meso week.

function dayIndex(iso: string | number): number {
  const d = new Date(iso)
  return Math.round(
    Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000,
  )
}

/** 0-based week index; can run past weeks-1 when the meso is overdue. */
export function mesoWeek(m: Mesocycle, nowMs: number): number {
  return Math.max(
    0,
    Math.floor((dayIndex(nowMs) - dayIndex(m.startDate)) / 7),
  )
}

export function isDeloadWeek(m: Mesocycle, week: number): boolean {
  return week >= m.weeks - 1
}

/** True once the calendar has moved past the final (deload) week. */
export function mesoOverdue(m: Mesocycle, nowMs: number): boolean {
  return mesoWeek(m, nowMs) >= m.weeks
}

/** Meso workouts logged in the given meso week, oldest first. */
export function workoutsInWeek(
  m: Mesocycle,
  workouts: Workout[],
  week: number,
): Workout[] {
  const startDay = dayIndex(m.startDate) + week * 7
  return workouts
    .filter((w) => {
      if (w.mesoId !== m.id) return false
      const d = dayIndex(w.start)
      return d >= startDay && d < startDay + 7
    })
    .sort((a, b) => a.start.localeCompare(b.start))
}

/** Day indexes actually trained this meso week (from the day tag; falls
 * back to positional order for sessions logged before tagging existed). */
export function doneDayIndexes(
  m: Mesocycle,
  workouts: Workout[],
  week: number,
): Set<number> {
  const done = new Set<number>()
  workoutsInWeek(m, workouts, week).forEach((w, i) => {
    done.add(w.mesoDayIndex ?? i % m.days.length)
  })
  return done
}

/**
 * Which microcycle day comes next this week: the first day not yet
 * trained; wraps if the lifter trains more days than planned.
 */
export function nextDayIndex(
  m: Mesocycle,
  workouts: Workout[],
  nowMs: number,
): number {
  const week = mesoWeek(m, nowMs)
  const done = doneDayIndexes(m, workouts, week)
  for (let i = 0; i < m.days.length; i++) {
    if (!done.has(i)) return i
  }
  return workoutsInWeek(m, workouts, week).length % m.days.length
}

// ---- prescriptions (PROGRESSION.md §6) ----

/** Accumulation ramp: focus muscles add a set per week, capped. */
const FOCUS_RAMP_PER_WEEK = 1
const FOCUS_RAMP_MAX = 3

/**
 * Length-aware RIR ramp (PROGRESSION.md §6): descend to 0 RIR in the
 * final accumulation week, from 3 (capped — a 6-week meso holds 3 twice:
 * 3,3,2,1,0; a 4-week runs 2→1→0). Barbell compounds floor at 1 RIR —
 * grinding a squat to true failure is a safety cost with no evidence
 * upside.
 */
function targetRir(week: number, accumWeeks: number, compound: boolean): number {
  const rir = Math.min(3, Math.max(0, accumWeeks - 1 - week))
  return compound ? Math.max(1, rir) : rir
}

/** Deload: half the sets, half the reps, ~90% of the load. */
const DELOAD_SET_FACTOR = 0.5
const DELOAD_REP_FACTOR = 0.5
const DELOAD_LOAD_FACTOR = 0.9

/** Double-progression rep windows (PROGRESSION.md §4). */
const COMPOUND_WINDOW: [number, number] = [5, 10]
const DEFAULT_WINDOW: [number, number] = [10, 20]

const BARBELL_COMPOUNDS = [
  'back squat',
  'front squat',
  'bench press',
  'incline bench press',
  'close-grip bench press',
  'overhead press',
  'push press',
  'deadlift',
  'sumo deadlift',
  'trap bar deadlift',
  'romanian deadlift',
  'barbell row',
  'pendlay row',
  'hip thrust',
  'zercher squat',
  'good morning',
]

function repWindow(name: string): [number, number] {
  return BARBELL_COMPOUNDS.includes(name.trim().toLowerCase())
    ? COMPOUND_WINDOW
    : DEFAULT_WINDOW
}

const LOWER_BODY = new Set([
  'quads',
  'hamstrings',
  'glutes',
  'posterior chain',
  'calves',
])

/**
 * Upper +5 lb, lower +10 lb, rounded to the nearest 5 — but never a
 * REALIZED jump over ~5% of the load (rounding can inflate a nominal 5%
 * step). On light lifts the smallest plate is a huge relative jump, and
 * adding a rep instead is evidence-equivalent for hypertrophy (Plotkin
 * 2022) — so we return null and the caller chases a rep.
 */
function increment(muscle: string | undefined, weight: number): number | null {
  const step = muscle !== undefined && LOWER_BODY.has(muscle) ? 10 : 5
  const bumped = Math.round((weight + step) / 5) * 5
  if (bumped - weight > weight * 0.05) return null
  return bumped
}

export interface Prescription {
  /** Suggested working weight (absent = find one, ~3 RIR). */
  weight?: number
  targetReps?: number
  repLow: number
  repHigh: number
  sets: number
  /** null on the deload week. */
  rir: number | null
  /** Human line for the session card, e.g. "4×8 @ 335 lb · 2 RIR". */
  note: string
}

/** Top completed set: heaviest, ties broken by reps. */
function topSet(w: Workout, name: string): { weight?: number; reps?: number } | null {
  const ex = w.exercises.find(
    (e) => e.name.toLowerCase() === name.toLowerCase(),
  )
  if (!ex || ex.sets.length === 0) return null
  let best: { weight?: number; reps?: number } | null = null
  for (const s of ex.sets) {
    if (s.weight == null && s.reps == null) continue
    if (
      !best ||
      (s.weight ?? 0) > (best.weight ?? 0) ||
      ((s.weight ?? 0) === (best.weight ?? 0) && (s.reps ?? 0) > (best.reps ?? 0))
    ) {
      best = { weight: s.weight, reps: s.reps }
    }
  }
  return best
}

/** Whether every logged set of the exercise reached the window top. A
 * rep-less logged set counts as NOT at top — an unverified set must block
 * the load increase, not silently vouch for it. */
function allSetsAtTop(w: Workout, name: string, top: number): boolean {
  const ex = w.exercises.find(
    (e) => e.name.toLowerCase() === name.toLowerCase(),
  )
  if (!ex) return false
  return ex.sets.length > 0 && ex.sets.every((s) => (s.reps ?? 0) >= top)
}

/**
 * Planned set counts for a day in a given week: focus muscles ramp
 * +1/week (capped) through accumulation, feedback deltas from THIS meso's
 * sessions modulate on top, the session cap always wins, and the deload
 * halves everything.
 */
export function plannedSets(
  m: Mesocycle,
  day: MesoDay,
  week: number,
  mesoWorkouts: Workout[],
  lookup: (name: string) => string | undefined,
  nowMs: number,
): Array<{ name: string; setCount: number }> {
  const deload = isDeloadWeek(m, week)
  // Set additions FREEZE in the final accumulation week — the next week
  // is the deload, so new volume there has nowhere to be adapted to.
  const finalAccum = !deload && week >= m.weeks - 2
  const rampWeeks = Math.min(week, Math.max(0, m.weeks - 3))
  const ramp = deload
    ? 0
    : Math.min(rampWeeks * FOCUS_RAMP_PER_WEEK, FOCUS_RAMP_MAX)

  // One muscle resolver for ramp, feedback, and cap alike: the day's own
  // muscle tag (slot rows) wins, the global lookup fills in the rest —
  // keying these differently let unknown names dodge the session cap.
  const dayMuscle = new Map<string, string>()
  for (const e of day.exercises) {
    if (e.muscle !== undefined) dayMuscle.set(e.name.toLowerCase(), e.muscle)
  }
  const resolve = (name: string) =>
    dayMuscle.get(name.toLowerCase()) ?? lookup(name)

  // The ramp is per MUSCLE, not per exercise — it lands on the first
  // exercise of each focus muscle (same convention the feedback deltas
  // use), so two quad lifts don't silently double the weekly ramp.
  const bumped = new Set<string>()
  let entries = day.exercises.map((e) => {
    const muscle = resolve(e.name)
    const focused =
      ramp > 0 &&
      muscle !== undefined &&
      m.focus.includes(muscle) &&
      !bumped.has(muscle)
    if (focused && muscle !== undefined) bumped.add(muscle)
    return { name: e.name, setCount: e.setCount + (focused ? ramp : 0) }
  })

  if (!deload) {
    // In-meso autoregulation: the same feedback engine, scoped to this
    // meso's sessions only, nudges the planned ramp up or down. In the
    // frozen final week only downward corrections still apply.
    let recs = recommendations(mesoWorkouts, resolve, nowMs)
    if (finalAccum) {
      recs = Object.fromEntries(
        Object.entries(recs).map(([k, r]) => [
          k,
          { ...r, setDelta: Math.min(0, r.setDelta) as typeof r.setDelta },
        ]),
      )
    }
    entries = applyRecommendations(entries, recs, resolve)
  }

  // Per-muscle session cap — the cap is the hard invariant, so an
  // exercise the budget can't fund drops out rather than sneaking a set.
  const perMuscle = new Map<string, number>()
  return entries
    .map((e) => {
      const muscle = resolve(e.name)
      let sets = Math.max(1, e.setCount)
      if (deload) sets = Math.max(1, Math.round(sets * DELOAD_SET_FACTOR))
      if (muscle) {
        const used = perMuscle.get(muscle) ?? 0
        sets = Math.min(sets, Math.max(0, SESSION_SET_CAP - used))
        perMuscle.set(muscle, used + sets)
      }
      return { name: e.name, setCount: sets }
    })
    .filter((e) => e.setCount > 0)
}

/**
 * Per-exercise weight/rep prescription. Anchored to the lifter's last
 * ACTUAL top set within this meso (overrides included by construction);
 * week 1 falls back to overall history, then body weight, then "find a
 * working weight".
 */
export function prescribeExercises(
  m: Mesocycle,
  names: string[],
  week: number,
  mesoWorkouts: Workout[],
  allWorkouts: Workout[],
  setsByName: Record<string, number>,
  lookup: (name: string) => string | undefined,
  bodyWeightLb?: number,
): Record<string, Prescription> {
  const deload = isDeloadWeek(m, week)
  const accum = m.weeks - 1
  // Deload prescriptions anchor ONLY to accumulation sessions: anchoring
  // deload to deload compounds a 0.9^n load cut (and re-halved reps)
  // every time an exercise repeats within the deload week.
  const deloadStartDay = dayIndex(m.startDate) + (m.weeks - 1) * 7
  const out: Record<string, Prescription> = {}

  for (const name of names) {
    const compound = BARBELL_COMPOUNDS.includes(name.trim().toLowerCase())
    const rir = deload ? null : targetRir(week, accum, compound)
    const [low, high] = repWindow(name)
    const sets = setsByName[name] ?? 3
    const bw = isBodyweight(name)

    // Newest-first scan for an anchor WITH a weight — a reps-only log
    // must not block the fallbacks below.
    let anchor: { weight?: number; reps?: number } | null = null
    let anchorWorkout: Workout | null = null
    for (const w of mesoWorkouts) {
      if (deload && dayIndex(w.start) >= deloadStartDay) continue
      const t = topSet(w, name)
      if (t?.weight != null) {
        anchor = t
        anchorWorkout = w
        break
      }
    }
    if (!anchor) {
      for (const w of allWorkouts) {
        if (w.kind !== 'strength') continue
        const t = topSet(w, name)
        if (t?.weight != null) {
          anchor = t
          break
        }
      }
    }
    // Bodyweight moves pin to TODAY's measured mass (the app-wide
    // invariant) and progress by reps only — you can't add 5 lb to
    // yourself, and a deload can't take 10% off you either.
    if (bw && bodyWeightLb !== undefined) {
      anchor = { weight: Math.round(bodyWeightLb), reps: anchor?.reps }
      anchorWorkout = null
    }

    if (!anchor?.weight) {
      out[name] = {
        repLow: low,
        repHigh: high,
        sets,
        rir,
        note: deload
          ? `deload · ${sets}×easy`
          : `${sets}×${low}–${high} · find a working weight (~${rir} RIR)`,
      }
      continue
    }

    if (deload) {
      // Step scales with the load so light lifts don't round to 0 lb
      const raw = anchor.weight * DELOAD_LOAD_FACTOR
      const step = raw >= 25 ? 5 : 2.5
      const weight = bw
        ? anchor.weight
        : Math.max(step, Math.round(raw / step) * step)
      const reps = Math.max(
        3,
        Math.round((anchor.reps ?? high) * DELOAD_REP_FACTOR),
      )
      out[name] = {
        weight,
        targetReps: reps,
        repLow: low,
        repHigh: high,
        sets,
        rir,
        note: `deload · ${sets}×${reps} @ ${weight} lb, stop far from failure`,
      }
      continue
    }

    // Double progression against the meso anchor: window topped-out on
    // every set -> raise the load and reset reps; otherwise chase a rep.
    // A null increment means the smallest jump is too coarse for this
    // lift — keep the weight and keep adding reps past the window instead.
    let weight = anchor.weight
    let target: number
    if (
      anchorWorkout &&
      anchor.reps != null &&
      anchor.reps >= high &&
      allSetsAtTop(anchorWorkout, name, high)
    ) {
      const bumped = increment(lookup(name), anchor.weight)
      if (bumped !== null) {
        weight = bumped
        target = low
      } else {
        target = anchor.reps + 1
      }
    } else if (bw && anchor.reps != null && anchor.reps >= high) {
      target = anchor.reps + 1 // no plates to add to yourself — keep repping
    } else {
      target = Math.min((anchor.reps ?? low) + 1, high)
    }
    out[name] = {
      weight,
      targetReps: target,
      repLow: low,
      repHigh: high,
      sets,
      rir,
      note: `${sets}×${target} @ ${weight} lb · ${rir} RIR`,
    }
  }
  return out
}
