// Routine generator: the muscles a session trains → a warm-up or cooldown
// built from the stretch catalog. Coverage-first (every trained region
// gets at least one stretch), then fills the time budget by overlap. A
// day-keyed seed varies ties so the same session doesn't always produce
// the same list, while staying stable within a day.

import { STRETCHES, type Stretch } from './stretches'
import type { Routine } from './routines'
import type { RoutineItem } from './templates'

/** Session muscle groups (makeMuscleLookup vocabulary) → stretch targets. */
const ALIASES: Record<string, string[]> = {
  chest: ['chest', 'shoulders'],
  back: ['back', 'shoulders'],
  shoulders: ['shoulders', 'chest', 'rear delts'],
  'rear delts': ['rear delts', 'shoulders'],
  traps: ['traps', 'neck', 'shoulders'],
  biceps: ['forearms', 'chest'],
  triceps: ['triceps', 'shoulders'],
  quads: ['quads', 'hip flexors'],
  hamstrings: ['hamstrings', 'glutes'],
  glutes: ['glutes', 'hip flexors', 'adductors'],
  'posterior chain': ['hamstrings', 'glutes', 'back'],
  calves: ['calves'],
  core: ['core', 'back'],
  'full body': ['hamstrings', 'glutes', 'quads', 'back', 'shoulders', 'chest'],
}

export function expandTargets(muscles: string[]): string[] {
  const out: string[] = []
  for (const m of muscles) {
    for (const t of ALIASES[m.toLowerCase()] ?? []) {
      if (!out.includes(t)) out.push(t)
    }
  }
  return out
}

/** mulberry32 — same tiny PRNG the demo uses; seeded per day by default. */
function rng(seed: number): () => number {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Time budget that grows with how much of the body a session trains: a
 * two-group day gets the short version, a full-body day gets long enough
 * to actually cover it (still short enough to be done every time).
 */
export function suggestedMinutes(muscles: string[], phase: 'pre' | 'post'): number {
  const n = new Set(muscles.map((m) => m.toLowerCase())).size
  return phase === 'pre'
    ? Math.min(8, Math.max(5, Math.round(4 + n * 0.6)))
    : Math.min(10, Math.max(6, Math.round(5 + n * 0.8)))
}

export function isFullBody(muscles: string[]): boolean {
  const set = new Set(muscles.map((m) => m.toLowerCase()))
  const lower = ['quads', 'hamstrings', 'glutes', 'posterior chain', 'calves']
  const upper = ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'rear delts', 'traps']
  return (
    set.has('full body') ||
    (lower.some((m) => set.has(m)) && upper.some((m) => set.has(m)))
  )
}

export interface GenerateOptions {
  /** Muscle groups the session trains, as resolved by the exercise lookup. */
  muscles: string[]
  phase: 'pre' | 'post'
  /** Wall-clock budget including lead-ins and side swaps. */
  minutes: number
  seed?: number
}

function holdSeconds(s: Stretch, phase: 'pre' | 'post'): number {
  if (phase === 'pre') {
    // Dynamic drills run their default; static holds stay short before
    // lifting (≤60 s per muscle is the consensus ceiling, 30 s is plenty).
    return s.type === 'static' ? Math.min(s.defaultSec, 30) : s.defaultSec
  }
  return Math.min(60, Math.max(30, s.defaultSec))
}

function itemCost(item: RoutineItem, transitionSec: number): number {
  const swap = item.perSide ? Math.max(3, transitionSec) : 0
  return item.seconds * (item.perSide ? 2 : 1) + transitionSec + swap
}

/**
 * Returns null when nothing in the catalog targets the given muscles
 * (e.g. every exercise was an unknown custom), so callers can hide the
 * offer instead of showing an empty routine.
 */
export function generateRoutine(opts: GenerateOptions): Routine | null {
  const targets = expandTargets(opts.muscles)
  if (targets.length === 0) return null
  const phase = opts.phase
  const transitionSec = phase === 'pre' ? 5 : 8
  const budget = Math.max(60, Math.round(opts.minutes * 60))
  const rand = rng(opts.seed ?? Math.floor(Date.now() / 86_400_000))

  const scored = STRETCHES.filter(
    (s) =>
      (s.phase.includes(phase) || s.phase.includes('any')) &&
      (phase === 'post' || s.type !== 'breath') &&
      s.targets.some((t) => targets.includes(t)),
  ).map((s) => ({ s, score: s.targets.filter((t) => targets.includes(t)).length, r: rand() }))

  const picked: RoutineItem[] = []
  const covered = new Set<string>()
  let total = 0
  const remaining = [...scored]

  const take = (i: number) => {
    const { s } = remaining.splice(i, 1)[0]
    const item: RoutineItem = {
      name: s.name,
      seconds: holdSeconds(s, phase),
      ...(s.perSide && { perSide: true }),
    }
    picked.push(item)
    total += itemCost(item, transitionSec)
    for (const t of s.targets) covered.add(t)
  }

  // Coverage pass: the stretch that reaches the most still-uncovered
  // targets PER SECOND wins — on a full-body day that favours compound
  // stretches (world's greatest, inchworm, deep squat) over five per-side
  // singles that would blow the budget. Ties break on raw gain, total
  // overlap, then the daily shuffle.
  while (remaining.length > 0 && targets.some((t) => !covered.has(t))) {
    let best = -1
    let bestKey: [number, number, number, number] = [-1, -1, -1, -1]
    remaining.forEach(({ s, score, r }, i) => {
      const gain = s.targets.filter((t) => targets.includes(t) && !covered.has(t)).length
      if (gain === 0) return
      const cost = itemCost(
        { name: '', seconds: holdSeconds(s, phase), perSide: s.perSide },
        transitionSec,
      )
      const key: [number, number, number, number] = [gain / cost, gain, score, r]
      for (let k = 0; k < 4; k++) {
        if (key[k] > bestKey[k]) {
          best = i
          bestKey = key
          break
        }
        if (key[k] < bestKey[k]) break
      }
    })
    if (best === -1) break
    const cost = itemCost(
      { name: '', seconds: holdSeconds(remaining[best].s, phase), perSide: remaining[best].s.perSide },
      transitionSec,
    )
    if (picked.length >= 3 && total + cost > budget) break
    take(best)
  }

  // Fill pass: best overlap first until the budget is spent.
  remaining.sort((a, b) => b.score - a.score || b.r - a.r)
  while (remaining.length > 0) {
    const cost = itemCost(
      { name: '', seconds: holdSeconds(remaining[0].s, phase), perSide: remaining[0].s.perSide },
      transitionSec,
    )
    if (total + cost > budget) break
    take(0)
  }

  // Cooldowns settle: end in Child's pose when there is room for it.
  if (phase === 'post' && !picked.some((p) => p.name === "Child's pose")) {
    const rest: RoutineItem = { name: "Child's pose", seconds: 45 }
    if (total + itemCost(rest, transitionSec) <= budget + 30) picked.push(rest)
  }

  if (picked.length === 0) return null
  const label = isFullBody(opts.muscles)
    ? 'Full-body'
    : opts.muscles.slice(0, 3).join(', ') || 'This session'
  return {
    id: `gen-${phase}`,
    name: phase === 'pre' ? 'Warm-up' : 'Cool-down',
    blurb: label,
    tags: [phase],
    transitionSec,
    items: picked,
  }
}
