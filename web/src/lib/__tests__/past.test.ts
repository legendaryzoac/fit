import { describe, expect, it } from 'vitest'
import { BLOCK, NOW, TEMPLATES, iso, strength } from '../agent/__tests__/fixtures'
import { makeMuscleLookup } from '../exercises'
import { finalizeWorkout } from '../workouts'
import {
  blockDaysAt,
  defaultPastStart,
  markFilledDone,
  pastProblem,
  pastStartProblem,
  pastWorkout,
  settlePast,
} from '../past'

const lookup = makeMuscleLookup([])
const ctx = { meso: BLOCK, templates: TEMPLATES, workouts: [], lookup }
const at = (daysAgo: number, hour = 18) => new Date(iso(daysAgo, hour)).getTime()

describe('defaultPastStart', () => {
  it('opens on yesterday evening', () => {
    const d = defaultPastStart(NOW)
    expect(d.getDate()).toBe(new Date(NOW - 86_400_000).getDate())
    expect(d.getHours()).toBe(18)
    expect(d.getTime()).toBeLessThan(NOW)
  })
})

describe('blockDaysAt', () => {
  it('offers the block days with the week that date fell in', () => {
    // The block started 8 days ago: yesterday is week 2, 8 days ago week 1
    expect(blockDaysAt(BLOCK, at(1)).map((d) => [d.label, d.week])).toEqual([
      ['Upper A', 1],
      ['Lower A', 1],
    ])
    expect(blockDaysAt(BLOCK, at(8))[0].week).toBe(0)
  })

  it('offers nothing before the block began or after it ran out', () => {
    expect(blockDaysAt(BLOCK, at(9))).toEqual([])
    expect(blockDaysAt(BLOCK, at(8) + 5 * 7 * 86_400_000)).toEqual([])
    expect(blockDaysAt(undefined, at(1))).toEqual([])
    expect(blockDaysAt({ ...BLOCK, status: 'completed' }, at(1))).toEqual([])
  })
})

describe('pastWorkout', () => {
  it('dates an open workout and gives it an end', () => {
    const w = pastWorkout({ kind: 'open' }, iso(2), ctx)!
    expect(w.kind).toBe('strength')
    expect(w.start).toBe(iso(2))
    expect(new Date(w.end!).getTime() - new Date(w.start).getTime()).toBe(3_600_000)
    expect(w.exercises).toEqual([])
  })

  it('lays a template out as authored, with empty rows', () => {
    const w = pastWorkout({ kind: 'template', templateId: 'tpl-upper' }, iso(2), ctx)!
    expect(w.title).toBe('Upper day')
    expect(w.exercises.map((e) => [e.name, e.sets.length])).toEqual([
      ['Bench press', 4],
      ['Barbell row', 4],
    ])
    expect(w.exercises[0].sets[0]).toEqual({})
  })

  it('plans a block day for the week it happened in and links it', () => {
    const w = pastWorkout({ kind: 'block', dayIndex: 1 }, iso(8), ctx)!
    expect(w.mesoId).toBe(BLOCK.id)
    expect(w.mesoDayIndex).toBe(1)
    expect(w.title).toBe('Lower A · wk 1')
    expect(w.exercises.map((e) => e.name)).toEqual([
      'Back squat',
      'Romanian deadlift',
      'Leg curl',
    ])
  })

  it('refuses a block day on a date outside the block', () => {
    expect(pastWorkout({ kind: 'block', dayIndex: 0 }, iso(20), ctx)).toBeNull()
    expect(pastWorkout({ kind: 'block', dayIndex: 9 }, iso(2), ctx)).toBeNull()
  })

  it('plans from what had been logged by then, not from later sessions', () => {
    // A later session with an extra set must not shape the earlier day
    const later = strength(1, 'Upper A · wk 2', [['Bench press', 6, 200, 8]], {
      mesoId: BLOCK.id,
      mesoDayIndex: 0,
    })
    const alone = pastWorkout({ kind: 'block', dayIndex: 0 }, iso(6), ctx)!
    const withLater = pastWorkout({ kind: 'block', dayIndex: 0 }, iso(6), {
      ...ctx,
      workouts: [later],
    })!
    expect(withLater.exercises.map((e) => e.sets.length)).toEqual(
      alone.exercises.map((e) => e.sets.length),
    )
  })

  it('records a timer template the way the timer would have', () => {
    const tpl = {
      id: 'tpl-run',
      name: 'Tempo run',
      kind: 'cardio' as const,
      sections: [
        { label: 'Warm', durationSec: 600 },
        { label: 'Tempo', durationSec: 1200 },
      ],
    }
    const w = pastWorkout({ kind: 'template', templateId: 'tpl-run' }, iso(2), {
      ...ctx,
      templates: [tpl],
    })!
    expect(w.kind).toBe('cardio')
    expect(w.durationMin).toBe(30)
    expect(w.intervals).toHaveLength(2)
  })
})

