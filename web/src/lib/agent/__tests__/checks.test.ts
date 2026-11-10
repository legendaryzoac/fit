import { describe, expect, it } from 'vitest'
import { checkBlock, volumeZone } from '../block'
import { makeCatalog } from '../catalog'
import { applyTrim } from '../options'
import { checkDayPlan } from '../plan'
import { prepare } from '../snapshot'
import { makeCtx } from './fixtures'

const NO_TRIM = {
  keep_first_exercises: 0,
  drop_sets_per_exercise: 0,
  hold_load: false,
  swaps: [],
}

describe('catalog', () => {
  const catalog = makeCatalog([])
  it('brings shorthand back to the catalog spelling', () => {
    expect(catalog.resolve('bench press')).toBe('Bench press')
    expect(catalog.resolve('Pull ups')).toBe('Pull-up')
    expect(catalog.resolve('RDL')).toBe('Romanian deadlift')
    expect(catalog.resolve('squat')).toBe('Back squat')
  })
  it('refuses what it does not know and offers the nearest', () => {
    expect(catalog.resolve('Zottman preacher blaster')).toBeUndefined()
    expect(catalog.suggest('cable flye')).toContain('Cable fly')
  })
  it('leaves drills out of the lifting catalog', () => {
    expect(catalog.resolve('40 yd sprint')).toBeUndefined()
  })
})

describe('applyTrim', () => {
  const lookup = makeCtx().lookup
  const rows = [
    { name: 'Bench press', sets: 4 },
    { name: 'Incline bench press', sets: 3 },
    { name: 'Barbell row', sets: 3 },
  ]
  it('never drops an exercise below one set', () => {
    const out = applyTrim([{ name: 'Barbell row', sets: 1 }], { dropSets: 2 }, lookup)
    expect(out).toEqual([{ name: 'Barbell row', sets: 1 }])
  })
  it('swaps before it cuts to the first N', () => {
    const out = applyTrim(
      rows,
      { keepFirst: 2, swaps: [{ from: 'Bench press', to: 'Dumbbell bench press' }] },
      lookup,
    )
    expect(out.map((r) => r.name)).toEqual(['Dumbbell bench press', 'Incline bench press'])
  })
  it('holds a muscle to 8 sets a session', () => {
    const out = applyTrim(
      [
        { name: 'Bench press', sets: 5 },
        { name: 'Incline bench press', sets: 5 },
        { name: 'Cable fly', sets: 3 },
      ],
      {},
      lookup,
    )
    expect(out).toEqual([
      { name: 'Bench press', sets: 5 },
      { name: 'Incline bench press', sets: 3 },
    ])
  })
})

describe('checkDayPlan', () => {
  const ctx = makeCtx()
  const prep = prepare(ctx)
  const check = (input: unknown) =>
    checkDayPlan(input, ctx, prep.options, prep.catalog, 'live')

  it('offers today’s block day with the engine’s sets and targets', () => {
    const upper = prep.options.find((o) => o.id === 'block:0')
    expect(upper).toMatchObject({ kind: 'block', scheduledToday: true, title: 'Upper A' })
    const bench = upper && 'exercises' in upper ? upper.exercises[0] : undefined
    expect(bench?.name).toBe('Bench press')
    // Week 2 of a chest-focus block: the ramp has added a set
    expect(bench?.sets).toBe(4)
    expect(bench?.target).toMatch(/^\d+ × \d+$/)
  })

  it('builds warm-up and cool-down around the main session', () => {
    const { plan, errors } = check({
      headline: 'Upper A',
      rationale: 'On the schedule.',
      items: [
        { option_id: 'warmup', note: '', trim: NO_TRIM },
        { option_id: 'block:0', note: '', trim: NO_TRIM },
        { option_id: 'cooldown', note: '', trim: NO_TRIM },
        { option_id: 'routine:sleep', note: 'Before bed', trim: NO_TRIM },
      ],
      custom_session: null,
    })
    expect(errors).toEqual([])
    expect(plan?.items.map((i) => i.kind)).toEqual(['warmup', 'block', 'cooldown', 'routine'])
    const warm = plan?.items[0]
    expect(warm && 'muscles' in warm && warm.muscles).toContain('chest')
    expect(plan?.date).toBe('2026-11-10')
  })

  it('applies a trim and reports it on the item', () => {
    const { plan } = check({
      headline: 'Upper A, 30 min',
      rationale: 'Short on time.',
      items: [
        {
          option_id: 'block:0',
          note: '',
          trim: { ...NO_TRIM, keep_first_exercises: 2, drop_sets_per_exercise: 1, hold_load: true },
        },
      ],
      custom_session: null,
    })
    const item = plan?.items[0]
    expect(item?.kind).toBe('block')
    if (item?.kind !== 'block') return
    expect(item.exercises.map((e) => e.name)).toEqual(['Bench press', 'Barbell row'])
    expect(item.exercises[0].sets).toBe(3)
    // Held: the card must not show the progressed target it will not ask for
    expect(item.exercises[0].target).toBeUndefined()
    expect(item.trim).toEqual({ keepFirst: 2, dropSets: 1, holdLoad: true })
  })

  it('rejects ids and exercises it cannot place, with something to act on', () => {
    const bad = check({
      headline: 'x',
      rationale: 'x',
      items: [
        { option_id: 'block:9', note: '', trim: NO_TRIM },
        {
          option_id: 'block:0',
          note: '',
          trim: { ...NO_TRIM, swaps: [{ from: 'Bench press', to: 'Chest blaster 9000' }] },
        },
      ],
      custom_session: null,
    })
    expect(bad.plan).toBeNull()
    expect(bad.errors[0]).toMatch(/Unknown option_id "block:9"/)
    expect(bad.errors[1]).toMatch(/not in the catalog/)
  })

  it('caps a custom session and says so', () => {
    const { plan, adjustments } = check({
      headline: 'Chest',
      rationale: 'Asked for it.',
      items: [{ option_id: 'custom', note: '', trim: NO_TRIM }],
      custom_session: {
        title: 'Chest day',
        exercises: [
          { name: 'bench', sets: 5 },
          { name: 'Incline bench press', sets: 5 },
          { name: 'Cable fly', sets: 4 },
        ],
      },
    })
    const item = plan?.items[0]
    expect(item?.kind === 'custom' && item.exercises).toEqual([
      { name: 'Bench press', sets: 5 },
      { name: 'Incline bench press', sets: 3 },
    ])
    expect(adjustments.join(' ')).toMatch(/dropped Cable fly/)
  })

  it('accepts an empty plan as a rest day', () => {
    const { plan } = check({ headline: 'Rest day', rationale: 'Nothing scheduled.', items: [], custom_session: null })
    expect(plan?.items).toEqual([])
    expect(plan?.headline).toBe('Rest day')
  })
})

