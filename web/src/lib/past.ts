// Logging a session after the fact. A past session is an ordinary workout
// with an earlier start; what changes is how it is built. A block day is
// planned as of that date (that week's sets, anchored to what had been
// logged by then), not as of today, so a session entered three days late
// lands in the block exactly where it would have if it had been logged
// live.

import {
  dayKind,
  mesoWeek,
  plannedSets,
  type Mesocycle,
} from './mesocycle'
import { totalSec, type Template } from './templates'
import { newWorkout, type IntervalSection, type Workout } from './workouts'

export type PastChoice =
  | { kind: 'block'; dayIndex: number }
  | { kind: 'template'; templateId: string }
  | { kind: 'open' }
  | { kind: 'cardio' }
  | { kind: 'recovery' }

const HOUR = 3_600_000

/** Where the date field opens: yesterday evening, the usual thing forgotten. */
export function defaultPastStart(nowMs: number): Date {
  const d = new Date(nowMs)
  d.setDate(d.getDate() - 1)
  d.setHours(18, 0, 0, 0)
  return d
}

/** Local calendar day number, the unit block weeks are counted in. */
const dayNumber = (ms: number): number => {
  const d = new Date(ms)
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000)
}

/**
 * The block's days as they stood at that moment, or none when the moment
 * falls outside the block (before it started, or after its last week).
 */
export function blockDaysAt(
  meso: Mesocycle | undefined,
  startMs: number,
): Array<{ dayIndex: number; label: string; week: number; cardio: boolean }> {
  if (!meso || meso.status !== 'active') return []
  if (dayNumber(startMs) < dayNumber(new Date(meso.startDate).getTime())) return []
  const week = mesoWeek(meso, startMs)
  if (week >= meso.weeks) return []
  return meso.days.map((d, dayIndex) => ({
    dayIndex,
    label: d.label,
    week,
    cardio: dayKind(d) === 'cardio',
  }))
}

/** Whole minutes a list of timer sections runs; 30 when it has none. */
const timedMinutes = (sections: IntervalSection[]): number =>
  sections.length > 0 ? Math.max(1, Math.round(totalSec(sections) / 60)) : 30

const emptyRows = (rows: Array<{ name: string; setCount: number }>) =>
  rows.map((r) => ({
    name: r.name,
    sets: Array.from({ length: r.setCount }, () => ({})),
  }))

/**
 * The workout a past session starts from: dated, shaped by what it was,
 * with empty rows to fill in. Recovery is not built here; it has its own
 * form.
 */
export function pastWorkout(
  choice: Exclude<PastChoice, { kind: 'recovery' }>,
  startIso: string,
  ctx: {
    meso?: Mesocycle
    templates: Template[]
    workouts: Workout[]
    lookup: (name: string) => string | undefined
  },
): Workout | null {
  const startMs = new Date(startIso).getTime()
  const dated = (kind: Workout['kind'], minutes: number): Workout => ({
    ...newWorkout(kind),
    start: startIso,
    end: new Date(startMs + minutes * 60_000).toISOString(),
  })

  if (choice.kind === 'open') return dated('strength', 60)
  if (choice.kind === 'cardio') return { ...dated('cardio', 30), durationMin: 30 }

  if (choice.kind === 'template') {
    const t = ctx.templates.find((x) => x.id === choice.templateId)
    if (!t || t.kind === 'recovery') return null
    if (t.kind === 'strength') {
      // Slot rows name a muscle, not a lift; they are left for the athlete
      // to fill in with what they actually did. The named lifts stay.
      const rows = (t.exercises ?? []).filter((e) => e.muscle === undefined)
      return { ...dated('strength', 60), title: t.name, exercises: emptyRows(rows) }
    }
    // A timer session: what the timer would have saved had it run. Cardio
    // carries its minutes as a field; anything else is as long as its end
    // says, which the form edits.
    const sections = t.sections ?? []
    const minutes = timedMinutes(sections)
    return {
      ...dated(t.kind, minutes),
      title: t.name,
      ...(t.kind === 'cardio' && { durationMin: minutes }),
      ...(sections.length > 0 && { intervals: sections }),
    }
  }

  const meso = ctx.meso
  const day = meso?.days[choice.dayIndex]
  if (!meso || !day) return null
  if (!blockDaysAt(meso, startMs).some((d) => d.dayIndex === choice.dayIndex)) {
    return null
  }
  const week = mesoWeek(meso, startMs)
  const title = `${day.label} · wk ${week + 1}`
  const link = { mesoId: meso.id, mesoDayIndex: choice.dayIndex, title }
  if (dayKind(day) === 'cardio') {
    const sections = day.sections ?? []
    const minutes = timedMinutes(sections)
    return {
      ...dated('cardio', minutes),
      ...link,
      durationMin: minutes,
      ...(sections.length > 0 && { intervals: sections }),
    }
  }
  // Only what had been logged in this block by then may shape that day
  const before = ctx.workouts.filter(
    (w) => w.mesoId === meso.id && w.start < startIso,
  )
  const planned = plannedSets(meso, day, week, before, ctx.lookup, startMs)
  return { ...dated('strength', 60), ...link, exercises: emptyRows(planned) }
}

/**
 * True for a set with numbers in it, ticked or not. This is the one test
 * for "a set was entered": the same rows survive finalizeWorkout.
 */
