import type { IntervalSection, WorkoutKind } from './workouts'

export interface Template {
  id: string
  name: string
  kind: WorkoutKind
  exercises?: Array<{ name: string; setCount: number }>
  sections?: IntervalSection[]
  updatedAt?: string
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
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? '[]')
  } catch {
    return []
  }
}

export function saveTemplateCache(list: Template[]): void {
  localStorage.setItem(CACHE_KEY, JSON.stringify(list))
}
