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
  landmarksFor,
  recommendations,
  SESSION_SET_CAP,
  type Recommendation,
} from './progression'
import { storageKey } from './storage'
import type { IntervalSection, Workout } from './workouts'

export interface MesoExercise {
  name: string
  setCount: number
  muscle?: string
}

export interface MesoDay {
  label: string
  exercises: MesoExercise[]
  /** 0=Mon … 6=Sun. Absent on legacy mesos → sequence-based scheduling.
   * Two days may share a weekday (cardio in the morning, legs at night —
   * array order is the within-day order). */
  weekday?: number
  /** 'cardio' days start an interval/stopwatch session instead of a
   * strength ledger. Absent = 'strength' (legacy). */
  kind?: 'strength' | 'cardio'
  /** Cardio only: interval plan; empty/absent = stopwatch. */
  sections?: IntervalSection[]
}

export function dayKind(d: MesoDay): 'strength' | 'cardio' {
  return d.kind ?? 'strength'
}

/** Monday-first weekday index for a timestamp. */
export function mondayWeekday(nowMs: number): number {
  return (new Date(nowMs).getDay() + 6) % 7
}

export const WEEKDAY_SHORT = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']

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
 * Which microcycle day comes next this week: today's un-done sessions
 * first, then the nearest upcoming weekday's; weekday-less (legacy) days
 * fall back to array order after any anchored day. Wraps if the lifter
 * trains more days than planned.
 */
export function nextDayIndex(
  m: Mesocycle,
  workouts: Workout[],
  nowMs: number,
): number {
  const week = mesoWeek(m, nowMs)
  const done = doneDayIndexes(m, workouts, week)
  const todayW = mondayWeekday(nowMs)
  let best = -1
  let bestScore = Infinity
  m.days.forEach((d, i) => {
    if (done.has(i)) return
    // anchored days sort by distance-from-today (today = 0), ties by
    // array order (the AM session of a double comes first); legacy
    // weekday-less days sort after everything anchored
    const score =
      d.weekday == null
        ? 1000 + i
        : ((d.weekday - todayW + 7) % 7) * 10 + i / 100
    if (score < bestScore) {
      best = i
      bestScore = score
    }
  })
  if (best >= 0) return best
  return workoutsInWeek(m, workouts, week).length % m.days.length
}

/** Indexes of today's planned, not-yet-trained sessions (may be several —
 * doubles are a feature). Empty for legacy weekday-less mesos. */
export function sessionsForToday(
  m: Mesocycle,
  workouts: Workout[],
  nowMs: number,
): number[] {
  const week = mesoWeek(m, nowMs)
  const done = doneDayIndexes(m, workouts, week)
  const todayW = mondayWeekday(nowMs)
  return m.days
    .map((d, i) => ({ d, i }))
    .filter(({ d, i }) => d.weekday === todayW && !done.has(i))
    .map(({ i }) => i)
}

// ---- prescriptions (PROGRESSION.md §6) ----

/** Accumulation ramp: focus muscles add a set per week, capped — RP's own
 * stated block total is 2-3 sets per muscle per session, so 3 is the most
 * a session may gain across a whole block. */
const FOCUS_RAMP_PER_WEEK = 1
const FOCUS_RAMP_MAX = 3

/**
 * Ceiling on how much a focus muscle's WEEKLY volume may grow across one
 * block: half again what the microcycle authors. The set landmarks are
 * absolute, but tolerance for *change* is relative — Scarpelli 2020 found
 * volume individualized to 1.2x habitual beat a fixed 22 sets/week, and
 * the fastest progression anyone has actually studied (Enes 2024/2025,
 * +4-6 sets/week every fortnight off a 22-set base, i.e. ~9-13%/week)
 * bought extra strength but NO extra hypertrophy, at a dose-dependent cost
 * in training strain. Without this rail an absolute "+1 set/week" is +50%
 * a week on a 2-set lift and +12% on an 8-set one — the same number
 * meaning wildly different things.
 */
const FOCUS_BLOCK_GROWTH = 0.5

/**
 * Where the ramp schedule stands at a given week: +1 set/week, frozen for
 * the last hard week (rampWeeks tops out at weeks-3) so the block never
 * introduces volume a deload is about to erase. The BUDGET below decides
 * how far this schedule is allowed to run.
 */
function rampSchedule(m: Mesocycle, week: number): number {
  const rampWeeks = Math.min(week, Math.max(0, m.weeks - 3))
  return Math.min(rampWeeks * FOCUS_RAMP_PER_WEEK, FOCUS_RAMP_MAX)
}