describe('checkBlock', () => {
  const ctx = makeCtx()
  const catalog = makeCatalog([])
  const row = (name: string, sets: number) => ({ name, sets })

  it('classifies weekly volume against the landmarks', () => {
    expect(volumeZone('chest', 3)).toBe('below')
    expect(volumeZone('chest', 5)).toBe('maintenance')
    expect(volumeZone('chest', 12)).toBe('productive')
    expect(volumeZone('chest', 21)).toBe('high')
    expect(volumeZone('chest', 23)).toBe('over')
  })

  it('turns a sound proposal into days the engine accepts', () => {
    const { proposal, errors } = checkBlock(
      {
        name: 'Upper lower',
        weeks: 5,
        focus_muscles: ['chest'],
        days: [
          { label: 'Upper A', weekday: 'mon', exercises: [row('bench', 3), row('Barbell row', 3)] },
          { label: 'Lower A', weekday: 'any', exercises: [row('squat', 3), row('RDL', 3)] },
          { label: 'Upper B', weekday: 'any', exercises: [row('Incline dumbbell press', 3), row('Lat pulldown', 3)] },
        ],
        rationale: 'Twice a week each.',
      },
      ctx,
      catalog,
    )
    expect(errors).toEqual([])
    expect(proposal?.days[0].exercises[0]).toEqual({ name: 'Bench press', setCount: 3 })
    // Monday was asked for; the other two are spread over days still free
    expect(proposal?.days.map((d) => d.weekday)).toEqual([0, 2, 4])
    expect(proposal?.volume.find((v) => v.muscle === 'chest')).toMatchObject({
      sets: 6,
      zone: 'productive',
      focus: true,
    })
  })

  it('sends volume past MRV back as an error', () => {
    const heavy = (label: string) => ({
      label,
      weekday: 'any',
      exercises: [row('Bench press', 4), row('Incline bench press', 4)],
    })
    const { proposal, errors } = checkBlock(
      { name: 'Too much', weeks: 5, focus_muscles: [], days: [heavy('A'), heavy('B'), heavy('C')], rationale: '' },
      ctx,
      catalog,
    )
    expect(proposal).toBeNull()
    expect(errors[0]).toMatch(/chest: 24 weekly sets is past the recoverable maximum of 22/)
  })

  it('clamps length and focus instead of refusing', () => {
    const { proposal, adjustments } = checkBlock(
      {
        name: 'Long',
        weeks: 12,
        focus_muscles: ['chest', 'rear delts'],
        days: [{ label: 'A', weekday: 'any', exercises: [row('Bench press', 3)] }],
        rationale: '',
      },
      ctx,
      catalog,
    )
    expect(proposal?.weeks).toBe(6)
    expect(proposal?.focus).toEqual(['chest'])
    expect(adjustments.join(' ')).toMatch(/6 weeks/)
    expect(adjustments.join(' ')).toMatch(/rear delts/)
  })

  it('names the unknown lift and the nearest real ones', () => {
    const { errors } = checkBlock(
      {
        name: 'x',
        weeks: 5,
        focus_muscles: [],
        days: [{ label: 'A', weekday: 'any', exercises: [row('Cable flye press', 3)] }],
        rationale: '',
      },
      ctx,
      catalog,
    )
    expect(errors[0]).toMatch(/"Cable flye press" is not in the catalog\. Closest: /)
  })
})