export const isFilled = (s: Workout['exercises'][number]['sets'][number]) =>
  s.weight != null || s.reps != null || s.durationSec != null || s.distanceM != null

/** The week a block day's generated title carries: "Upper A · wk 2". */
const WEEK_SUFFIX = / · wk \d+$/

const shapeOf = (rows: Workout['exercises']) =>
  rows.map((e) => `${e.name.toLowerCase()}:${e.sets.length}`).join('|')

/**
 * A past session whose date was changed in the form. Everything that was
 * derived from the date follows it: the end keeps the session's length, a
 * block day takes the title of the week it now falls in, and while its
 * rows are still the plan as it was laid out (nothing typed, nothing
 * added or removed) they are laid out again for the new date. Rows the
 * athlete has touched are theirs and stay.
 *
 * `current` already carries the new start. `plan` is the session as last
 * laid out; the new plan is returned beside the session so the next move
 * can be compared against it.
 */
export function movePast(
  current: Workout,
  plan: Workout,
  ctx: Parameters<typeof pastWorkout>[2],
): { workout: Workout; plan: Workout } {
  const moved = { ...plan, start: current.start, end: current.end }
  const meso = ctx.meso
  const day =
    meso && meso.id === current.mesoId && current.mesoDayIndex != null
      ? meso.days[current.mesoDayIndex]
      : undefined
  if (!meso || !day || current.mesoDayIndex == null) {
    return { workout: current, plan: moved }
  }
  const generated =
    !current.title ||
    current.title === day.label ||
    current.title.startsWith(`${day.label} · wk `)
  const fresh = pastWorkout(
    { kind: 'block', dayIndex: current.mesoDayIndex },
    current.start,
    ctx,
  )
  if (!fresh) {
    // Outside the block: it will be saved on its own, so it stops
    // claiming a week
    const title = generated ? day.label : current.title
    return { workout: { ...current, title }, plan: { ...moved, title } }
  }
  const title = generated ? fresh.title : current.title
  const untouched =
    shapeOf(current.exercises) === shapeOf(plan.exercises) &&
    !current.exercises.some((e) => e.sets.some((s) => isFilled(s) || s.done))
  const exercises = untouched ? fresh.exercises : current.exercises
  return {
    workout: { ...current, title, exercises },
    plan: {
      ...moved,
      title,
      exercises: untouched ? fresh.exercises : plan.exercises,
    },
  }
}

/**
 * A past session is entered, not performed in front of the app: any row
 * with numbers in it was done. Marking them lets the end-of-session
 * ratings see which muscles were trained.
 */
export function markFilledDone(w: Workout): Workout {
  return {
    ...w,
    exercises: w.exercises.map((e) => ({
      ...e,
      sets: e.sets.map((s) => (isFilled(s) ? { ...s, done: true } : s)),
    })),
  }
}

/**
 * A past session as it is saved. Filled rows count as done; cardio ends
 * when its minutes say it did; and a block day follows the date it ended
 * up on: the right week in its title, or no block at all when the date
 * was moved outside it.
 */
export function settlePast(w: Workout, meso: Mesocycle | undefined): Workout {
  let out = markFilledDone(w)
  const startMs = new Date(out.start).getTime()
  if (out.kind === 'cardio' && out.durationMin != null && out.durationMin > 0) {
    out = {
      ...out,
      end: new Date(startMs + out.durationMin * 60_000).toISOString(),
    }
  }
  if (out.mesoId == null) return out
  const day =
    meso && meso.id === out.mesoId && out.mesoDayIndex != null
      ? meso.days[out.mesoDayIndex]
      : undefined
  if (!meso || !day || blockDaysAt(meso, startMs).length === 0) {
    // On its own now: no block, and no week in a title the app wrote
    const { mesoId: _mesoId, mesoDayIndex: _mesoDayIndex, ...rest } = out
    return { ...rest, title: rest.title?.replace(WEEK_SUFFIX, '') }
  }
  const stem = `${day.label} · wk `
  return !out.title || out.title.startsWith(stem)
    ? { ...out, title: `${stem}${mesoWeek(meso, startMs) + 1}` }
    : out
}

/**
 * What is wrong with a moment as the start of a past session, or null. A
 * year is as far back as the log reaches: anything older would save and
 * then never show.
 */
export function pastStartProblem(startMs: number, nowMs: number): string | null {
  if (!Number.isFinite(startMs)) return 'Pick when it happened.'
  if (startMs > nowMs) return 'That is in the future. Pick when it happened.'
  if (startMs < nowMs - 365 * 24 * HOUR) return 'That is more than a year back.'
  return null
}

/** Why a past session cannot be saved yet, or null when it can. */
export function pastProblem(w: Workout, nowMs: number): string | null {
  const startMs = new Date(w.start).getTime()
  const when = pastStartProblem(startMs, nowMs)
  if (when) return when
  if (w.kind === 'cardio') {
    return w.durationMin != null && w.durationMin > 0
      ? null
      : 'Enter how long it lasted.'
  }
  if (w.exercises.some((e) => e.sets.some(isFilled))) return null
  // An interval session has no rows to fill: its sections are the record
  const ran = w.end != null && new Date(w.end).getTime() > startMs
  if ((w.intervals?.length ?? 0) > 0 && ran) return null
  return 'Enter at least one set.'
}
