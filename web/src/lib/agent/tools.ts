// The coach's tools, run here in the browser. The model only ever
// proposes: each call is checked against the engine, and the result it
// gets back says what was accepted, what was changed, and what to fix.
// Nothing here starts a session or saves a block; those take a tap.

import { epley } from '../analytics'
import type { Checkin } from '../checkins'
import { durationMinutes, localDay } from '../wellness'
import { checkBlock } from './block'
import { checkDayPlan } from './plan'
import type { Prepared } from './snapshot'
import type {
  AgentContext,
  AgentEffects,
  CoachNote,
  CoachSource,
  NoteCategory,
  ToolOutcome,
} from './types'

const DAY = 86_400_000
const MAX_NOTES = 20

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const int = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null

const ok = (body: unknown, extra: Partial<ToolOutcome> = {}): ToolOutcome => ({
  result: JSON.stringify(body),
  isError: false,
  followUp: false,
  ...extra,
})

const fail = (body: unknown): ToolOutcome => ({
  result: JSON.stringify(body),
  isError: true,
  followUp: true,
})

function exerciseHistory(input: unknown, ctx: AgentContext, prep: Prepared): ToolOutcome {
  const asked = isObject(input) && typeof input.exercise === 'string' ? input.exercise : ''
  const name = prep.catalog.resolve(asked) ?? asked.trim()
  const lower = name.toLowerCase()
  const limit = Math.min(12, Math.max(1, (isObject(input) && int(input.sessions)) || 5))
  const sessions: Array<{ date: string; sets: string }> = []
  let best: { e1rm: number; set: string; date: string } | null = null
  let count = 0
  for (const w of ctx.workouts) {
    if (w.kind !== 'strength') continue
    const e = w.exercises.find((x) => x.name.trim().toLowerCase() === lower)
    if (!e) continue
    const done = e.sets.filter((s) => s.weight != null && s.reps != null)
    if (done.length === 0) continue
    count++
    if (sessions.length < limit) {
      sessions.push({
        date: localDay(w.start),
        sets: done
          .map((s) => `${s.weight}×${s.reps}${s.rpe != null ? `@${s.rpe}` : ''}`)
          .join(', '),
      })
    }
    for (const s of done) {
      if (s.reps! < 1) continue
      const e1rm = epley(s.weight!, s.reps!)
      if (!best || e1rm > best.e1rm) {
        best = { e1rm, set: `${s.weight}×${s.reps}`, date: localDay(w.start) }
      }
    }
  }
  if (count === 0) {
    const near = prep.catalog.suggest(asked)
    return ok(
      {
        exercise: name,
        sessions: [],
        note: 'No logged sets for this exercise.',
        ...(near.length > 0 && !prep.catalog.resolve(asked) && { closest_names: near }),
      },
      { followUp: true },
    )
  }
  return ok(
    {
      exercise: name,
      unit: ctx.unit,
      sessions_logged: count,
      // newest first
      sessions,
      best_estimated_1rm: best
        ? { value: Math.round(best.e1rm), from: best.set, date: best.date }
        : null,
    },
    { followUp: true },
  )
}

function trainingLog(input: unknown, ctx: AgentContext): ToolOutcome {
  const days = Math.min(60, Math.max(8, (isObject(input) && int(input.days)) || 28))
  const since = new Date(ctx.now - days * DAY).toISOString()
  const rows = ctx.workouts
    .filter((w) => w.start >= since)
    .map((w) => {
      const sets: Record<string, number> = {}
      if (w.kind === 'strength') {
        for (const e of w.exercises) {
          const m = ctx.lookup(e.name)
          if (m) sets[m] = (sets[m] ?? 0) + e.sets.length
        }
      }
      return {
        date: localDay(w.start),
        title: w.title || w.kind,
        kind: w.kind,
        ...(durationMinutes(w) != null && { min: durationMinutes(w) }),
        ...(w.sessionRpe != null && { effort: w.sessionRpe }),
        ...(Object.keys(sets).length > 0 && { sets }),
      }
    })
    .reverse()
  // Weekly direct sets per muscle, averaged over the window: the anchor
  // for where a new block should open.
  const totals: Record<string, number> = {}
  for (const r of rows) {
    for (const [m, n] of Object.entries(r.sets ?? {})) {
      totals[m] = (totals[m] ?? 0) + n
    }
  }
  const weeks = days / 7
  const weekly = Object.fromEntries(
    Object.entries(totals)
      .sort((a, b) => b[1] - a[1])
      .map(([m, n]) => [m, Math.round((n / weeks) * 10) / 10]),
  )
  return ok(
    { days, sessions: rows, avg_weekly_sets_by_muscle: weekly },
    { followUp: true },
  )
}

function setDayPlan(
  input: unknown,
  ctx: AgentContext,
  prep: Prepared,
  effects: AgentEffects,
  source: CoachSource,
): ToolOutcome {
  const check = checkDayPlan(input, ctx, prep.options, prep.catalog, source)
  if (!check.plan) {
    return fail({
      status: 'rejected',
      errors: check.errors,
      fix: 'Correct these and call set_day_plan again.',
    })
  }
  effects.setDayPlan(check.plan)
  const adjusted = check.adjustments.length > 0
  return ok(
    {
      status: adjusted ? 'saved_with_changes' : 'saved',
      ...(adjusted && { engine_changes: check.adjustments }),
      items: check.plan.items.map((i) => ({
        title: i.title,
        ...(i.minutes != null && { min: i.minutes }),
        ...('exercises' in i &&
          i.exercises.length > 0 && {
            exercises: i.exercises.map((e) => `${e.name} ${e.sets}`),
          }),
      })),
    },
    // The engine changed something: let the model see it and say so
    { card: { type: 'day-plan', plan: check.plan }, followUp: adjusted },
  )
}