/**
 * Weekly sets the microcycle authors for each muscle, and how many of the
 * week's sessions train it. The landmarks are WEEKLY figures, so a muscle
 * trained twice a week must not take the week's increase twice — that
 * alone doubled the intended rate for anyone running an upper/lower or
 * push/pull split.
 */
function weeklyPlan(
  m: Mesocycle,
  lookup: (name: string) => string | undefined,
): { sets: Map<string, number>; days: Map<string, number> } {
  const sets = new Map<string, number>()
  const days = new Map<string, number>()
  for (const d of m.days) {
    const tags = new Map<string, string>()
    for (const e of d.exercises) {
      if (e.muscle !== undefined) tags.set(e.name.toLowerCase(), e.muscle)
    }
    const here = new Set<string>()
    for (const e of d.exercises) {
      const muscle = tags.get(e.name.toLowerCase()) ?? lookup(e.name)
      if (muscle === undefined) continue
      sets.set(muscle, (sets.get(muscle) ?? 0) + e.setCount)
      here.add(muscle)
    }
    for (const muscle of here) days.set(muscle, (days.get(muscle) ?? 0) + 1)
  }
  return { sets, days }
}

/**
 * How many sets the block's ramp may add to ONE SESSION of a muscle.
 * Four rails, tightest wins:
 *  - RP's stated block total for a session (FOCUS_RAMP_MAX);
 *  - proportional growth (FOCUS_BLOCK_GROWTH), shared across the sessions
 *    that train the muscle so frequency doesn't multiply the dose;
 *  - weekly MRV headroom, likewise shared;
 *  - whatever is left of the per-session cap, so the ramp can never eat
 *    sets off the other lifts the athlete programmed.
 * Non-focus muscles hold the volume the athlete authored, full stop. The
 * app does not silently rewrite what you programmed: a block that is not
 * about your chest is not the place to quietly grow it.
 */
function rampBudget(
  m: Mesocycle,
  muscle: string,
  weeklySets: number,
  frequency: number,
  daySets: number,
): number {
  const marks = landmarksFor(muscle)
  const freq = Math.max(1, frequency)
  const cap = m.focus.includes(muscle)
    ? Math.min(
        FOCUS_RAMP_MAX,
        // Rounds DOWN — the budget is spent once per SESSION, so rounding
        // 2.5 up turns a 50% weekly cap into 60% on a twice-a-week muscle.
        // The floor of 1 is the escape hatch for tiny volumes, where one
        // set is coarser than the percentage and standing still helps
        // nobody; that is the only case allowed past the cap.
        Math.max(1, Math.floor((weeklySets * FOCUS_BLOCK_GROWTH) / freq)),
      )
    : 0
  const weeklyRoom = Math.floor(Math.max(0, marks.mrv - weeklySets) / freq)
  const sessionRoom = Math.max(0, SESSION_SET_CAP - daySets)
  return Math.max(0, Math.min(cap, weeklyRoom, sessionRoom))
}

/** Where the ramp actually stands: the schedule, spent no further than the
 * budget allows. */
function rampAt(m: Mesocycle, week: number, budget: number): number {
  return Math.min(budget, rampSchedule(m, week))
}

/**
 * Inside a block, feedback may only HOLD or CUT — the ramp is the only
 * thing that adds.
 *
 * RP is explicit that a set increase happens "if warranted" rather than on
 * a schedule, so the block's ramp and the week's feedback are two views of
 * ONE decision, not two additions; letting both fire tripled a focus
 * muscle's weekly volume in two weeks. Clamping the DELTA (rather than the
 * resulting total) also keeps the session's shape: capping the total after
 * the fact let a +1 land on the compound and the matching trim come off
 * the isolation, so one lift doubled while the muscle barely moved.
 *
 * "Too easy, not enough volume" every week is information about where the
 * NEXT block should start, not licence to outrun this one.
 */
function cutsOnly(
  recs: Record<string, Recommendation>,
): Record<string, Recommendation> {
  const out: Record<string, Recommendation> = {}
  for (const [muscle, r] of Object.entries(recs)) {
    out[muscle] = r.setDelta > 0 ? { ...r, setDelta: 0 } : r
  }
  return out
}

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
function increment(
  muscle: string | undefined,
  weight: number,
  force = false,
): number | null {
  const step = muscle !== undefined && LOWER_BODY.has(muscle) ? 10 : 5
  const bumped = Math.round((weight + step) / 5) * 5
  // `force` overrides the 5% rule: once reps have run well past the window
  // the coarse jump beats turning a lateral raise into an endurance set.
  if (!force && bumped - weight > weight * 0.05) return null
  return bumped
}

