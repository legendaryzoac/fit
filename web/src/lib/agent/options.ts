// What can be started today. The coach builds a day plan out of these ids
// rather than describing sessions freehand, so everything it plans maps
// to something the app already knows how to run, with the engine's own
// set counts and targets attached.

import { generateRoutine, suggestedMinutes } from '../generate'
import {
  activeMeso,
  dayKind,
  doneDayIndexes,
  isDeloadWeek,
  mesoOverdue,
  mesoWeek,
  nextDayIndex,
  plannedSets,
  prescribeExercises,
  sessionsForToday,
  type Mesocycle,
} from '../mesocycle'
import { SESSION_SET_CAP } from '../progression'
import { effectiveRoutines, routineMinutes, type Routine } from '../routines'
import { hasSlots, routineToSections, totalSec } from '../templates'
import type { AgentContext, PlannedExercise, Trim } from './types'

export type DayOption =
  | {
      id: string
      kind: 'block'
      mesoId: string
      dayIndex: number
      session: 'strength' | 'cardio'
      title: string
      minutes: number
      exercises: PlannedExercise[]
      scheduledToday: boolean
      doneThisWeek: boolean
      /** The block's last week: the engine already prescribes the easy
       * version, so there is nothing to hold. */
      deload: boolean
    }
  | {
      id: string
      kind: 'template'
      templateId: string
      session: 'strength' | 'timer'
      title: string
      minutes: number
      exercises: PlannedExercise[]
      /** Exercises are picked at start, so the plan cannot reshape it. */
      slots: boolean
    }
  | { id: string; kind: 'routine'; routineId: string; title: string; minutes: number }
  | {
      id: string
      kind: 'user-routine'
      templateId: string
      title: string
      minutes: number
    }
  | { id: 'warmup'; kind: 'warmup'; title: string }
  | { id: 'cooldown'; kind: 'cooldown'; title: string }

/** Roughly three minutes a working set plus getting started. */
export function strengthMinutes(sets: number): number {
  return Math.max(10, Math.round((sets * 3 + 5) / 5) * 5)
}

const totalSets = (rows: Array<{ sets: number }>) =>
  rows.reduce((n, r) => n + r.sets, 0)

/** The engine's plan for one block day this week: sets and targets. */
export function blockDayExercises(
  meso: Mesocycle,
  dayIndex: number,
  ctx: AgentContext,
): PlannedExercise[] {
  const day = meso.days[dayIndex]
  if (!day || dayKind(day) !== 'strength') return []
  const week = Math.min(mesoWeek(meso, ctx.now), meso.weeks - 1)
  const mesoWorkouts = ctx.workouts.filter((w) => w.mesoId === meso.id)
  const planned = plannedSets(meso, day, week, mesoWorkouts, ctx.lookup, ctx.now)
  const rx = prescribeExercises(
    meso,
    planned.map((e) => e.name),
    week,
    mesoWorkouts,
    ctx.workouts,
    Object.fromEntries(planned.map((e) => [e.name, e.setCount])),
    ctx.lookup,
    ctx.bodyWeightLb,
    dayIndex,
  )
  return planned.map((e) => {
    const p = rx[e.name]
    const target =
      p?.weight != null
        ? `${p.weight} × ${p.targetReps ?? p.repLow}`
        : p
          ? `${p.repLow}-${p.repHigh} reps`
          : undefined
    return { name: e.name, sets: e.setCount, ...(target && { target }) }
  })
}

/**
 * Reshape a planned session: swaps first (so a kept slot can be a swapped
 * lift), then the cut to the first N, then sets off each exercise, then the
 * per-muscle session cap, which a swap onto an already-busy muscle could
 * otherwise break. The same function runs when the plan is checked and
 * when the session starts, so the card and the session always agree.
 */
export function applyTrim<T extends { name: string; sets: number }>(
  rows: T[],
  trim: Trim | undefined,
  lookup: (name: string) => string | undefined,
): T[] {
  let out = rows.map((r) => ({ ...r }))
  if (!trim) return out
  for (const swap of trim.swaps ?? []) {
    const from = swap.from.trim().toLowerCase()
    const at = out.findIndex((r) => r.name.trim().toLowerCase() === from)
    if (at === -1) continue
    if (swap.to === null) out.splice(at, 1)
    else {
      // A swapped-in lift has no prescription yet: drop the old target
      const { target: _target, ...rest } = out[at] as T & { target?: string }
      out[at] = { ...rest, name: swap.to } as T
    }
  }
  if (trim.keepFirst && trim.keepFirst > 0 && trim.keepFirst < out.length) {
    out = out.slice(0, trim.keepFirst)
  }
  if (trim.dropSets && trim.dropSets > 0) {
    out = out.map((r) => ({ ...r, sets: Math.max(1, r.sets - trim.dropSets!) }))
  }
  const used = new Map<string, number>()
  return out.flatMap((r) => {
    const muscle = lookup(r.name)
    if (!muscle) return [r]
    const room = SESSION_SET_CAP - (used.get(muscle) ?? 0)
    const sets = Math.min(r.sets, room)
    if (sets < 1) return []
    used.set(muscle, (used.get(muscle) ?? 0) + sets)
    return [{ ...r, sets }]
  })
}