function proposeBlock(input: unknown, ctx: AgentContext, prep: Prepared): ToolOutcome {
  const check = checkBlock(input, ctx, prep.catalog)
  if (!check.proposal) {
    return fail({
      status: 'rejected',
      errors: check.errors,
      ...(check.warnings.length > 0 && { warnings: check.warnings }),
      fix: 'Correct these and call propose_block again.',
    })
  }
  const p = check.proposal
  const changed = check.adjustments.length > 0 || check.warnings.length > 0
  return ok(
    {
      status: changed ? 'shown_with_notes' : 'shown',
      ...(check.adjustments.length > 0 && { engine_changes: check.adjustments }),
      ...(check.warnings.length > 0 && { warnings: check.warnings }),
      weekly_sets: Object.fromEntries(
        p.volume.map((v) => [v.muscle, { sets: v.sets, zone: v.zone }]),
      ),
      days: p.days.map((d, i) => ({ label: d.label, min: p.minutes[i] })),
    },
    {
      card: { type: 'block', id: crypto.randomUUID(), proposal: p },
      followUp: changed,
    },
  )
}

function offerChoices(input: unknown): ToolOutcome {
  const raw = isObject(input) && Array.isArray(input.options) ? input.options : []
  const options = raw
    .filter((o): o is string => typeof o === 'string' && o.trim().length > 0)
    .map((o) => o.trim().slice(0, 40))
    .slice(0, 5)
  if (options.length === 0) return ok({ status: 'nothing to show' })
  return ok({ status: 'shown' }, { card: { type: 'choices', options } })
}

function logCheckin(input: unknown, effects: AgentEffects): ToolOutcome {
  if (!isObject(input)) return fail({ error: 'no values' })
  const patch: Partial<Checkin> = {}
  const scale = (v: unknown) => {
    const n = int(v)
    return n != null && n >= 1 && n <= 5 ? n : undefined
  }
  const sleep = scale(input.sleep)
  const energy = scale(input.energy)
  const soreness = scale(input.soreness)
  const stress = scale(input.stress)
  const prs = int(input.prs)
  if (sleep) patch.sleep = sleep
  // The check-in calls energy "fatigue": 5 is fresh
  if (energy) patch.fatigue = energy
  if (soreness) patch.soreness = soreness
  if (stress) patch.stress = stress
  if (prs != null && prs >= 0 && prs <= 10) patch.prs = prs
  if (Object.keys(patch).length === 0) {
    return ok({ status: 'nothing recorded', note: 'No scale had a value.' }, { followUp: true })
  }
  effects.saveCheckin(patch)
  return ok(
    { status: 'recorded', sleep, energy, soreness, stress, prs: patch.prs },
    // A check-in is an input to a plan, not an answer: keep going
    { card: { type: 'checkin', saved: patch }, followUp: true },
  )
}

const CATEGORIES: NoteCategory[] = [
  'goal',
  'schedule',
  'equipment',
  'injury',
  'preference',
]

function remember(input: unknown, ctx: AgentContext, effects: AgentEffects): ToolOutcome {
  const textIn = isObject(input) && typeof input.note === 'string' ? input.note.trim() : ''
  if (!textIn) return fail({ error: 'empty note' })
  if (ctx.notes.length >= MAX_NOTES) {
    return ok(
      {
        status: 'not saved',
        note: `There are already ${MAX_NOTES} notes; the athlete can remove some in settings.`,
      },
      { followUp: true },
    )
  }
  const category =
    isObject(input) && CATEGORIES.includes(input.category as NoteCategory)
      ? (input.category as NoteCategory)
      : 'preference'
  const note: CoachNote = {
    id: crypto.randomUUID(),
    category,
    text: textIn.slice(0, 160),
    createdAt: new Date(ctx.now).toISOString(),
  }
  effects.addNote(note)
  return ok({ status: 'saved' }, { card: { type: 'note', note } })
}

export function runTool(
  name: string,
  input: unknown,
  ctx: AgentContext,
  prep: Prepared,
  effects: AgentEffects,
  source: CoachSource,
): ToolOutcome {
  try {
    switch (name) {
      case 'get_exercise_history':
        return exerciseHistory(input, ctx, prep)
      case 'get_training_log':
        return trainingLog(input, ctx)
      case 'set_day_plan':
        return setDayPlan(input, ctx, prep, effects, source)
      case 'propose_block':
        return proposeBlock(input, ctx, prep)
      case 'offer_choices':
        return offerChoices(input)
      case 'log_checkin':
        return logCheckin(input, effects)
      case 'remember':
        return remember(input, ctx, effects)
      default:
        return fail({ error: `unknown tool ${name}` })
    }
  } catch (err) {
    return fail({ error: err instanceof Error ? err.message : 'tool failed' })
  }
}