/** "4×8" while every set shares a target, "13/11/9" once they diverge. */
function repText(targets: number[], sets: number): string {
  return targets.every((r) => r === targets[0])
    ? `${sets}×${targets[0]}`
    : targets.join('/')
}

export interface Prescription {
  /** Suggested working weight (absent = find one, ~3 RIR). */
  weight?: number
  /** Headline rep target (the top set's). */
  targetReps?: number
  /** Per-set rep targets, one per planned set — a 12/10 session progresses
   * to 13/11, not to 13/13. Same order the rows are logged in. */
  targetRepsBySet?: number[]
  repLow: number
  repHigh: number
  sets: number
  /** null on the deload week. */
  rir: number | null
  /** Human line for the session card, e.g. "4×8 @ 335 lb · 2 RIR". */
  note: string
}

/** Top completed set: heaviest, ties broken by reps. */
function topSet(
  w: Workout,
  name: string,
): { weight?: number; reps?: number; rpe?: number } | null {
  const ex = w.exercises.find(
    (e) => e.name.toLowerCase() === name.toLowerCase(),
  )
  if (!ex || ex.sets.length === 0) return null
  let best: { weight?: number; reps?: number; rpe?: number } | null = null
  for (const s of ex.sets) {
    if (s.weight == null && s.reps == null) continue
    // A weight with no reps is unverified — a stray number typed into the
    // weight box must never become next week's prescription. (Reps-only
    // rows still count: that is how bodyweight work is logged.)
    if (s.weight != null && s.reps == null) continue
    if (
      !best ||
      (s.weight ?? 0) > (best.weight ?? 0) ||
      ((s.weight ?? 0) === (best.weight ?? 0) && (s.reps ?? 0) > (best.reps ?? 0))
    ) {
      best = { weight: s.weight, reps: s.reps, rpe: s.rpe }
    }
  }
  return best
}

/** Reps of each logged set of an exercise, in order — the SHAPE of the
 * session, not just its best set. Rep-less rows (a stray weight, an
 * abandoned row) drop out: they are not a rep target to build on. */
function setReps(w: Workout, name: string): number[] {
  const ex = w.exercises.find(
    (e) => e.name.toLowerCase() === name.toLowerCase(),
  )
  if (!ex) return []
  return ex.sets
    .map((s) => s.reps)
    .filter((r): r is number => r != null && r > 0)
}

/**
 * Spread the session's rep target across its sets, keeping the SHAPE of
 * the anchor session: each set gives up the same ground it gave up last
 * time, so a 12/10 session earns 13/11 rather than a flat 13/13.
 *
 * Two rails keep that shape honest, because a plan that only ever repeats
 * what happened can only ever decay:
 *  - never below the window bottom while the headline is at or above it —
 *    the rep window IS the plan, and a back-off set is not a licence to
 *    drift out of it;
 *  - never more than one rep above what that set actually did, so a slot
 *    that came in short climbs back a rep a week instead of being handed
 *    a target it already missed.
 * Together they make a shortfall self-correcting: simulated over two
 * blocks, back-off sets that lose a rep a week recover instead of
 * spiralling (the shape-only rule reached 10/3/3 by block 2).
 *
 * Sets beyond what the anchor logged repeat its last one — the same rule
 * the ghost column uses. With no per-set history at all, every set gets
 * the headline.
 */
function repsBySet(
  headline: number,
  basis: number,
  low: number,
  anchorSetReps: number[],
  sets: number,
): number[] {
  return Array.from({ length: Math.max(1, sets) }, (_, i) => {
    const actual = anchorSetReps[i] ?? anchorSetReps.at(-1)
    if (actual == null) return headline
    const dropoff = Math.max(0, basis - actual)
    return Math.max(
      1,
      Math.min(Math.max(low, headline - dropoff), actual + 1),
    )
  })
}

/** Deload variant: every set halves its OWN reps, no shape rails — the
 * point of the week is that nothing is being chased. */
function mapReps(
  map: (r: number) => number,
  anchorSetReps: number[],
  sets: number,
  headline: number,
): number[] {
  return Array.from({ length: Math.max(1, sets) }, (_, i) => {
    const r = anchorSetReps[i] ?? anchorSetReps.at(-1)
    return r == null ? headline : Math.max(1, map(r))
  })
}

// ---- RIR-normalized load anchoring (PROGRESSION.md §7) ----
// A set of N reps at E RIR is roughly an (N+E)-rep max, so moving between
// effort levels is a load change even at the same reps. Without this, week
// 1 of a block ghosts last block's near-failure weight and calls it 3 RIR.

