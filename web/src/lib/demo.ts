/**
 * Fully client-side demo: deterministic synthetic data behind the same Api
 * seam the real backend serves. No network, no accounts, nothing to abuse.
 */
import type { Api } from './api'
import type { Template } from './templates'
import type { SessionRecord, Workout } from './workouts'

const DAY = 86_400_000
const TZ = '-06:00'
const MILE = 1609.34

/** mulberry32 — tiny seeded PRNG so the demo tells the same story every time. */
function rng(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface DemoStore {
  me: unknown
  recoveries: unknown[]
  sleeps: unknown[]
  cycles: unknown[]
  sessions: SessionRecord[]
  workouts: Workout[]
  templates: Template[]
  exercises: Array<{ name: string; muscle: string }>
}

function generate(): DemoStore {
  const rand = rng(20260703)
  const noise = (scale: number) => (rand() - 0.5) * 2 * scale
  const now = Date.now()
  const store: DemoStore = {
    me: null,
    recoveries: [],
    sleeps: [],
    cycles: [],
    sessions: [],
    workouts: [],
    templates: [],
    exercises: [{ name: 'Sled drag', muscle: 'full body' }],
  }

  const DAYS = 200
  let fatigue = 0 // yesterday's strain pushes down today's recovery

  for (let i = DAYS; i >= 1; i--) {
    const dayStart = now - i * DAY
    const date = new Date(dayStart)
    const dow = date.getDay() // 0 Sun … 6 Sat
    const progress = (DAYS - i) / DAYS // 0 → 1 over the window

    // Training rhythm: lift Mon/Wed/Fri, run Tue/Sat, rest Sun/Thu
    const lifts = dow === 1 || dow === 3 || dow === 5
    const runs = dow === 2 || dow === 6
    const lateNight = dow === 5 || dow === 6 // weekend social life

    // Sleep (ends ~6:45am local; local 6:45 = 12:45 UTC at -06:00)
    const sleepEnd = dayStart + (12.75 + noise(0.4)) * 3_600_000
    const inBedMin = Math.round(
      430 + noise(40) - (lateNight ? 55 + rand() * 30 : 0),
    )
    const awakeMin = Math.round(28 + noise(12))
    const asleep = inBedMin - awakeMin
    const deepMin = Math.round(asleep * (0.22 + noise(0.03)))
    const remMin = Math.round(asleep * (0.26 + noise(0.04)))
    const lightMin = asleep - deepMin - remMin
    const performancePct = Math.round(
      Math.min(99, Math.max(48, (inBedMin / 470) * 100 + noise(6))),
    )
    store.sleeps.push({
      end: new Date(sleepEnd).toISOString(),
      timezoneOffset: TZ,
      nap: false,
      inBedMin,
      awakeMin,
      lightMin,
      deepMin,
      remMin,
      performancePct,
      efficiencyPct: Math.round(88 + noise(6)),
      consistencyPct: Math.round(78 - (lateNight ? 12 : 0) + noise(8)),
      respiratoryRate: Math.round((15.3 + noise(0.5)) * 10) / 10,
      disturbances: Math.max(0, Math.round(9 + noise(5))),
      scoreState: 'SCORED',
    })

    // Recovery: sleep helps, yesterday's strain hurts, fitness trends up
    const recoveryScore = Math.round(
      Math.min(
        98,
        Math.max(
          12,
          58 +
            (performancePct - 75) * 0.45 -
            fatigue * 2.4 +
            progress * 6 +
            noise(14),
        ),
      ),
    )
    const hrvMs = Math.round(78 + progress * 14 + (recoveryScore - 60) * 0.55 + noise(9))
    const rhr = Math.round(58 - progress * 3 + (60 - recoveryScore) * 0.09 + noise(2.2))
    store.recoveries.push({
      date: new Date(sleepEnd + 12 * 60_000).toISOString(),
      recoveryScore,
      rhr,
      hrvMs,
      scoreState: 'SCORED',
      userCalibrating: false,
    })

    // Captured sessions + daily strain
    let strain = 5 + noise(2.5)
    if (lifts) {
      const sStart = dayStart + (23 + noise(0.7)) * 3_600_000 // ~5pm local
      const durMin = 52 + noise(12)
      store.sessions.push({
        sk: `SESSION#${new Date(sStart).toISOString()}#demo-l${i}`,
        sport: 'weightlifting',
        start: new Date(sStart).toISOString(),
        end: new Date(sStart + durMin * 60_000).toISOString(),
        timezoneOffset: TZ,
        strain: Math.round((9.5 + noise(2)) * 10) / 10,
        avgHr: Math.round(118 + noise(9)),
        maxHr: Math.round(158 + noise(12)),
        kilojoule: Math.round(1450 + noise(300)),
        zoneMin: {
          z0: Math.round(durMin * 0.18),
          z1: Math.round(durMin * 0.4),
          z2: Math.round(durMin * 0.28),
          z3: Math.round(durMin * 0.11),
          z4: Math.round(durMin * 0.03),
          z5: 0,
        },
        scoreState: 'SCORED',
      })
      strain += 5.5 + noise(1.5)
    }
    if (runs) {
      const sStart = dayStart + (13.5 + noise(0.5)) * 3_600_000 // ~7:30am
      const miles = 2.6 + rand() * 2.2
      // Aerobic fitness improves: pace drops from ~10:20 to ~9:00 /mi
      const paceMin = 10.35 - progress * 1.35 + noise(0.35)
      const durMin = miles * paceMin
      store.sessions.push({
        sk: `SESSION#${new Date(sStart).toISOString()}#demo-r${i}`,
        sport: 'running',
        start: new Date(sStart).toISOString(),
        end: new Date(sStart + durMin * 60_000).toISOString(),
        timezoneOffset: TZ,
        strain: Math.round((11 + noise(2.5)) * 10) / 10,
        avgHr: Math.round(156 - progress * 5 + noise(6)),
        maxHr: Math.round(181 + noise(6)),
        kilojoule: Math.round(miles * 420),
        distanceM: Math.round(miles * MILE),
        zoneMin: {
          z0: 2,
          z1: Math.round(durMin * 0.12),
          z2: Math.round(durMin * 0.34),
          z3: Math.round(durMin * 0.38),
          z4: Math.round(durMin * 0.13),
          z5: Math.round(durMin * 0.03),
        },
        scoreState: 'SCORED',
      })
      strain += 4.5 + noise(1.5)
    }
    strain = Math.min(20.4, Math.max(2, strain))
    fatigue = Math.max(0, (strain - 10) / 4)
    store.cycles.push({
      start: new Date(dayStart + 10 * 3_600_000).toISOString(),
      end: new Date(dayStart + 34 * 3_600_000).toISOString(),
      timezoneOffset: TZ,
      strain: Math.round(strain * 10) / 10,
      kilojoule: Math.round(7800 + strain * 320 + noise(500)),
      avgHr: Math.round(72 + strain * 1.4 + noise(4)),
      maxHr: Math.round(150 + strain * 1.6 + noise(8)),
      scoreState: 'SCORED',
    })

    // Hand-logged training that mirrors the captured sessions
    if (lifts) {
      const week = Math.floor((DAYS - i) / 7)
      const upper = dow !== 3
      const bump = (base: number, perWeek: number) =>
        Math.round((base + week * perWeek + noise(4)) / 5) * 5
      const wStart = new Date(dayStart + 23 * 3_600_000).toISOString()
      const sets = (weight: number, reps: number, n: number) =>
        Array.from({ length: n }, () => ({
          weight,
          reps: Math.max(3, Math.round(reps + noise(1.2))),
          rpe: Math.round((7.5 + noise(1)) * 2) / 2,
        }))
      store.workouts.push({
        id: `demo-w${i}`,
        start: wStart,
        end: new Date(dayStart + 24 * 3_600_000).toISOString(),
        kind: 'strength',
        title: upper ? 'Upper day' : 'Lower day',
        weightUnit: 'lb',
        exercises: upper
          ? [
              { name: 'Bench press', sets: sets(bump(160, 1.1), 6, 4) },
              { name: 'Barbell row', sets: sets(bump(150, 1.0), 8, 4) },
              { name: 'Overhead press', sets: sets(bump(95, 0.6), 6, 3) },
              { name: 'Dumbbell curl', sets: sets(bump(30, 0.25), 10, 3) },
            ]
          : [
              { name: 'Back squat', sets: sets(bump(205, 1.6), 5, 4) },
              { name: 'Romanian deadlift', sets: sets(bump(185, 1.3), 8, 3) },
              { name: 'Leg press', sets: sets(bump(320, 2.2), 10, 3) },
              { name: 'Calf raise', sets: sets(bump(140, 0.8), 12, 4) },
            ],
      })
    }
    if (dow === 6 && Math.floor((DAYS - i) / 7) % 2 === 0) {
      const wStart = new Date(dayStart + 14 * 3_600_000).toISOString()
      const best = 5.18 - progress * 0.26
      store.workouts.push({
        id: `demo-s${i}`,
        start: wStart,
        kind: 'speed',
        title: 'Sprint work',
        weightUnit: 'lb',
        durationMin: 34,
        intervals: [
          { label: 'Warm up', durationSec: 480 },
          ...Array.from({ length: 6 }, () => [
            { label: 'Work', durationSec: 30 },
            { label: 'Rest', durationSec: 150 },
          ]).flat(),
          { label: 'Cool down', durationSec: 300 },
        ],
        exercises: [
          {
            name: '40 yd sprint',
            sets: Array.from({ length: 6 }, () => ({
              distanceM: 36.58,
              durationSec: Math.round((best + rand() * 0.22) * 100) / 100,
            })),
          },
        ],
      })
    }
    if (runs && dow === 2) {
      const run = store.sessions.at(-1)!
      store.workouts.push({
        id: `demo-c${i}`,
        start: run.start,
        end: run.end,
        kind: 'cardio',
        title: 'Tempo run',
        weightUnit: 'lb',
        exercises: [],
        durationMin: Math.round(
          (new Date(run.end!).getTime() - new Date(run.start).getTime()) / 60_000,
        ),
        distanceM: run.distanceM,
        linkedSessionSk: run.sk,
      })
    }
  }

  store.workouts.sort((a, b) => b.start.localeCompare(a.start))
  store.templates = [
    {
      id: 'demo-t1',
      name: 'Upper A',
      kind: 'strength',
      exercises: [
        { name: 'Bench press', setCount: 4 },
        { name: 'Barbell row', setCount: 4 },
        { name: 'Overhead press', setCount: 3 },
        { name: 'Dumbbell curl', setCount: 3 },
      ],
    },
    {
      id: 'demo-t2',
      name: 'Lower A',
      kind: 'strength',
      exercises: [
        { name: 'Back squat', setCount: 4 },
        { name: 'Romanian deadlift', setCount: 3 },
        { name: 'Leg press', setCount: 3 },
        { name: 'Calf raise', setCount: 4 },
      ],
    },
    {
      id: 'demo-t3',
      name: 'Track Tuesday',
      kind: 'speed',
      sections: [
        { label: 'Warm up', durationSec: 480 },
        ...Array.from({ length: 6 }, () => [
          { label: 'Work', durationSec: 30 },
          { label: 'Rest', durationSec: 150 },
        ]).flat(),
        { label: 'Cool down', durationSec: 300 },
      ],
    },
  ]
  store.me = {
    userId: 'demo',
    createdAt: new Date(now - DAYS * DAY).toISOString(),
    whoop: {
      connected: true,
      status: 'active',
      lastSyncAt: new Date(now - 2 * 3_600_000).toISOString(),
      backfillDone: true,
    },
  }
  return store
}

function respond(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function daysParam(path: string, fallback: number): number {
  const raw = new URL(path, 'http://demo').searchParams.get('days')
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function since(days: number): string {
  return new Date(Date.now() - days * DAY).toISOString()
}

export function makeDemoApi(): Api {
  const store = generate()
  const wait = () => new Promise((r) => setTimeout(r, 120 + Math.random() * 120))

  async function get(path: string): Promise<Response> {
    await wait()
    // Exact pathname matching — '/api/metrics'.startsWith('/api/me') is true,
    // which is exactly the kind of bug prefix routing invites.
    const pathname = new URL(path, 'http://demo').pathname
    if (pathname === '/api/me') return respond(store.me)
    if (pathname === '/api/metrics') {
      const from = since(daysParam(path, 90))
      return respond({
        days: daysParam(path, 90),
        recoveries: store.recoveries.filter(
          (r) => (r as { date: string }).date >= from,
        ),
        sleeps: store.sleeps.filter((s) => (s as { end: string }).end >= from),
        cycles: store.cycles.filter(
          (c) => (c as { start: string }).start >= from,
        ),
      })
    }
    if (pathname === '/api/sessions') {
      const from = since(daysParam(path, 120))
      return respond({ sessions: store.sessions.filter((s) => s.start >= from) })
    }
    if (pathname === '/api/workouts') {
      const from = since(daysParam(path, 120))
      return respond({ workouts: store.workouts.filter((w) => w.start >= from) })
    }
    if (pathname === '/api/templates') return respond({ templates: store.templates })
    if (pathname === '/api/exercises') return respond({ exercises: store.exercises })
    return respond({ error: 'not found in demo' })
  }

  async function send(
    method: 'POST' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<Response> {
    await wait()
    if (path.startsWith('/api/workouts')) {
      if (method === 'POST') {
        const { previousStart: _m, ...w } = body as Workout & {
          previousStart?: string
        }
        store.workouts = [
          w,
          ...store.workouts.filter((x) => x.id !== w.id),
        ].sort((a, b) => b.start.localeCompare(a.start))
        return respond({ saved: w.id })
      }
      const id = new URL(path, 'http://demo').searchParams.get('id')
      store.workouts = store.workouts.filter((w) => w.id !== id)
      return respond({ deleted: id })
    }
    if (path.startsWith('/api/templates')) {
      if (method === 'POST') {
        const t = body as Template
        store.templates = [...store.templates.filter((x) => x.id !== t.id), t]
        return respond({ saved: t.id })
      }
      const id = new URL(path, 'http://demo').searchParams.get('id')
      store.templates = store.templates.filter((t) => t.id !== id)
      return respond({ deleted: id })
    }
    if (path.startsWith('/api/exercises')) {
      if (method === 'POST') {
        const e = body as { name: string; muscle: string }
        store.exercises = [
          ...store.exercises.filter(
            (x) => x.name.toLowerCase() !== e.name.toLowerCase(),
          ),
          e,
        ]
        return respond({ saved: e.name })
      }
      return respond({ deleted: true })
    }
    return respond({ error: 'not found in demo' })
  }

  return { get, send }
}
