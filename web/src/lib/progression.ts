// RP-style auto-progression: end-of-session feedback (how hard / how much
// volume, per muscle group) plus rolling weekly set counts drive what the
// next session should do — add a set, push the load, hold, or back off.
//
// Volume landmarks are weekly working-set counts per muscle group
// (MV = maintenance, MEV = minimum effective, MAV = maximum adaptive
// range top, MRV = maximum recoverable), based on Renaissance
// Periodization's published hypertrophy guides (Israetel) and the
// set-volume dose-response literature (Schoenfeld/Ogborn/Krieger 2017;
// Baz-Valle 2022). Numbers are conservative intermediate defaults.

import type { Workout, WorkoutFeedback } from './workouts'

export interface VolumeLandmarks {
  mv: number
  mev: number
  mavHi: number
  mrv: number
}

// Numbers reconciled in PROGRESSION.md (classic RP table cross-checked
// against Baz-Valle 2022 and per-session dose research, disagreements
// resolved conservatively — e.g. biceps MRV 20 not 26, abs MAV 12).
export const VOLUME_LANDMARKS: Record<string, VolumeLandmarks> = {
  chest: { mv: 4, mev: 6, mavHi: 20, mrv: 22 },
  back: { mv: 8, mev: 10, mavHi: 22, mrv: 25 },
  shoulders: { mv: 4, mev: 8, mavHi: 20, mrv: 22 },
  'rear delts': { mv: 0, mev: 6, mavHi: 16, mrv: 20 },
  traps: { mv: 0, mev: 4, mavHi: 16, mrv: 20 },
  biceps: { mv: 5, mev: 8, mavHi: 18, mrv: 20 },
  triceps: { mv: 4, mev: 6, mavHi: 14, mrv: 18 },
  quads: { mv: 6, mev: 8, mavHi: 18, mrv: 20 },
  hamstrings: { mv: 4, mev: 6, mavHi: 16, mrv: 20 },
  'posterior chain': { mv: 4, mev: 6, mavHi: 16, mrv: 20 },
  glutes: { mv: 0, mev: 0, mavHi: 12, mrv: 16 },
  calves: { mv: 6, mev: 8, mavHi: 16, mrv: 20 },
  core: { mv: 0, mev: 0, mavHi: 12, mrv: 20 },
}

/** Muscles without research numbers (full body, other, customs). */
const DEFAULT_LANDMARKS: VolumeLandmarks = { mv: 0, mev: 0, mavHi: 12, mrv: 16 }

/** Muscle tags that aren't hypertrophy targets — no coaching for these. */
const EXCLUDED = new Set(['speed', 'power'])

/**
 * Per-session ceiling: ~8 direct sets per muscle per session is where the
 * dose-response evidence flattens (Krieger; RP ends mesocycles near this),
 * so recommendations never push a session beyond it.
 */
export const SESSION_SET_CAP = 8

export function landmarksFor(muscle: string): VolumeLandmarks {
  return VOLUME_LANDMARKS[muscle] ?? DEFAULT_LANDMARKS
}

export interface Recommendation {
  muscle: string
  /** Sets to add/remove for this muscle next session. */
  setDelta: -2 | -1 | 0 | 1 | 2
  load: 'add_weight' | 'add_reps' | 'hold' | 'reduce'
  /** Short imperative headline, e.g. "add a set, push the weight up". */
  summary: string
  /** Why — feedback and volume position, e.g. "felt easy · 9 wk sets". */
  reason: string
  weeklySets: number
  landmarks: VolumeLandmarks
  /** Set when repeated hard/high feedback suggests backing off a week. */
  deload: boolean
}

/** Muscle groups (in exercise order) with at least one checked-off set. */
export function feedbackMuscles(
  w: Workout,
  lookup: (name: string) => string | undefined,
): string[] {
  const out: string[] = []
  for (const e of w.exercises) {
    if (!e.sets.some((s) => s.done)) continue
    const muscle = lookup(e.name)
    if (muscle && !EXCLUDED.has(muscle) && !out.includes(muscle)) {
      out.push(muscle)
    }
  }
  return out
}