/** Load change per RIR step, by rep count — flatter at high reps. */
function rirCoefficient(reps: number): number {
  if (reps <= 5) return 0.035
  if (reps <= 12) return 0.03
  if (reps <= 20) return 0.025
  return 0.02
}

/** Effort of an anchor set in RIR. Logged RPE wins (RIR = 10 − RPE); a
 * meso session falls back to what that week actually prescribed; anything
 * else assumes 1 — logged top sets are hard but rarely true grinders, and
 * lifters under-report reps-in-reserve anyway (Halperin 2022). */
function anchorRir(
  m: Mesocycle,
  anchor: { rpe?: number },
  anchorWorkout: Workout | null,
  compound: boolean,
): number {
  if (anchor.rpe != null && Number.isFinite(anchor.rpe)) {
    return Math.max(0, Math.min(5, 10 - anchor.rpe))
  }
  if (anchorWorkout?.mesoId === m.id) {
    const wk = mesoWeek(m, new Date(anchorWorkout.start).getTime())
    if (wk < m.weeks - 1) return targetRir(wk, m.weeks - 1, compound)
  }
  return 1
}

/** Sessions of a lift to consider when anchoring from history — wide
 * enough to look past a deload week, narrow enough to stay current. */
const HISTORY_ANCHOR_LOOKBACK = 3

/** A completed block carries a little forward across the boundary, so the
 * new block's opening load isn't the exact mirror of the ramp just run. */
const CROSS_BLOCK_CARRY = 1.02

/** Cap a single re-base: never more than 12% down or 5% up. */
const RIR_MAX_CUT = 0.88
const RIR_MAX_RAISE = 1.05

/** Re-base an anchor load from its effort level to the session's target
 * RIR, snapped to a real plate step without ever exceeding the rails. */
