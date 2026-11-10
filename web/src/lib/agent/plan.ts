// A day plan as the model wrote it → a day plan the app can run. Ids are
// resolved against today's options, exercise names against the catalog,
// and every session is held to the per-muscle cap. Anything unusable is an
// error the model gets back; anything merely clamped is an adjustment the
// athlete can see on the card.

import {
  SESSION_SET_CAP,
  landmarksFor,
  weeklySetsByMuscle,
} from '../progression'
import type { Catalog } from './catalog'
import {
  applyTrim,
  generatedRoutine,
  musclesOf,
  strengthMinutes,
  type DayOption,
} from './options'
import type {
  AgentContext,
  CoachSource,
  DayPlan,
  DayPlanItem,
  PlannedExercise,
  Trim,
} from './types'

const MAX_ITEMS = 8
const MAX_CUSTOM_EXERCISES = 12
const MAX_SETS = 6

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const text = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.trim().slice(0, max) : ''

const int = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null

/** Local YYYY-MM-DD of an instant. */
export function localDateOf(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const sumSets = (rows: PlannedExercise[]) => rows.reduce((n, r) => n + r.sets, 0)

export interface DayPlanCheck {
  plan: DayPlan | null
  errors: string[]
  adjustments: string[]
}

/** Exercise rows as written → catalog names, clamped sets, capped per muscle. */
export function checkExerciseRows(
  raw: unknown,
  where: string,
  catalog: Catalog,
  lookup: (name: string) => string | undefined,
  errors: string[],
  adjustments: string[],
  max: number,
): PlannedExercise[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    errors.push(`${where} has no exercises.`)
    return []
  }
  if (raw.length > max) {
    adjustments.push(`${where}: kept the first ${max} exercises.`)
  }
  const rows: PlannedExercise[] = []
  for (const r of raw.slice(0, max)) {
    if (!isObject(r)) continue
    const asked = text(r.name, 80)
    const name = catalog.resolve(asked)
    if (!name) {
      const near = catalog.suggest(asked)
      errors.push(
        `${where}: "${asked}" is not in the catalog.` +
          (near.length ? ` Closest: ${near.join(', ')}.` : ''),
      )
      continue
    }
    if (rows.some((x) => x.name === name)) {
      adjustments.push(`${where}: ${name} was listed twice; kept one.`)
      continue
    }
    const sets = int(r.sets) ?? 3
    const clamped = Math.min(MAX_SETS, Math.max(1, sets))
    if (clamped !== sets) {
      adjustments.push(`${where}: ${name} set to ${clamped} sets.`)
    }
    rows.push({ name, sets: clamped })
  }
  // The engine caps a muscle at 8 direct sets a session and drops what
  // does not fit; do it here so the card shows what will actually run.
  const capped = applyTrim(rows, {}, lookup)
  for (const before of rows) {
    const after = capped.find((c) => c.name === before.name)
    if (!after) {
      adjustments.push(
        `${where}: dropped ${before.name}; ${lookup(before.name)} is already at ${SESSION_SET_CAP} sets.`,
      )
    } else if (after.sets !== before.sets) {
      adjustments.push(
        `${where}: ${before.name} cut to ${after.sets} sets (${SESSION_SET_CAP} per muscle per session).`,
      )
    }
  }
  return capped
}

/**
 * Hold a session the coach composed to the week's recoverable maximum: the
 * sets already logged in the last seven days plus this session may not pass
 * MRV for any muscle (PROGRESSION.md §5: never a positive delta at or above
 * it). Later lifts give way first. The athlete's own templates and block
 * days are not touched here: what they authored is theirs.
 */
export function capToWeek(
  rows: PlannedExercise[],
  where: string,
  ctx: AgentContext,
  adjustments: string[],
): PlannedExercise[] {
  const logged = weeklySetsByMuscle(ctx.workouts, ctx.lookup, ctx.now)
  const added = new Map<string, number>()
  return rows.flatMap((r) => {
    const muscle = ctx.lookup(r.name)
    if (!muscle) return [r]
    const { mrv } = landmarksFor(muscle)
    const week = logged[muscle] ?? 0
    const room = mrv - week - (added.get(muscle) ?? 0)
    const sets = Math.min(r.sets, Math.max(0, room))
    if (sets < r.sets) {
      adjustments.push(
        sets < 1
          ? `${where}: dropped ${r.name}; ${muscle} is at ${week} of ${mrv} weekly sets.`
          : `${where}: ${r.name} cut to ${sets} sets; ${muscle} is at ${week} of ${mrv} weekly sets.`,
      )
    }
    if (sets < 1) return []
    added.set(muscle, (added.get(muscle) ?? 0) + sets)
    return [{ ...r, sets }]
  })
}