/** Completed working sets per muscle over the trailing 7 days. */
export function weeklySetsByMuscle(
  workouts: Workout[],
  lookup: (name: string) => string | undefined,
  nowMs: number,
): Record<string, number> {
  const from = new Date(nowMs - 7 * 86_400_000).toISOString()
  const counts: Record<string, number> = {}
  for (const w of workouts) {
    if (w.kind !== 'strength' || w.start < from) continue
    for (const e of w.exercises) {
      const muscle = lookup(e.name)
      if (!muscle || EXCLUDED.has(muscle)) continue
      counts[muscle] = (counts[muscle] ?? 0) + e.sets.length
    }
  }
  return counts
}

const LOAD_TEXT: Record<Recommendation['load'], string> = {
  add_weight: 'push the weight up',
  add_reps: 'same weight, add a rep',
  hold: 'repeat the same load',
  reduce: 'drop the load a touch',
}

function setText(delta: number): string {
  if (delta >= 2) return 'add two sets'
  if (delta === 1) return 'add a set'
  if (delta === -1) return 'drop a set'
  if (delta <= -2) return 'drop two sets'
  return 'keep the sets'
}

/**
 * The feedback decision table (PROGRESSION.md §3): the volume answer
 * steers SETS, the difficulty answer steers LOAD — effort is never a
 * reason to add sets. One deliberate divergence from the RP-derived
 * table: too hard + just enough keeps its sets and chases a rep at the
 * same weight (the owner's requested rule) instead of dropping a set.
 */
function fromFeedback(fb: {
  difficulty: 'easy' | 'right' | 'hard'
  volume: 'low' | 'right' | 'high'
}): {
  setDelta: -2 | -1 | 0 | 1 | 2
  load: Recommendation['load']
  felt: string
} {
  const { difficulty: d, volume: v } = fb
  const felt =
    `felt ${d === 'easy' ? 'too easy' : d === 'hard' ? 'too hard' : 'right'}` +
    `, volume ${v === 'low' ? 'too little' : v === 'high' ? 'too much' : 'right'}`
  if (d === 'easy') {
    if (v === 'low') return { setDelta: 2, load: 'add_weight', felt }
    if (v === 'right') return { setDelta: 1, load: 'add_weight', felt }
    // Contradictory combo: trust "too much" for sets, "too easy" for load
    return { setDelta: -1, load: 'add_weight', felt }
  }
  if (d === 'right') {
    if (v === 'low') return { setDelta: 1, load: 'add_reps', felt }
    if (v === 'right') return { setDelta: 0, load: 'add_reps', felt }
    return { setDelta: -1, load: 'hold', felt } // consolidate
  }
  // too hard — never add sets while recovery is poor
  if (v === 'low') return { setDelta: 0, load: 'hold', felt }
  if (v === 'right') return { setDelta: 0, load: 'add_reps', felt }
  return { setDelta: -2, load: 'reduce', felt } // hard + too much: back off
}

/**
 * Next-session guidance per muscle group, from the most recent feedback
 * (last 35 days) clamped by where weekly volume sits against the
 * landmarks. Muscles trained recently but never rated still get
 * volume-only guidance, so the coach is useful before any feedback exists.
 */
