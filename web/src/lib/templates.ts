import { storageKey } from './storage'
import type { IntervalSection, WorkoutKind } from './workouts'

export interface TemplateExercise {
  /** Display label; for slots an auto-label like "quads exercise 1". */
  name: string
  setCount: number
  /** Present = generic slot: the lifter picks a concrete exercise of this
   * muscle group when starting a workout from the template. */
  muscle?: string
}

/** One step of a recovery routine: a hold or a drill, optionally per side. */
export interface RoutineItem {
  name: string
  seconds: number
  perSide?: boolean
  cue?: string
}

export interface Template {
  id: string
  name: string
  kind: WorkoutKind
  exercises?: TemplateExercise[]
  sections?: IntervalSection[]
  /** Recovery routines. Kept apart from `sections`: planFromSections
   * assumes the warm/work/rest/cool shape and would mangle a pose list. */
  items?: RoutineItem[]
  /** Recovery routines: seconds of lead-in before each item. */
  transitionSec?: number
  updatedAt?: string
}

export function hasSlots(t: Template): boolean {
  return (t.exercises ?? []).some((e) => e.muscle !== undefined)
}

// ---- recovery routines → timer sections ----
// The timer only understands {label, durationSec}, and the server only
// stores those two fields on a workout's intervals, so a routine is
// expanded with a label convention: "Next: X" lead-ins, "X (L)" / "X (R)"
// per-side holds, and a "Switch sides" beat between them. The player reads
// the convention back to pick tone and cue text.

export const SWITCH_LABEL = 'Switch sides'
export const NEXT_PREFIX = 'Next: '
export const DEFAULT_TRANSITION_SEC = 8
/** Server label cap on interval sections. */
const LABEL_MAX = 40

export function isTransition(label: string): boolean {
  return label === SWITCH_LABEL || label.startsWith(NEXT_PREFIX)
}

/** "Pigeon (L)" → "Pigeon"; "Next: Pigeon (R)" → "Pigeon". */
export function holdBaseName(label: string): string {
  const l = label.startsWith(NEXT_PREFIX) ? label.slice(NEXT_PREFIX.length) : label
  return l.replace(/ \((L|R)\)$/, '')
}

export function holdSide(label: string): 'L' | 'R' | undefined {
  const m = / \((L|R)\)$/.exec(label)
  return m ? (m[1] as 'L' | 'R') : undefined
}

function clampLabel(label: string): string {
  return label.length <= LABEL_MAX ? label : label.slice(0, LABEL_MAX)
}

export function routineToSections(
  items: RoutineItem[],
  transitionSec: number = DEFAULT_TRANSITION_SEC,
): IntervalSection[] {
  const out: IntervalSection[] = []
  const lead = Math.max(0, Math.round(transitionSec))
  // Sides need at least a moment to swap even when lead-ins are off
  const swap = Math.max(3, lead)
  for (const item of items) {
    const seconds = Math.max(1, Math.round(item.seconds))
    // Names are trimmed to leave room for the side suffix under the cap
    const name = item.name.trim().slice(0, LABEL_MAX - NEXT_PREFIX.length - 4)
    if (lead > 0) {
      out.push({
        label: clampLabel(`${NEXT_PREFIX}${name}${item.perSide ? ' (L)' : ''}`),
        durationSec: lead,
      })
    }
    if (item.perSide) {
      out.push({ label: clampLabel(`${name} (L)`), durationSec: seconds })
      out.push({ label: SWITCH_LABEL, durationSec: swap })
      out.push({ label: clampLabel(`${name} (R)`), durationSec: seconds })
    } else {
      out.push({ label: clampLabel(name), durationSec: seconds })
    }
  }
  return out
}

/** Hold time only — what a routine "is", ignoring lead-ins and swaps. */
export function routineHoldSec(items: RoutineItem[]): number {
  return items.reduce(
    (sum, it) => sum + Math.round(it.seconds) * (it.perSide ? 2 : 1),
    0,
  )
}

export interface QuickIntervalPlan {
  warmupSec: number
  workSec: number
  restSec: number
  sets: number
  cooldownSec: number
}

export const DEFAULT_PLAN: QuickIntervalPlan = {
  warmupSec: 300,
  workSec: 45,
  restSec: 75,
  sets: 4,
  cooldownSec: 300,
}

/** warm up → work → (rest → work)×(n−1) → cool down */
export function buildIntervals(plan: QuickIntervalPlan): IntervalSection[] {
  const out: IntervalSection[] = []
  if (plan.warmupSec > 0) {
    out.push({ label: 'Warm up', durationSec: plan.warmupSec })
  }
  const sets = Math.max(1, Math.round(plan.sets))
  for (let i = 0; i < sets; i++) {
    if (i > 0 && plan.restSec > 0) {
      out.push({ label: 'Rest', durationSec: plan.restSec })
    }
    out.push({ label: 'Work', durationSec: plan.workSec })
  }
  if (plan.cooldownSec > 0) {
    out.push({ label: 'Cool down', durationSec: plan.cooldownSec })
  }
  return out
}

/**
 * Reverse of buildIntervals for editing: recovers the quick-plan fields from
 * a stored flat section list (all current templates are app-generated, so
 * the uniform structure round-trips cleanly).
 */
export function planFromSections(sections: IntervalSection[]): QuickIntervalPlan {
  const lower = (s: IntervalSection) => s.label.toLowerCase()
  const warm = sections.find((s) => lower(s).includes('warm'))
  const cool = sections.find((s) => lower(s).includes('cool'))
  const works = sections.filter((s) => sectionTone(s.label) === 'work')
  const rests = sections.filter((s) => sectionTone(s.label) === 'rest')
  return {
    warmupSec: warm?.durationSec ?? 0,
    workSec: works[0]?.durationSec ?? 60,
    restSec: rests[0]?.durationSec ?? 0,
    sets: Math.max(1, works.length),
    cooldownSec: cool?.durationSec ?? 0,
  }
}

export type SectionTone = 'warm' | 'work' | 'rest' | 'cool' | 'other'

export function sectionTone(label: string): SectionTone {
  const l = label.toLowerCase()
  if (l.includes('warm')) return 'warm'
  if (l.includes('rest') || l.includes('recover')) return 'rest'
  if (l.includes('cool')) return 'cool'
  if (l.includes('work') || l.includes('sprint') || l.includes('run')) {
    return 'work'
  }
  return 'other'
}

export function fmtSec(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}

export function totalSec(sections: IntervalSection[]): number {
  return sections.reduce((sum, s) => sum + s.durationSec, 0)
}

// ---- cache so Start workout works offline with known templates ----

const CACHE_KEY = 'fit.templatesCache'

export function loadTemplateCache(): Template[] {
  try {
    return JSON.parse(localStorage.getItem(storageKey(CACHE_KEY)) ?? '[]')
  } catch {
    return []
  }
}

export function saveTemplateCache(list: Template[]): void {
  localStorage.setItem(storageKey(CACHE_KEY), JSON.stringify(list))
}
