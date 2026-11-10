// Reading a saved day plan: which item is the session, and what is done.

import { localDay } from '../wellness'
import type { Workout } from '../workouts'
import type { DayPlan, DayPlanItem } from './types'

/**
 * The coach's one line, a few words in its own voice. It follows the day:
 * nothing chosen yet, a plan standing, the work done. The home screen and
 * the top of an empty conversation both show it, so they never disagree.
 */
export function coachLine(
  workouts: Workout[],
  dayPlan: DayPlan | null,
  today: string,
): string {
  const trained = workouts.some(
    (w) => w.kind !== 'recovery' && localDay(w.start) === today,
  )
  if (trained) return 'Wall\u2019s down. What\u2019s next?'
  if (dayPlan) return 'Plan\u2019s set. Change anything?'
  return 'Which wall today?'
}

/** The title a warm-up or cool-down is logged under, so it can be found again. */
export function generatedTitle(
  kind: 'warmup' | 'cooldown',
  muscles: string[],
): string {
  const lead = kind === 'warmup' ? 'Warm-up' : 'Cool-down'
  return muscles.length ? `${lead} · ${muscles.slice(0, 3).join(', ')}` : lead
}

/** True for the items that are training rather than recovery. */
export function isSession(item: DayPlanItem): boolean {
  return item.kind === 'block' || item.kind === 'template' || item.kind === 'custom'
}

/** Has this item been logged today? */
export function planItemDone(
  item: DayPlanItem,
  workouts: Workout[],
  today: string,
): boolean {
  const todays = workouts.filter((w) => localDay(w.start) === today)
  switch (item.kind) {
    case 'block':
      return todays.some(
        (w) => w.mesoId === item.mesoId && w.mesoDayIndex === item.dayIndex,
      )
    case 'template':
    case 'custom':
      return todays.some((w) => w.kind !== 'recovery' && w.title === item.title)
    case 'routine':
    case 'user-routine':
      return todays.some((w) => w.kind === 'recovery' && w.title === item.title)
    case 'warmup':
    case 'cooldown': {
      const lead = item.kind === 'warmup' ? 'Warm-up' : 'Cool-down'
      return todays.some(
        (w) => w.kind === 'recovery' && (w.title ?? '').startsWith(lead),
      )
    }
  }
}