export function recommendations(
  workouts: Workout[],
  lookup: (name: string) => string | undefined,
  nowMs: number = Date.now(),
): Record<string, Recommendation> {
  const weekly = weeklySetsByMuscle(workouts, lookup, nowMs)
  const horizon = new Date(nowMs - 35 * 86_400_000).toISOString()

  // Latest feedback per muscle, plus the one before it (deload detection).
  const latest: Record<string, WorkoutFeedback['muscles'][string][]> = {}
  const seen = new Set<string>()
  for (const w of workouts) {
    // workouts arrive sorted newest-first
    if (w.kind !== 'strength' || w.start < horizon) continue
    for (const e of w.exercises) {
      const muscle = lookup(e.name)
      if (muscle && !EXCLUDED.has(muscle)) seen.add(muscle)
    }
    if (!w.feedback) continue
    for (const [muscle, fb] of Object.entries(w.feedback.muscles)) {
      const list = (latest[muscle] ??= [])
      if (list.length < 2) list.push(fb)
    }
  }

  const out: Record<string, Recommendation> = {}
  for (const muscle of seen) {
    const marks = landmarksFor(muscle)
    const wk = weekly[muscle] ?? 0
    const history = latest[muscle] ?? []
    const fb = history[0]

    let setDelta: Recommendation['setDelta']
    let load: Recommendation['load']
    let why: string
    let deload = false

    if (fb) {
      const t = fromFeedback(fb)
      setDelta = t.setDelta
      load = t.load
      why = t.felt
      deload =
        history.length >= 2 &&
        history.every((h) => h.difficulty === 'hard' && h.volume === 'high')
    } else {
      // No ratings yet: steer by volume position alone.
      setDelta = wk > 0 && wk < marks.mev ? 1 : 0
      load = 'add_reps'
      why = 'no rating yet'
    }

    // Volume rails (PROGRESSION.md §5): stay within [MV, MRV]. Deltas
    // truncate to the distance to the rail — an all-or-nothing check
    // would let ±2 sail one set past either landmark.
    if (setDelta > 0) {
      const room = Math.max(0, marks.mrv - wk)
      if (setDelta > room) {
        setDelta = room as Recommendation['setDelta']
        if (room === 0) {
          load = fb ? load : 'add_reps'
          why += ' · at weekly max'
        }
      }
    } else if (setDelta < 0) {
      setDelta = Math.max(
        setDelta,
        Math.min(0, marks.mv - wk),
      ) as Recommendation['setDelta']
    }
    // Sitting at the recoverable ceiling while calling it hard = deload cue
    if (fb?.difficulty === 'hard' && wk >= marks.mrv) deload = true

    out[muscle] = {
      muscle,
      setDelta,
      load,
      summary: deload
        ? 'take a light week — trim sets and load'
        : `${setText(setDelta)}, ${LOAD_TEXT[load]}`,
      reason: `${why} · ${wk} sets this week (guide ${marks.mev}–${marks.mrv})`,
      weeklySets: wk,
      landmarks: marks,
      deload,
    }
  }
  return out
}

/**
 * Apply set deltas to a template's exercise list: an added set goes to the
 * FIRST exercise of the muscle, a dropped one comes off the LAST (never
 * below 1), and a session never exceeds SESSION_SET_CAP sets per muscle.
 */
export function applyRecommendations(
  entries: Array<{ name: string; setCount: number }>,
  recs: Record<string, Recommendation>,
  lookup: (name: string) => string | undefined,
): Array<{ name: string; setCount: number }> {
  const result = entries.map((e) => ({ ...e }))
  const byMuscle = new Map<string, number[]>()
  result.forEach((e, i) => {
    const muscle = lookup(e.name)
    if (!muscle) return
    const list = byMuscle.get(muscle) ?? []
    list.push(i)
    byMuscle.set(muscle, list)
  })

  for (const [muscle, indices] of byMuscle) {
    const rec = recs[muscle]
    if (!rec) continue
    const sessionSets = indices.reduce((n, i) => n + result[i].setCount, 0)
    // A deload trims at LEAST one set — never less than the table delta
    // (the escalation trigger must not de-escalate the correction).
    let delta: number = rec.deload ? Math.min(-1, rec.setDelta) : rec.setDelta
    if (delta > 0) {
      delta = Math.min(delta, Math.max(0, SESSION_SET_CAP - sessionSets))
      if (delta > 0) result[indices[0]].setCount += delta
    } else if (delta < 0) {
      for (let k = indices.length - 1; k >= 0 && delta < 0; k--) {
        const e = result[indices[k]]
        const take = Math.min(e.setCount - 1, -delta)
        e.setCount -= take
        delta += take
      }
    }
  }
  return result
}