/** A user's own recovery template, in whole minutes. */
function userRoutineMinutes(t: {
  items?: Parameters<typeof routineToSections>[0]
  transitionSec?: number
}): number {
  const sec = totalSec(routineToSections(t.items ?? [], t.transitionSec))
  return Math.max(1, Math.round(sec / 60))
}

/** The muscles a list of exercises trains, in order, without repeats. */
export function musclesOf(
  rows: Array<{ name: string }>,
  lookup: (name: string) => string | undefined,
): string[] {
  const out: string[] = []
  for (const r of rows) {
    const m = lookup(r.name)
    if (m && !out.includes(m)) out.push(m)
  }
  return out
}

/** The warm-up or cool-down the app would build for these muscles. */
export function generatedRoutine(
  muscles: string[],
  phase: 'pre' | 'post',
  now: number,
): Routine | null {
  if (muscles.length === 0) return null
  return generateRoutine({
    muscles,
    phase,
    minutes: suggestedMinutes(muscles, phase),
    seed: Math.floor(now / 86_400_000),
  })
}

export function buildOptions(ctx: AgentContext): DayOption[] {
  const out: DayOption[] = []
  const meso = activeMeso(ctx.mesos)
  if (meso && !mesoOverdue(meso, ctx.now)) {
    const week = Math.min(mesoWeek(meso, ctx.now), meso.weeks - 1)
    const done = doneDayIndexes(meso, ctx.workouts, week)
    const today = new Set(sessionsForToday(meso, ctx.workouts, ctx.now))
    meso.days.forEach((day, i) => {
      const session = dayKind(day)
      const exercises = blockDayExercises(meso, i, ctx)
      out.push({
        id: `block:${i}`,
        kind: 'block',
        mesoId: meso.id,
        dayIndex: i,
        session,
        title: day.label,
        minutes:
          session === 'cardio'
            ? Math.max(1, Math.round(totalSec(day.sections ?? []) / 60))
            : strengthMinutes(totalSets(exercises)),
        exercises,
        scheduledToday: today.has(i),
        doneThisWeek: done.has(i),
        deload: isDeloadWeek(meso, week),
      })
    })
  }

  const trainable = ctx.templates.filter(
    (t) => t.kind !== 'recovery' && !t.builtin,
  )
  trainable.forEach((t, i) => {
    if (t.kind === 'strength') {
      const exercises = (t.exercises ?? []).map((e) => ({
        name: e.name,
        sets: e.setCount,
      }))
      out.push({
        id: `template:${i + 1}`,
        kind: 'template',
        templateId: t.id,
        session: 'strength',
        title: t.name,
        minutes: strengthMinutes(totalSets(exercises)),
        exercises,
        slots: hasSlots(t),
      })
    } else if (t.sections && t.sections.length > 0) {
      out.push({
        id: `template:${i + 1}`,
        kind: 'template',
        templateId: t.id,
        session: 'timer',
        title: t.name,
        minutes: Math.max(1, Math.round(totalSec(t.sections) / 60)),
        exercises: [],
        slots: false,
      })
    }
  })

  out.push({ id: 'warmup', kind: 'warmup', title: 'Warm-up for the session' })
  out.push({ id: 'cooldown', kind: 'cooldown', title: 'Cool-down for the session' })

  for (const { routine } of effectiveRoutines(ctx.templates)) {
    out.push({
      id: `routine:${routine.id}`,
      kind: 'routine',
      routineId: routine.id,
      title: routine.name,
      minutes: routineMinutes(routine),
    })
  }
  ctx.templates
    .filter((t) => t.kind === 'recovery' && !t.builtin)
    .forEach((t, i) => {
      out.push({
        id: `myroutine:${i + 1}`,
        kind: 'user-routine',
        templateId: t.id,
        title: t.name,
        minutes: userRoutineMinutes(t),
      })
    })
  return out
}

/** The block day the athlete would be pointed at next, as an option id. */
export function nextBlockOption(ctx: AgentContext): string | null {
  const meso = activeMeso(ctx.mesos)
  if (!meso || mesoOverdue(meso, ctx.now)) return null
  const today = sessionsForToday(meso, ctx.workouts, ctx.now)
  return `block:${today[0] ?? nextDayIndex(meso, ctx.workouts, ctx.now)}`
}
