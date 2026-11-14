// The <state> block: everything the coach needs to know about this athlete
// right now, computed by the engine and compressed to a few hundred tokens.
// Front-loading it is what lets a small model answer most turns in one
// call: it reasons over digested facts (zones, targets, flags) instead of
// fetching and adding up raw logs.

import { epley } from '../analytics'
import {
  activeMeso,
  doneDayIndexes,
  isDeloadWeek,
  mesoOverdue,
  mesoWeek,
  sessionsForToday,
  WEEKDAY_SHORT,
} from '../mesocycle'
import { recommendations, weeklySetsByMuscle } from '../progression'
import { durationMinutes, localDay, sessionLoad } from '../wellness'
import type { Workout } from '../workouts'
import { volumeZone } from './block'
import { makeCatalog, type Catalog } from './catalog'
import { buildOptions, nextBlockOption, type DayOption } from './options'
import { localDateOf } from './plan'
import type { AgentContext, Trim } from './types'

const DAY = 86_400_000

const round1 = (n: number) => Math.round(n * 10) / 10

function partOfDay(hour: number): string {
  if (hour < 5) return 'night'
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  if (hour < 21) return 'evening'
  return 'night'
}

function setsByMuscle(
  w: Workout,
  lookup: (name: string) => string | undefined,
): Record<string, number> {
  const out: Record<string, number> = {}
  if (w.kind !== 'strength') return out
  for (const e of w.exercises) {
    const m = lookup(e.name)
    if (m) out[m] = (out[m] ?? 0) + e.sets.length
  }
  return out
}

/** "185×8, 185×8, 180×7" for one logged exercise. */
function setLine(sets: Workout['exercises'][number]['sets']): string {
  return sets
    .filter((s) => s.weight != null && s.reps != null)
    .map((s) => `${s.weight}×${s.reps}${s.rpe != null ? `@${s.rpe}` : ''}`)
    .join(', ')
}

/** The lifts trained most recently, each with its last session and best
 * estimated max of the last 90 days. */
function mainLifts(ctx: AgentContext, limit: number) {
  const since = new Date(ctx.now - 90 * DAY).toISOString()
  const seen = new Map<string, { name: string; last: string; e1rm: number }>()
  for (const w of ctx.workouts) {
    if (w.kind !== 'strength' || w.start < since) continue
    for (const e of w.exercises) {
      const line = setLine(e.sets)
      if (!line) continue
      const key = e.name.toLowerCase()
      const best = Math.max(
        ...e.sets.map((s) =>
          s.weight != null && s.reps != null && s.reps >= 1
            ? epley(s.weight, s.reps)
            : 0,
        ),
      )
      const have = seen.get(key)
      if (have) have.e1rm = Math.max(have.e1rm, best)
      else if (seen.size < limit) {
        seen.set(key, {
          name: e.name,
          last: `${line} (${localDay(w.start).slice(5)})`,
          e1rm: best,
        })
      }
    }
  }
  return [...seen.values()].map((l) => ({ ...l, e1rm: Math.round(l.e1rm) }))
}

function optionForModel(o: DayOption) {
  if (o.kind === 'block') {
    return {
      id: o.id,
      kind: o.session,
      title: o.title,
      min: o.minutes,
      ...(o.scheduledToday && { today: true }),
      ...(o.doneThisWeek && { done: true }),
      ...(o.exercises.length > 0 && { exercises: o.exercises }),
    }
  }
  if (o.kind === 'template') {
    return {
      id: o.id,
      kind: o.session === 'strength' ? 'strength template' : 'timer template',
      title: o.title,
      min: o.minutes,
      ...(o.slots && { note: 'exercises are picked at start; cannot be trimmed' }),
      ...(o.exercises.length > 0 && !o.slots && { exercises: o.exercises }),
    }
  }
  if (o.kind === 'warmup' || o.kind === 'cooldown') {
    return { id: o.id, kind: 'routine', title: o.title, note: 'built from the main session' }
  }
  return { id: o.id, kind: 'routine', title: o.title, min: o.minutes }
}

/** A saved trim in the tool's own field names, so the model can send it
 * straight back when it amends the plan. */