function rebaseForRir(
  weight: number,
  reps: number,
  anchorRirValue: number,
  targetRirValue: number,
  compound: boolean,
  missedReps: boolean,
  carryOver = 1,
): number {
  const c = rirCoefficient(reps)
  let mult = Math.pow(1 + c, anchorRirValue - targetRirValue) * carryOver
  // A session that fell short of its reps never earns a heavier load
  if (missedReps) mult = Math.min(mult, 1)
  mult = Math.max(RIR_MAX_CUT, Math.min(RIR_MAX_RAISE, mult))

  // Step comes from the ANCHOR, not the corrected value — otherwise a
  // cut across the 25 lb line silently changes granularity mid-correction.
  const step = weight >= 25 ? 5 : 2.5
  // Nearest step: a 3% intended correction must not cost a whole plate.
  let rounded = Math.round((weight * mult) / step) * step

  // Re-apply the rails in STEP space. Clamping the multiplier alone lets
  // rounding overshoot it — a 32.5 lb accessory could land 23% down off
  // an 8.5% intent, and a raise could clear the +5% cap.
  // Each rail binds only in its OWN direction: on light anchors the two
  // bounds cross over (a 7 lb dumbbell yields lo 7.5 > hi 5), and applying
  // the raise ceiling to a cut dragged it far past the floor.
  if (mult < 1) {
    const lo = Math.ceil((weight * RIR_MAX_CUT) / step) * step
    rounded = Math.min(Math.max(rounded, lo), weight)
  } else if (mult > 1) {
    const hi = Math.floor((weight * RIR_MAX_RAISE) / step) * step
    rounded = Math.max(Math.min(rounded, hi), weight)
  }

  // The bar floor is a "can't go under an empty bar" guard, not a minimum
  // prescription — these names are also logged with dumbbells and machines,
  // so it only applies once the anchor is already at or above bar weight.
  const floor = compound && weight >= 45 ? 45 : step
  return Math.max(floor, rounded)
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

  // One muscle resolver for ramp, feedback, and cap alike: the day's own
  // muscle tag (slot rows) wins, the global lookup fills in the rest —
  // keying these differently let unknown names dodge the session cap.
  const dayMuscle = new Map<string, string>()
  for (const e of day.exercises) {
    if (e.muscle !== undefined) dayMuscle.set(e.name.toLowerCase(), e.muscle)
  }
  const resolve = (name: string) =>
    dayMuscle.get(name.toLowerCase()) ?? lookup(name)

  // What this day authors per muscle, against the block's weekly picture.
  const daySets = new Map<string, number>()
  for (const e of day.exercises) {
    const muscle = resolve(e.name)
    if (muscle !== undefined) {
      daySets.set(muscle, (daySets.get(muscle) ?? 0) + e.setCount)
    }
  }
  const plan = weeklyPlan(m, lookup)

  // The ramp is per MUSCLE, not per exercise — two quad lifts must not
  // silently double the weekly ramp — and it SPREADS across that muscle's
  // lifts, compound first. Piling the whole ramp on one exercise is how a
  // 2-set bench became a 4-set bench while the muscle only gained two
  // weekly sets: the dose that matters is the muscle's, but the number the
  // athlete reads is the lift's.
  let entries = day.exercises.map((e) => ({
    name: e.name,
    setCount: e.setCount,
  }))
  const byMuscle = new Map<string, number[]>()
  entries.forEach((e, i) => {
    const muscle = resolve(e.name)
    if (muscle === undefined) return
    byMuscle.set(muscle, [...(byMuscle.get(muscle) ?? []), i])
  })
  for (const [muscle, idx] of byMuscle) {
    const here = daySets.get(muscle) ?? 0
    const ramp = deload
      ? 0
      : rampAt(
          m,
          week,
          rampBudget(
            m,
            muscle,
            plan.sets.get(muscle) ?? here,
            plan.days.get(muscle) ?? 1,
            here,
          ),
        )
    for (let k = 0; k < ramp; k++) entries[idx[k % idx.length]].setCount += 1
  }

  if (!deload) {
    // In-meso autoregulation: the same feedback engine, scoped to this
    // meso's sessions only, nudges the planned ramp up or down. In the
    // frozen final week only downward corrections still apply.
    // The ramp itself already freezes (rampWeeks caps at weeks-3), so the
    // feedback delta carries unchanged — zeroing it here dropped the final
    // hard week back to the template base, making the peak week the
    // LOWEST-volume week of the block.
    const recs = recommendations(mesoWorkouts, resolve, nowMs)
    entries = applyRecommendations(entries, cutsOnly(recs), resolve)
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

// ---- prebuilt mesocycle templates (wizard starting points) ----
// Every exercise name is from the built-in EXERCISES list, so muscle
// resolution works without registering customs. Everything a template
// prefills stays editable in the wizard.
//
// Focus muscles START AT MEV with room left under the 8-set session cap,
// because that is the only way the block's ramp (§6a) has anywhere to go.
// These used to open at 10 sets per session for the focus muscle — already
// past the cap — so the cap silently binned two sets, the ramp's budget
// was zero, and a "Chest block" ran the same chest volume for five weeks.

export interface MesoTemplate {
  id: string
  name: string
  blurb: string
  weeks: number
  focus: string[]
  days: MesoDay[]
}

/** 5:00 warm + n×(work/rest) + 5:00 cool — rowing/bike style intervals. */
function cardioIntervals(
  workSec: number,
  restSec: number,
  rounds: number,
): IntervalSection[] {
  const out: IntervalSection[] = [{ label: 'Warm up', durationSec: 300 }]
  for (let i = 0; i < rounds; i++) {
    if (i > 0) out.push({ label: 'Rest', durationSec: restSec })
    out.push({ label: 'Work', durationSec: workSec })
  }
  out.push({ label: 'Cool down', durationSec: 300 })
  return out
}

export const MESO_TEMPLATES: MesoTemplate[] = [
  {
    id: 'leg-focus',
    name: 'Leg block',
    blurb: 'Quads and hamstrings',
    weeks: 5,
    focus: ['quads', 'hamstrings'],
    days: [
      {
        label: 'Lower A',
        weekday: 0,
        exercises: [
          { name: 'Back squat', setCount: 3 },
          { name: 'Romanian deadlift', setCount: 3 },
          { name: 'Leg press', setCount: 2 },
          { name: 'Calf raise', setCount: 3 },
        ],
      },
      {
        label: 'Upper',
        weekday: 2,
        exercises: [
          { name: 'Bench press', setCount: 3 },
          { name: 'Barbell row', setCount: 3 },
          { name: 'Overhead press', setCount: 3 },
          { name: 'Dumbbell curl', setCount: 2 },
        ],
      },
      {
        label: 'Engine',
        weekday: 3,
        kind: 'cardio',
        exercises: [],
        sections: cardioIntervals(60, 60, 6),
      },
      {
        label: 'Lower B',
        weekday: 4,
        exercises: [
          { name: 'Hack squat', setCount: 3 },
          { name: 'Leg curl', setCount: 3 },
          { name: 'Walking lunge', setCount: 2 },
          { name: 'Seated calf raise', setCount: 3 },
        ],
      },
    ],
  },
  {
    id: 'chest-focus',
    name: 'Chest block',
    blurb: 'Two pressing days',
    weeks: 5,
    focus: ['chest'],
    days: [
      {
        label: 'Push A',
        weekday: 0,
        exercises: [
          { name: 'Bench press', setCount: 2 },
          { name: 'Incline dumbbell press', setCount: 2 },
          { name: 'Cable fly', setCount: 2 },
          { name: 'Triceps pushdown', setCount: 2 },
        ],
      },
      {
        label: 'Pull',
        weekday: 1,
        exercises: [
          { name: 'Barbell row', setCount: 3 },
          { name: 'Lat pulldown', setCount: 3 },
          { name: 'Rear delt fly', setCount: 2 },
          { name: 'Dumbbell curl', setCount: 2 },
        ],
      },
      {
        label: 'Push B',
        weekday: 3,
        exercises: [
          { name: 'Incline bench press', setCount: 2 },
          { name: 'Dips', setCount: 2 },
          { name: 'Pec deck', setCount: 2 },
          { name: 'Lateral raise', setCount: 2 },
        ],
      },
      {
        label: 'Legs',
        weekday: 5,
        exercises: [
          { name: 'Back squat', setCount: 3 },
          { name: 'Romanian deadlift', setCount: 3 },
          { name: 'Leg press', setCount: 2 },
        ],
      },
    ],
  },
  {
    id: 'back-focus',
    name: 'Back block',
    blurb: 'Rowing and pulling',
    weeks: 5,
    focus: ['back'],
    days: [
      {
        label: 'Pull A',
        weekday: 0,
        exercises: [
          { name: 'Deadlift', setCount: 3 },
          { name: 'Barbell row', setCount: 3 },
          { name: 'Lat pulldown', setCount: 2 },
          { name: 'Face pull', setCount: 2 },
        ],
      },
      {
        label: 'Push',
        weekday: 2,
        exercises: [
          { name: 'Bench press', setCount: 3 },
          { name: 'Overhead press', setCount: 3 },
          { name: 'Triceps pushdown', setCount: 2 },
        ],
      },
      {
        label: 'Pull B',
        weekday: 4,
        exercises: [
          { name: 'Pull-up', setCount: 2 },
          { name: 'Seated cable row', setCount: 2 },
          { name: 'Straight-arm pulldown', setCount: 2 },
          { name: 'Hammer curl', setCount: 2 },
        ],
      },
      {
        label: 'Legs',
        weekday: 5,
        exercises: [
          { name: 'Back squat', setCount: 3 },
          { name: 'Leg curl', setCount: 3 },
          { name: 'Calf raise', setCount: 2 },
        ],
      },
    ],
  },
  {
    id: 'ppl-engine',
    name: 'PPL + engine',
    blurb: 'Push, pull, legs, engine',
    weeks: 4,
    focus: [],
    days: [
      {
        label: 'Push',
        weekday: 0,
        exercises: [
          { name: 'Bench press', setCount: 3 },
          { name: 'Overhead press', setCount: 3 },
          { name: 'Cable fly', setCount: 2 },
          { name: 'Triceps pushdown', setCount: 2 },
        ],
      },
      {
        label: 'Pull',
        weekday: 2,
        exercises: [
          { name: 'Barbell row', setCount: 3 },
          { name: 'Lat pulldown', setCount: 3 },
          { name: 'Face pull', setCount: 2 },
          { name: 'Dumbbell curl', setCount: 2 },
        ],
      },
      {
        label: 'Morning row',
        weekday: 4,
        kind: 'cardio',
        exercises: [],
        sections: cardioIntervals(90, 60, 5),
      },
      {
        label: 'Legs',
        weekday: 4,
        exercises: [
          { name: 'Back squat', setCount: 4 },
          { name: 'Romanian deadlift', setCount: 3 },
          { name: 'Leg press', setCount: 3 },
          { name: 'Calf raise', setCount: 2 },
        ],
      },
    ],
  },
]

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
  /** Which microcycle day this session is — the same lift on two
   * different days is two separate slots and must not cross-anchor. */
  slotDayIndex?: number,
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
    let anchor: { weight?: number; reps?: number; rpe?: number } | null = null
    let anchorWorkout: Workout | null = null
    // Pass 0 looks only at THIS microcycle day, pass 1 at the rest of the
    // meso. Pull-ups on Monday and on Thursday progress independently.
    for (const pass of [0, 1]) {
      for (const w of mesoWorkouts) {
        if (deload && dayIndex(w.start) >= deloadStartDay) continue
        if (
          pass === 0 &&
          (slotDayIndex == null || w.mesoDayIndex !== slotDayIndex)
        ) {
          continue
        }
        const t = topSet(w, name)
        if (t?.weight != null) {
          anchor = t
          anchorWorkout = w
          break
        }
      }
      if (anchor) break
    }
    if (!anchor) {
      // Falling back to history: take the HEAVIEST top set among the last
      // few sessions of this lift, not strictly the newest. A brand-new
      // block otherwise anchors to the previous block's deload week — a
      // deliberately light session — and then gets re-based lighter still.
      const recent: Array<{
        t: { weight?: number; reps?: number; rpe?: number }
        w: Workout
      }> = []
      for (const w of allWorkouts) {
        if (w.kind !== 'strength') continue
        // Same deload guard the in-meso scan uses
        if (deload && w.mesoId === m.id && dayIndex(w.start) >= deloadStartDay) {
          continue
        }
        const t = topSet(w, name)
        if (t?.weight != null) {
          recent.push({ t, w })
          if (recent.length >= HISTORY_ANCHOR_LOOKBACK) break
        }
      }
      for (const r of recent) {
        if (!anchor || (r.t.weight ?? 0) > (anchor.weight ?? 0)) {
          anchor = r.t
          // Carry the source session too, or double progression is
          // unreachable in week 1 and every block boundary claws back
          // the reps the lifter earned above the window top.
          anchorWorkout = r.w
        }
      }
    }
    // The anchor session's per-set shape, captured before the bodyweight
    // override below drops the source workout: 12/10/8 progresses to
    // 13/11/9, not to three sets of 13.
    const anchorSetReps = anchorWorkout ? setReps(anchorWorkout, name) : []

    // Bodyweight moves pin to TODAY's measured mass (the app-wide
    // invariant) and progress by reps only — you can't add 5 lb to
    // yourself, and a deload can't take 10% off you either.
    if (bw && bodyWeightLb !== undefined) {
      anchor = {
        weight: Math.round(bodyWeightLb),
        reps: anchor?.reps,
        rpe: anchor?.rpe,
      }
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
      const deloadFloor = compound && anchor.weight >= 45 ? 45 : step
      const weight = bw
        ? anchor.weight
        : Math.max(deloadFloor, Math.round(raw / step) * step)
      const halve = (r: number) =>
        Math.max(3, Math.round(r * DELOAD_REP_FACTOR))
      const reps = halve(anchor.reps ?? high)
      const repsPlan = mapReps(halve, anchorSetReps, sets, reps)
      out[name] = {
        weight,
        targetReps: reps,
        targetRepsBySet: repsPlan,
        repLow: low,
        repHigh: high,
        sets,
        rir,
        note: `deload · ${repText(repsPlan, sets)} @ ${weight} lb, stop far from failure`,
      }
      continue
    }

    // Step 1 — re-base the anchor to this session's effort target. Last
    // block's final set was ground out near failure; week 1 asks for 3
    // RIR, and the same bar weight is a different session. Bodyweight
    // moves have no load to re-base.
    const anchorReps = anchor.reps ?? low
    const missedReps = anchor.reps != null && anchor.reps < low
    const aRir =
      rir == null ? 0 : anchorRir(m, anchor, anchorWorkout, compound)
    const deltaRir = rir == null ? 0 : aRir - rir
    // Crossing a block boundary, the downward re-base mirrors the ramp the
    // lifter just climbed, so a block would net zero. A completed block
    // earns a small carry-over (PROGRESSION.md §7, research case ii).
    const crossBlock = !anchorWorkout || anchorWorkout.mesoId !== m.id
    const carryOver = crossBlock && !missedReps ? CROSS_BLOCK_CARRY : 1
    const based =
      bw || rir == null || deltaRir === 0
        ? anchor.weight
        : rebaseForRir(
            anchor.weight,
            anchorReps,
            aRir,
            rir,
            compound,
            missedReps,
            carryOver,
          )

    // Step 2 — progress on ONE axis. When the effort target moved, that
    // ramp IS this week's progression: hold the reps and let the re-based
    // load do the work, or the lifter eats two jumps at once.
    //
    // …but only if the load ACTUALLY moved. On light lifts a 3% correction
    // is smaller than the nearest plate, so the re-base holds — and
    // suppressing reps on top of that leaves an accessory completely flat
    // for the whole block. A no-op re-base spends no axis, so reps run.
    const loadMoved = based !== anchor.weight
    // Reps that have run well past the window top mean the plate step the
    // engine keeps refusing as too coarse is now the only sane move — a
    // 30 lb lateral raise for 39 reps is not the lift anyone intended.
    const runaway = !bw && anchor.reps != null && anchor.reps >= high + 3

    // Each branch picks a rep RULE, not one number, and that rule then runs
    // over every set the athlete actually did. A 12/10 session earns 13/11:
    // flattening it to 13/13 quietly asks for three extra reps on the back
    // set and turns a descending session into a rectangle.
    const capped = (r: number) => Math.min(r + 1, high)
    const plusOne = (r: number) => r + 1
    const reset = () => low
    // No floor at the window bottom: a back-off set that only made 8 on a
    // 10-20 window must not be asked for 10 in the same breath as a heavier
    // load. Repeat what it did; the window's top still caps it.
    const hold = (r: number) => Math.min(r, high)

    let weight = based
    let rule: (r: number) => number
    if (runaway) {
      weight = increment(lookup(name), based, true) ?? based
      rule = reset
    } else if (deltaRir !== 0 && !bw && loadMoved) {
      rule = hold
    } else if (deltaRir !== 0 && !bw) {
      // Re-base was a no-op (correction smaller than the nearest plate).
      // Chase a rep — never a plate bump, which would jump the load the
      // opposite way from the correction the engine just computed.
      rule = plusOne
    } else if (
      anchorWorkout &&
      anchor.reps != null &&
      anchor.reps >= high &&
      allSetsAtTop(anchorWorkout, name, high)
    ) {
      // Double progression: window topped out on every set -> raise the
      // load and reset reps. A null increment means the smallest jump is
      // too coarse for this lift — keep the weight, keep adding reps.
      const bumped = increment(lookup(name), based)
      if (bumped !== null) {
        weight = bumped
        rule = reset
      } else {
        rule = plusOne
      }
    } else if (bw && anchor.reps != null && anchor.reps >= high) {
      rule = plusOne // no plates to add to yourself — keep repping
    } else {
      rule = capped
    }
    const basis = anchor.reps ?? low
    const target = Math.max(1, rule(basis))
    const targets = repsBySet(target, basis, low, anchorSetReps, sets)
    out[name] = {
      weight,
      targetReps: target,
      targetRepsBySet: targets,
      repLow: low,
      repHigh: high,
      sets,
      rir,
      // Say WHY a load dropped — opening a block lighter than last
      // block's near-failure sets is the RIR re-base, not a glitch.
      note:
        weight < anchor.weight
          ? `${repText(targets, sets)} @ ${weight} lb · ${rir} RIR · eased from ${anchor.weight}`
          : `${repText(targets, sets)} @ ${weight} lb · ${rir} RIR`,
    }
  }
  return out
}