describe('settlePast', () => {
  // Entered for yesterday, which is week 2 of the block
  const day = pastWorkout({ kind: 'block', dayIndex: 0 }, iso(1), ctx)!

  it('counts filled rows as done so the ratings sheet sees the muscles', () => {
    const w = {
      ...day,
      exercises: [
        { name: 'Bench press', sets: [{ weight: 185, reps: 8 }, {}] },
      ],
    }
    const out = markFilledDone(w)
    expect(out.exercises[0].sets.map((s) => s.done)).toEqual([true, undefined])
    // …and saving drops the empty row and the client-only flag
    expect(finalizeWorkout(out).exercises[0].sets).toEqual([{ weight: 185, reps: 8 }])
  })

  it('retitles a block day whose date moved to another week', () => {
    expect(day.title).toBe('Upper A · wk 2')
    const moved = settlePast({ ...day, start: iso(8) }, BLOCK)
    expect(moved.title).toBe('Upper A · wk 1')
    expect(moved.mesoId).toBe(BLOCK.id)
  })

  it('keeps a title the athlete wrote', () => {
    const own = settlePast({ ...day, start: iso(8), title: 'Garage session' }, BLOCK)
    expect(own.title).toBe('Garage session')
  })

  it('unlinks a block day whose date left the block', () => {
    const out = settlePast({ ...day, start: iso(30) }, BLOCK)
    expect(out.mesoId).toBeUndefined()
    expect(out.mesoDayIndex).toBeUndefined()
  })

  it('ends cardio when its minutes say it did', () => {
    const run = { ...pastWorkout({ kind: 'cardio' }, iso(2), ctx)!, durationMin: 45 }
    const out = settlePast(run, undefined)
    expect(new Date(out.end!).getTime() - new Date(out.start).getTime()).toBe(45 * 60_000)
  })
})

describe('pastStartProblem', () => {
  it('accepts the recent past and nothing else', () => {
    expect(pastStartProblem(at(1), NOW)).toBeNull()
    expect(pastStartProblem(NOW + 60_000, NOW)).toMatch(/future/)
    expect(pastStartProblem(at(366), NOW)).toMatch(/year/)
    expect(pastStartProblem(Number.NaN, NOW)).toMatch(/Pick when/)
  })
})

describe('pastProblem', () => {
  const open = pastWorkout({ kind: 'open' }, iso(2), ctx)!

  it('wants at least one set for strength', () => {
    expect(pastProblem(open, NOW)).toMatch(/one set/)
    const filled = {
      ...open,
      exercises: [{ name: 'Bench press', sets: [{ weight: 185, reps: 8 }] }],
    }
    expect(pastProblem(filled, NOW)).toBeNull()
  })

  it('wants a duration for cardio', () => {
    const run = pastWorkout({ kind: 'cardio' }, iso(2), ctx)!
    expect(pastProblem(run, NOW)).toBeNull()
    expect(pastProblem({ ...run, durationMin: undefined }, NOW)).toMatch(/how long/)
  })

  it('rejects the future and the distant past', () => {
    expect(pastProblem({ ...open, start: new Date(NOW + 60_000).toISOString() }, NOW)).toMatch(
      /future/,
    )
    expect(pastProblem({ ...open, start: iso(400) }, NOW)).toMatch(/year/)
  })

  it('accepts an interval session on its sections alone', () => {
    const intervals = {
      ...open,
      kind: 'speed' as const,
      intervals: [{ label: 'Sprint', durationSec: 30 }],
    }
    expect(pastProblem(intervals, NOW)).toBeNull()
    expect(pastProblem({ ...intervals, end: undefined }, NOW)).toMatch(/one set/)
  })
})