function checkTrim(
  raw: unknown,
  session: PlannedExercise[],
  title: string,
  catalog: Catalog,
  lookup: (name: string) => string | undefined,
  errors: string[],
  adjustments: string[],
): Trim | undefined {
  if (!isObject(raw)) return undefined
  const trim: Trim = {}
  const keep = int(raw.keep_first_exercises) ?? 0
  if (keep > 0 && keep < session.length) trim.keepFirst = keep
  const drop = int(raw.drop_sets_per_exercise) ?? 0
  if (drop > 0) {
    trim.dropSets = Math.min(2, drop)
    if (drop > 2) adjustments.push(`${title}: at most 2 sets come off each exercise.`)
  }
  if (raw.hold_load === true) trim.holdLoad = true
  const swaps: NonNullable<Trim['swaps']> = []
  for (const s of Array.isArray(raw.swaps) ? raw.swaps.slice(0, 8) : []) {
    if (!isObject(s)) continue
    const fromAsked = text(s.from, 80)
    const fromName = catalog.resolve(fromAsked) ?? fromAsked
    const inSession = session.find(
      (e) => e.name.toLowerCase() === fromName.toLowerCase(),
    )
    if (!inSession) {
      errors.push(
        `${title}: cannot swap "${fromAsked}", it is not in the session (${session.map((e) => e.name).join(', ')}).`,
      )
      continue
    }
    const toAsked = text(s.to, 80)
    if (!toAsked) {
      swaps.push({ from: inSession.name, to: null })
      continue
    }
    const toName = catalog.resolve(toAsked)
    if (!toName) {
      const near = catalog.suggest(toAsked)
      errors.push(
        `${title}: "${toAsked}" is not in the catalog.` +
          (near.length ? ` Closest: ${near.join(', ')}.` : ''),
      )
      continue
    }
    if (toName === inSession.name) continue
    if (session.some((e) => e.name === toName)) {
      errors.push(`${title}: ${toName} is already in the session.`)
      continue
    }
    const a = lookup(inSession.name)
    const b = lookup(toName)
    if (a && b && a !== b) {
      adjustments.push(
        `${title}: ${inSession.name} to ${toName} moves the work from ${a} to ${b}.`,
      )
    }
    swaps.push({ from: inSession.name, to: toName })
  }
  if (swaps.length > 0) trim.swaps = swaps
  return Object.keys(trim).length > 0 ? trim : undefined
}

/** True for the items a warm-up or cool-down can be built around. */
const isStrength = (i: DayPlanItem): boolean =>
  (i.kind === 'block' && i.session === 'strength') ||
  (i.kind === 'template' && i.session === 'strength') ||
  i.kind === 'custom'