/**
 * How many sets a lift the athlete adds MID-BLOCK should start with — what
 * the plan would have given it had it been in the template all along: its
 * own last set count (this block first, then any history, then three),
 * plus this week's ramp when it lands on a focus muscle.
 *
 * Swapping a machine press for cable raises in week 3 of a shoulder block
 * should inherit the block's shoulder volume rather than restart at the
 * template base; a non-focus swap simply repeats what it did last time.
 */
export function plannedSetsForExercise(
  m: Mesocycle,
  name: string,
  week: number,
  mesoWorkouts: Workout[],
  allWorkouts: Workout[],
  muscle: string | undefined,
  lookup: (name: string) => string | undefined,
  /** Sets this session already spends on the same muscle. */
  usedByMuscle = 0,
): number {
  const countIn = (w: Workout): number => {
    const ex = w.exercises.find(
      (e) => e.name.toLowerCase() === name.toLowerCase(),
    )
    return ex ? ex.sets.length : 0
  }
  let base = 0
  let sourceWeek: number | null = null
  for (const w of mesoWorkouts) {
    const n = countIn(w)
    if (n > 0) {
      base = n
      sourceWeek = mesoWeek(m, new Date(w.start).getTime())
      break
    }
  }
  if (base === 0) {
    for (const w of allWorkouts) {
      const n = countIn(w)
      if (n > 0) {
        base = n
        break
      }
    }
  }
  if (base === 0) base = 3

  if (isDeloadWeek(m, week)) {
    return Math.max(1, Math.round(base * DELOAD_SET_FACTOR))
  }
  // A count taken from an earlier week of THIS block already carries that
  // week's ramp — add only the difference, or the swap inherits it twice.
  // Same budget the planned lifts ramp under, so a swap can't outrun them.
  const plan = weeklyPlan(m, lookup)
  const budget =
    muscle === undefined
      ? 0
      : rampBudget(
          m,
          muscle,
          plan.sets.get(muscle) ?? base,
          plan.days.get(muscle) ?? 1,
          usedByMuscle + base,
        )
  const ramp =
    rampAt(m, week, budget) -
    (sourceWeek == null ? 0 : rampAt(m, sourceWeek, budget))
  // The athlete asked for this lift, so it always gets at least one set:
  // the per-muscle session cap trims it, it never deletes it.
  return Math.max(1, Math.min(base + ramp, SESSION_SET_CAP - usedByMuscle))
}