function trimForModel(t: Trim) {
  return {
    keep_first_exercises: t.keepFirst ?? 0,
    drop_sets_per_exercise: t.dropSets ?? 0,
    hold_load: t.holdLoad === true,
    swaps: (t.swaps ?? []).map((s) => ({ from: s.from, to: s.to ?? '' })),
  }
}

export interface Prepared {
  /** The snapshot as an object, for tests and the built-in coach. */
  state: Record<string, unknown>
  options: DayOption[]
  catalog: Catalog
}

export function prepare(ctx: AgentContext): Prepared {
  const now = new Date(ctx.now)
  const today = localDateOf(ctx.now)
  const options = buildOptions(ctx)
  const catalog = makeCatalog(ctx.customs)
  const flags: string[] = []

  // ---- readiness ----
  const c = ctx.checkins.find((x) => x.date === today)
  const checkin = c
    ? {
        ...(c.sleep != null && { sleep: c.sleep }),
        ...(c.fatigue != null && { energy: c.fatigue }),
        ...(c.soreness != null && { soreness: c.soreness }),
        ...(c.stress != null && { stress: c.stress }),
        ...(c.prs != null && { prs: c.prs }),
        ...(c.soreRegions?.length && { sore: c.soreRegions }),
        ...(c.note && { note: c.note.slice(0, 120) }),
      }
    : null
  if (!checkin || Object.keys(checkin).length === 0) flags.push('no_checkin_today')
  const low =
    (c?.prs != null && c.prs <= 3) ||
    [c?.sleep, c?.fatigue, c?.soreness].some((v) => v != null && v <= 2) ||
    (ctx.strap?.recovery != null && ctx.strap.recovery < 34)
  if (low) flags.push('readiness_low')

  const weekAgo = new Date(ctx.now - 7 * DAY).toISOString()
  const last7 = ctx.workouts.filter((w) => w.start >= weekAgo)
  let load = 0
  let rated = 0
  let minutes = 0
  for (const w of last7) {
    minutes += durationMinutes(w) ?? 0
    const l = sessionLoad(w)
    if (l != null) {
      load += l
      rated++
    }
  }

  const recs = recommendations(ctx.workouts, ctx.lookup, ctx.now)
  for (const r of Object.values(recs)) {
    if (r.deload) flags.push(`deload_cue:${r.muscle}`)
  }

  // ---- block ----
  const meso = activeMeso(ctx.mesos)
  let block: Record<string, unknown> | null = null
  if (meso) {
    const overdue = mesoOverdue(meso, ctx.now)
    const week = Math.min(mesoWeek(meso, ctx.now), meso.weeks - 1)
    const done = doneDayIndexes(meso, ctx.workouts, week)
    if (overdue) flags.push('block_finished')
    block = {
      name: meso.name,
      week: week + 1,
      weeks: meso.weeks,
      ...(isDeloadWeek(meso, week) && { deload: true }),
      ...(overdue && { finished: true }),
      focus: meso.focus,
      done_this_week: done.size,
      days: meso.days.map((d, i) => ({
        // A finished block has no sessions left to plan, so no ids to use
        ...(!overdue && { id: `block:${i}` }),
        label: d.label,
        ...(d.weekday != null && {
          weekday: WEEKDAY_SHORT[d.weekday].toLowerCase(),
        }),
        ...(done.has(i) && { done: true }),
      })),
    }
  }

  // ---- today ----
  const trained = ctx.workouts
    .filter((w) => localDay(w.start) === today)
    .map((w) => ({
      title: w.title || w.kind,
      kind: w.kind,
      min: durationMinutes(w) ?? undefined,
    }))
  if (trained.some((t) => t.kind !== 'recovery')) flags.push('trained_today')
  const scheduled =
    meso && !mesoOverdue(meso, ctx.now)
      ? sessionsForToday(meso, ctx.workouts, ctx.now).map((i) => `block:${i}`)
      : []
  const plan =
    ctx.dayPlan && ctx.dayPlan.date === today
      ? {
          headline: ctx.dayPlan.headline,
          // Enough to send the same plan back with one thing changed
          items: ctx.dayPlan.items.map((i) => ({
            option_id:
              i.kind === 'custom' ? 'custom' : i.key.slice(i.key.indexOf(':') + 1),
            title: i.title,
            ...(i.kind === 'custom' && {
              exercises: i.exercises.map((e) => ({ name: e.name, sets: e.sets })),
            }),
            ...('trim' in i && i.trim && { trim: trimForModel(i.trim) }),
          })),
        }
      : null

  // ---- training picture ----
  const weekly = weeklySetsByMuscle(ctx.workouts, ctx.lookup, ctx.now)
  const volume7d = Object.fromEntries(
    Object.entries(weekly)
      .sort((a, b) => b[1] - a[1])
      .map(([m, sets]) => [m, { sets, zone: volumeZone(m, sets) }]),
  )
  const recent = last7.slice(0, 8).map((w) => {
    const sets = setsByMuscle(w, ctx.lookup)
    return {
      date: localDay(w.start),
      title: w.title || w.kind,
      kind: w.kind,
      ...(durationMinutes(w) != null && { min: durationMinutes(w) }),
      ...(w.sessionRpe != null && { effort: w.sessionRpe }),
      ...(Object.keys(sets).length > 0 && { sets }),
    }
  })

  const state: Record<string, unknown> = {
    now: {
      date: today,
      weekday: WEEKDAY_SHORT[(now.getDay() + 6) % 7].toLowerCase(),
      time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
      part: partOfDay(now.getHours()),
    },
    units: ctx.unit,
    ...(ctx.bodyWeightLb != null && { body_weight_lb: round1(ctx.bodyWeightLb) }),
    notes: ctx.notes.map((n) => ({ category: n.category, note: n.text })),
    readiness: {
      checkin,
      strap: ctx.strap
        ? {
            ...(ctx.strap.recovery != null && {
              recovery: Math.round(ctx.strap.recovery),
            }),
            ...(ctx.strap.hrvMs != null && { hrv_ms: Math.round(ctx.strap.hrvMs) }),
            ...(ctx.strap.hrvVs30d != null && {
              hrv_vs_30d: round1(ctx.strap.hrvVs30d),
            }),
            ...(ctx.strap.rhr != null && { resting_hr: Math.round(ctx.strap.rhr) }),
            ...(ctx.strap.rhrVs30d != null && {
              resting_hr_vs_30d: round1(ctx.strap.rhrVs30d),
            }),
            ...(ctx.strap.sleepHours != null && {
              sleep_h: round1(ctx.strap.sleepHours),
            }),
            ...(ctx.strap.sleepPerformancePct != null && {
              sleep_pct_of_need: Math.round(ctx.strap.sleepPerformancePct),
            }),
          }
        : null,
      load_7d: {
        sessions: last7.filter((w) => w.kind !== 'recovery').length,
        minutes,
        ...(rated > 0 && { effort_x_minutes: load }),
      },
      flags,
    },
    block,
    ...(ctx.pendingBlock && {
      proposal: {
        name: ctx.pendingBlock.name,
        weeks: ctx.pendingBlock.weeks,
        focus_muscles: ctx.pendingBlock.focus,
        days: ctx.pendingBlock.days.map((d) => ({
          label: d.label,
          weekday:
            d.weekday != null ? WEEKDAY_SHORT[d.weekday].toLowerCase() : 'any',
          exercises: d.exercises.map((e) => ({ name: e.name, sets: e.setCount })),
        })),
      },
    }),
    today: { scheduled, next: nextBlockOption(ctx), trained, plan },
    options: options.map(optionForModel),
    volume7d,
    recent,
    lifts: mainLifts(ctx, 8),
    catalog: catalog.byMuscle,
  }
  return { state, options, catalog }
}

/**
 * The text block that opens the latest user message. Angle brackets inside
 * the JSON are escaped, so no title, note or exercise name can close the
 * block early and read as the athlete's message.
 */
export function stateBlock(state: Record<string, unknown>): string {
  return `<state>\n${JSON.stringify(state).replace(/</g, '\\u003c')}\n</state>`
}
