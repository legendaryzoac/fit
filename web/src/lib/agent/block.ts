// A block as the model proposed it → a block the engine will accept, with
// the week-one volume laid against the landmarks. This is where the
// research in PROGRESSION.md is enforced rather than hoped for: unknown
// lifts and anything past MRV go back to the model as errors; the session
// cap is applied the way plannedSets would apply it, but visibly.

import { MUSCLE_GROUPS } from '../exercises'
import type { MesoDay, Mesocycle } from '../mesocycle'
import { SESSION_SET_CAP, landmarksFor } from '../progression'
import type { Catalog } from './catalog'
import { strengthMinutes } from './options'
import { checkExerciseRows } from './plan'
import type {
  AgentContext,
  BlockProposal,
  VolumeRow,
  VolumeZone,
} from './types'

/** The muscles the block editor can show as a focus. */
export const FOCUS_CHOICES: readonly string[] = MUSCLE_GROUPS.filter(
  (m) => m !== 'other' && m !== 'full body',
)

const MIN_WEEKS = 4
const MAX_WEEKS = 6
const MAX_DAYS = 7
const MAX_DAY_EXERCISES = 10

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

/** Where days land when the athlete gave no schedule: spread, not stacked. */
const SPREAD: Record<number, number[]> = {
  1: [0],
  2: [0, 3],
  3: [0, 2, 4],
  4: [0, 1, 3, 4],
  5: [0, 1, 2, 4, 5],
  6: [0, 1, 2, 3, 4, 5],
  7: [0, 1, 2, 3, 4, 5, 6],
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const text = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.trim().slice(0, max) : ''

export function volumeZone(muscle: string, sets: number): VolumeZone {
  const m = landmarksFor(muscle)
  if (sets > m.mrv) return 'over'
  if (sets > m.mavHi) return 'high'
  if (sets >= m.mev) return 'productive'
  if (sets >= m.mv) return 'maintenance'
  return 'below'
}

/** Muscles that are not hypertrophy targets carry no landmarks. */
const UNTRACKED = new Set(['speed', 'power', 'full body', 'other'])

/** Week-one weekly sets per muscle, most volume first. */
export function weeklyVolume(
  days: MesoDay[],
  focus: string[],
  lookup: (name: string) => string | undefined,
): VolumeRow[] {
  const sets = new Map<string, number>()
  for (const d of days) {
    for (const e of d.exercises) {
      const muscle = e.muscle ?? lookup(e.name)
      if (!muscle || UNTRACKED.has(muscle)) continue
      sets.set(muscle, (sets.get(muscle) ?? 0) + e.setCount)
    }
  }
  return [...sets.entries()]
    .map(([muscle, n]) => {
      const m = landmarksFor(muscle)
      return {
        muscle,
        sets: n,
        zone: volumeZone(muscle, n),
        mev: m.mev,
        mrv: m.mrv,
        focus: focus.includes(muscle),
      }
    })
    .sort((a, b) => b.sets - a.sets || a.muscle.localeCompare(b.muscle))
}

export interface BlockCheck {
  proposal: BlockProposal | null
  errors: string[]
  adjustments: string[]
  warnings: string[]
}

export function checkBlock(
  input: unknown,
  ctx: AgentContext,
  catalog: Catalog,
): BlockCheck {
  const errors: string[] = []
  const adjustments: string[] = []
  const warnings: string[] = []
  const fail = (): BlockCheck => ({ proposal: null, errors, adjustments, warnings })
  if (!isObject(input)) {
    errors.push('The block was not an object.')
    return fail()
  }

  const name = text(input.name, 80) || 'Training block'

  const askedWeeks =
    typeof input.weeks === 'number' && Number.isFinite(input.weeks)
      ? Math.round(input.weeks)
      : 5
  const weeks = Math.min(MAX_WEEKS, Math.max(MIN_WEEKS, askedWeeks))
  if (weeks !== askedWeeks) {
    adjustments.push(
      `Length set to ${weeks} weeks (blocks run ${MIN_WEEKS} to ${MAX_WEEKS}, deload included).`,
    )
  }

  const focus: string[] = []
  for (const f of Array.isArray(input.focus_muscles) ? input.focus_muscles : []) {
    const m = text(f, 40).toLowerCase()
    if (!FOCUS_CHOICES.includes(m)) {
      if (m) adjustments.push(`"${m}" cannot be a focus; left out.`)
    } else if (!focus.includes(m)) focus.push(m)
  }
  if (focus.length > 3) {
    adjustments.push(`Focus kept to ${focus.slice(0, 3).join(', ')}.`)
    focus.length = 3
  }

  const rawDays = Array.isArray(input.days) ? input.days : []
  if (rawDays.length === 0) {
    errors.push('The block has no training days.')
    return fail()
  }
  if (rawDays.length > MAX_DAYS) {
    adjustments.push(`Kept the first ${MAX_DAYS} days.`)
  }

  const days: MesoDay[] = []
  const asked: Array<number | undefined> = []
  rawDays.slice(0, MAX_DAYS).forEach((raw, i) => {
    if (!isObject(raw)) return
    const label = text(raw.label, 60) || `Day ${i + 1}`
    const rows = checkExerciseRows(
      raw.exercises,
      label,
      catalog,
      ctx.lookup,
      errors,
      adjustments,
      MAX_DAY_EXERCISES,
    )
    if (rows.length === 0) return
    const wd = WEEKDAYS.indexOf(text(raw.weekday, 8).toLowerCase())
    asked.push(wd === -1 ? undefined : wd)
    days.push({
      label,
      exercises: rows.map((r) => ({ name: r.name, setCount: r.sets })),
    })
  })
  if (errors.length > 0) return fail()
  if (days.length === 0) {
    errors.push('No day had a usable exercise.')
    return fail()
  }

  // Weekdays: keep what was asked; everything else is spread over the week
  // on days not already taken, so the home screen can say what today is.
  const taken = new Set(asked.filter((w): w is number => w !== undefined))
  const free = (SPREAD[days.length] ?? SPREAD[7]).filter((w) => !taken.has(w))
  const spare = [0, 1, 2, 3, 4, 5, 6].filter(
    (w) => !taken.has(w) && !free.includes(w),
  )
  days.forEach((d, i) => {
    d.weekday = asked[i] ?? free.shift() ?? spare.shift() ?? i % 7
  })

  const volume = weeklyVolume(days, focus, ctx.lookup)
  for (const row of volume) {
    if (row.zone === 'over') {
      errors.push(
        `${row.muscle}: ${row.sets} weekly sets is past the recoverable maximum of ${row.mrv}. Cut ${row.sets - row.mrv} or more.`,
      )
    } else if (row.zone === 'high') {
      warnings.push(
        `${row.muscle} opens at ${row.sets} weekly sets, above its productive range; a block should start nearer ${row.mev}.`,
      )
    } else if (row.focus && row.sets < row.mev) {
      warnings.push(
        `${row.muscle} is a focus but opens at ${row.sets} weekly sets, under its minimum effective ${row.mev}.`,
      )
    }
  }
  for (const f of focus) {
    if (!volume.some((r) => r.muscle === f)) {
      warnings.push(`${f} is a focus but no exercise trains it.`)
    }
  }
  // A focus muscle already at the session cap has nowhere to grow
  for (const d of days) {
    for (const f of focus) {
      const daySets = d.exercises
        .filter((e) => ctx.lookup(e.name) === f)
        .reduce((n, e) => n + e.setCount, 0)
      if (daySets >= SESSION_SET_CAP) {
        warnings.push(
          `${d.label}: ${f} is already at ${SESSION_SET_CAP} sets, so it cannot gain volume there.`,
        )
      }
    }
  }
  if (errors.length > 0) return fail()

  return {
    proposal: {
      name,
      weeks,
      focus,
      days,
      rationale: text(input.rationale, 320),
      volume,
      minutes: days.map((d) =>
        strengthMinutes(d.exercises.reduce((n, e) => n + e.setCount, 0)),
      ),
      adjustments,
      warnings,
    },
    errors,
    adjustments,
    warnings,
  }
}

/** The proposal as a block the app can save. Starts today, active. */
export function mesoFromProposal(p: BlockProposal, now: number): Mesocycle {
  return {
    id: crypto.randomUUID(),
    name: p.name,
    weeks: p.weeks,
    focus: [...p.focus],
    days: p.days.map((d) => ({
      ...d,
      exercises: d.exercises.map((e) => ({ ...e })),
    })),
    startDate: new Date(now).toISOString(),
    status: 'active',
  }
}