export function checkDayPlan(
  input: unknown,
  ctx: AgentContext,
  options: DayOption[],
  catalog: Catalog,
  source: CoachSource,
): DayPlanCheck {
  const errors: string[] = []
  const adjustments: string[] = []
  if (!isObject(input)) {
    return { plan: null, errors: ['The plan was not an object.'], adjustments }
  }
  const byId = new Map(options.map((o) => [o.id, o]))
  const rawItems = Array.isArray(input.items) ? input.items : []
  if (rawItems.length > MAX_ITEMS) {
    adjustments.push(`Kept the first ${MAX_ITEMS} items.`)
  }

  const items: DayPlanItem[] = []
  /** Warm-up and cool-down wait until the main session is known. */
  const pending: Array<{ at: number; kind: 'warmup' | 'cooldown'; note: string }> = []
  let customUsed = false

  rawItems.slice(0, MAX_ITEMS).forEach((raw, n) => {
    if (!isObject(raw)) return
    const id = text(raw.option_id, 60)
    const note = text(raw.note, 90)
    const key = `${n}:${id}`
    const noteField = note ? { note } : {}

    if (id === 'custom') {
      if (customUsed) {
        adjustments.push('Only one custom session per day; kept the first.')
        return
      }
      customUsed = true
      const c = input.custom_session
      if (!isObject(c)) {
        errors.push('An item uses "custom" but custom_session is null.')
        return
      }
      const title = text(c.title, 60) || 'Custom session'
      const rows = checkExerciseRows(
        c.exercises,
        title,
        catalog,
        ctx.lookup,
        errors,
        adjustments,
        MAX_CUSTOM_EXERCISES,
      )
      const exercises = capToWeek(rows, title, ctx, adjustments)
      if (rows.length > 0 && exercises.length === 0) {
        errors.push(
          `${title}: every muscle it trains is already at its weekly maximum. Plan recovery, or other muscles.`,
        )
      }
      if (exercises.length === 0) return
      items.push({
        key,
        kind: 'custom',
        title,
        exercises,
        minutes: strengthMinutes(sumSets(exercises)),
        ...noteField,
      })
      return
    }

    const option = byId.get(id)
    if (!option) {
      errors.push(
        `Unknown option_id "${id}". Use one of: ${options.map((o) => o.id).join(', ')}, or "custom".`,
      )
      return
    }
    if (option.kind === 'warmup' || option.kind === 'cooldown') {
      if (pending.some((p) => p.kind === option.kind)) return
      pending.push({ at: items.length, kind: option.kind, note })
      return
    }
    if (option.kind === 'routine') {
      items.push({
        key,
        kind: 'routine',
        routineId: option.routineId,
        title: option.title,
        minutes: option.minutes,
        ...noteField,
      })
      return
    }
    if (option.kind === 'user-routine') {
      items.push({
        key,
        kind: 'user-routine',
        templateId: option.templateId,
        title: option.title,
        minutes: option.minutes,
        ...noteField,
      })
      return
    }

    // A block day or a template
    const reshapes =
      option.session === 'strength' && !(option.kind === 'template' && option.slots)
    let trim = reshapes
      ? checkTrim(
          raw.trim,
          option.exercises,
          option.title,
          catalog,
          ctx.lookup,
          errors,
          adjustments,
        )
      : undefined
    // In the deload week the engine's prescription is already the light
    // one (about 90% load, half the reps). "Repeat last time" would swap
    // it for the hardest week of the block.
    if (trim?.holdLoad && option.kind === 'block' && option.deload) {
      const { holdLoad: _hold, ...rest } = trim
      trim = Object.keys(rest).length > 0 ? rest : undefined
      adjustments.push(
        `${option.title}: the deload week already lightens the load, so loads are not held.`,
      )
    }
    const trimmed = reshapes
      ? applyTrim(option.exercises, trim, ctx.lookup)
      : option.exercises
    // A held day repeats last time, so the engine's progressed targets
    // would promise numbers the session will not ask for
    const exercises = trim?.holdLoad
      ? trimmed.map(({ name, sets }) => ({ name, sets }))
      : trimmed
    if (reshapes && exercises.length === 0) {
      errors.push(`${option.title}: nothing is left after the changes.`)
      return
    }
    const minutes =
      option.session === 'strength'
        ? strengthMinutes(sumSets(exercises))
        : option.minutes
    if (option.kind === 'block') {
      items.push({
        key,
        kind: 'block',
        mesoId: option.mesoId,
        dayIndex: option.dayIndex,
        session: option.session,
        title: option.title,
        exercises,
        minutes,
        ...(trim && { trim }),
        ...noteField,
      })
    } else {
      items.push({
        key,
        kind: 'template',
        templateId: option.templateId,
        session: option.session,
        title: option.title,
        exercises,
        minutes,
        ...(trim && { trim }),
        ...noteField,
      })
    }
  })

  // A session nobody placed would vanish without a word
  const orphan = input.custom_session
  if (
    !customUsed &&
    isObject(orphan) &&
    Array.isArray(orphan.exercises) &&
    orphan.exercises.length > 0
  ) {
    errors.push(
      'custom_session was given but no item has option_id "custom". Add an item with option_id "custom" where the session belongs, or send custom_session: null.',
    )
  }

  // Warm-up and cool-down are generated from what the main session trains
  const main = items.find(isStrength)
  const muscles =
    main && 'exercises' in main ? musclesOf(main.exercises, ctx.lookup) : []
  // Insert from the back so earlier positions stay valid
  for (const p of [...pending].sort((a, b) => b.at - a.at)) {
    const routine = generatedRoutine(
      muscles,
      p.kind === 'warmup' ? 'pre' : 'post',
      ctx.now,
    )
    if (!routine) {
      adjustments.push(
        p.kind === 'warmup'
          ? 'No warm-up: there is no strength session to build it from.'
          : 'No cool-down: there is no strength session to build it from.',
      )
      continue
    }
    const total = routine.items.reduce(
      (s, it) => s + it.seconds * (it.perSide ? 2 : 1) + routine.transitionSec,
      0,
    )
    items.splice(p.at, 0, {
      key: p.kind,
      kind: p.kind,
      title: p.kind === 'warmup' ? 'Warm-up' : 'Cool-down',
      muscles,
      minutes: Math.max(1, Math.round(total / 60)),
      ...(p.note && { note: p.note }),
    })
  }

  if (errors.length > 0) return { plan: null, errors, adjustments }

  const headline =
    text(input.headline, 60) || main?.title || (items[0]?.title ?? 'Rest day')
  const plan: DayPlan = {
    date: localDateOf(ctx.now),
    headline,
    rationale: text(input.rationale, 320),
    items,
    adjustments,
    source,
    createdAt: new Date(ctx.now).toISOString(),
  }
  return { plan, errors, adjustments }
}
