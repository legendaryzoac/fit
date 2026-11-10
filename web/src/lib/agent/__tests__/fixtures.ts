import { makeMuscleLookup } from '../../exercises'
import type { Mesocycle } from '../../mesocycle'
import type { Template } from '../../templates'
import type { Workout } from '../../workouts'
import type { AgentContext, AgentEffects, DayPlan, CoachNote } from '../types'

/** Tuesday 10 November 2026, 07:30 local. */
export const NOW = new Date(2026, 10, 10, 7, 30).getTime()
const DAY = 86_400_000

export const iso = (daysAgo: number, hour = 18) => {
  const d = new Date(NOW - daysAgo * DAY)
  d.setHours(hour, 0, 0, 0)
  return d.toISOString()
}

export function strength(
  daysAgo: number,
  title: string,
  rows: Array<[string, number, number, number]>,
  extra: Partial<Workout> = {},
): Workout {
  return {
    id: `w-${daysAgo}-${title}`,
    start: iso(daysAgo),
    end: iso(daysAgo, 19),
    kind: 'strength',
    title,
    weightUnit: 'lb',
    exercises: rows.map(([name, sets, weight, reps]) => ({
      name,
      sets: Array.from({ length: sets }, () => ({ weight, reps, rpe: 8 })),
    })),
    ...extra,
  }
}

/** A four-day upper/lower block that started eight days ago (week 2). */
export const BLOCK: Mesocycle = {
  id: 'meso-1',
  name: 'Upper lower',
  weeks: 5,
  focus: ['chest'],
  startDate: iso(8, 6),
  status: 'active',
  days: [
    {
      label: 'Upper A',
      weekday: 1, // Tuesday: today
      exercises: [
        { name: 'Bench press', setCount: 3 },
        { name: 'Barbell row', setCount: 3 },
        { name: 'Overhead press', setCount: 2 },
        { name: 'Lat pulldown', setCount: 2 },
        { name: 'Triceps pushdown', setCount: 2 },
      ],
    },
    {
      label: 'Lower A',
      weekday: 3,
      exercises: [
        { name: 'Back squat', setCount: 3 },
        { name: 'Romanian deadlift', setCount: 3 },
        { name: 'Leg curl', setCount: 2 },
      ],
    },
  ],
}

export const TEMPLATES: Template[] = [
  {
    id: 'tpl-upper',
    name: 'Upper day',
    kind: 'strength',
    exercises: [
      { name: 'Bench press', setCount: 4 },
      { name: 'Barbell row', setCount: 4 },
    ],
  },
  {
    id: 'tpl-track',
    name: 'Track Tuesday',
    kind: 'speed',
    sections: [
      { label: 'Warm up', durationSec: 300 },
      { label: 'Work', durationSec: 600 },
    ],
  },
]

export function makeCtx(over: Partial<AgentContext> = {}): AgentContext {
  return {
    now: NOW,
    workouts: [
      strength(5, 'Lower A · wk 1', [
        ['Back squat', 3, 225, 6],
        ['Romanian deadlift', 3, 185, 8],
      ], { mesoId: 'meso-1', mesoDayIndex: 1 }),
      strength(7, 'Upper A · wk 1', [
        ['Bench press', 3, 185, 8],
        ['Barbell row', 3, 155, 8],
      ], { mesoId: 'meso-1', mesoDayIndex: 0 }),
      strength(20, 'Upper', [['Bench press', 3, 175, 8]]),
    ],
    mesos: [BLOCK],
    templates: TEMPLATES,
    customs: [],
    lookup: makeMuscleLookup([]),
    checkins: [],
    unit: 'lb',
    strap: null,
    notes: [],
    dayPlan: null,
    ...over,
  }
}

export function recorder(): AgentEffects & {
  plans: DayPlan[]
  notes: CoachNote[]
  checkins: Array<Record<string, unknown>>
} {
  const plans: DayPlan[] = []
  const notes: CoachNote[] = []
  const checkins: Array<Record<string, unknown>> = []
  return {
    plans,
    notes,
    checkins,
    setDayPlan: (p) => plans.push(p),
    addNote: (n) => notes.push(n),
    saveCheckin: (c) => checkins.push(c),
  }
}
