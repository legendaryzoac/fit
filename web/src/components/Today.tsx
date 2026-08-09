import { useEffect, useMemo, useState } from 'react'
import type { Api } from '../lib/api'
import {
  isDeloadWeek,
  mesoOverdue,
  mesoWeek,
  nextDayIndex,
  plannedSets,
  prescribeExercises,
  workoutsInWeek,
  type Mesocycle,
} from '../lib/mesocycle'
import type { Workout } from '../lib/workouts'
import { buttonClass } from './ui'

interface RecoveryPoint {
  date: string
  recoveryScore?: number | null
  hrvMs?: number | null
  rhr?: number | null
}
interface SleepPoint {
  end?: string
  nap?: boolean
  inBedMin?: number
  performancePct?: number
}

const mean = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null

/** Hand-rolled 30-day spark — recharts stays off the Today critical path. */
function Spark({ points, baseline }: { points: number[]; baseline: number | null }) {
  if (points.length < 2) return null
  const W = 358
  const H = 56
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = Math.max(1, max - min)
  const x = (i: number) => (i / (points.length - 1)) * (W - 8) + 4
  const y = (v: number) => H - 6 - ((v - min) / span) * (H - 12)
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="mt-2.5 w-full"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {baseline != null && baseline >= min && baseline <= max && (
        <line
          x1="0"
          x2={W}
          y1={y(baseline)}
          y2={y(baseline)}
          stroke="#201e1d"
          strokeWidth="1"
          strokeDasharray="2 3"
          opacity=".5"
        />
      )}
      <polyline
        points={points.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
        fill="none"
        stroke="#ec3013"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <rect
        x={x(points.length - 1) - 3}
        y={y(points.at(-1)!) - 3}
        width="6"
        height="6"
        fill="#ec3013"
      />
    </svg>
  )
}

/** Epley e1RM over every strength set — the "last PR" footer line. */
function lastPr(
  workouts: Workout[],
): { name: string; e1rm: number; date: string } | null {
  const best = new Map<string, number>()
  let latest: { name: string; e1rm: number; date: string } | null = null
  // oldest → newest so "new all-time best" is chronological
  for (const w of [...workouts].reverse()) {
    if (w.kind !== 'strength') continue
    for (const e of w.exercises) {
      for (const s of e.sets) {
        if (s.weight == null || s.reps == null || s.reps < 1) continue
        const e1rm = s.weight * (1 + s.reps / 30)
        const key = e.name.toLowerCase()
        if (e1rm > (best.get(key) ?? 0)) {
          best.set(key, e1rm)
          latest = { name: e.name, e1rm, date: w.start }
        }
      }
    }
  }
  return latest
}

export function Today({
  api,
  workouts,
  meso,
  lookup,
  bodyWeightLb,
  onStartMesoDay,
  onStartWorkout,
  onPlan,
  onEndMeso,
}: {
  api: Api
  workouts: Workout[]
  meso?: Mesocycle
  lookup: (name: string) => string | undefined
  bodyWeightLb?: number
  onStartMesoDay: (dayIndex: number) => void
  onStartWorkout: () => void
  onPlan: () => void
  onEndMeso: () => void
}) {
  const [recoveries, setRecoveries] = useState<RecoveryPoint[] | null>(null)
  const [sleeps, setSleeps] = useState<SleepPoint[]>([])

  useEffect(() => {
    let alive = true
    api
      .get('/api/metrics?days=30')
      .then(async (res) => {
        if (!res.ok || !alive) return
        const body = await res.json()
        if (!alive) return
        setRecoveries(Array.isArray(body.recoveries) ? body.recoveries : [])
        setSleeps(Array.isArray(body.sleeps) ? body.sleeps : [])
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [api])

  const scores = useMemo(
    () =>
      (recoveries ?? [])
        .filter((r) => r.recoveryScore != null)
        .map((r) => r.recoveryScore as number),
    [recoveries],
  )
  // An unscored most-recent day (strap synced but not yet scored) must
  // not blank the section — fall back to the last SCORED entry.
  const latest = [...(recoveries ?? [])]
    .reverse()
    .find((r) => r.recoveryScore != null)
  const score = latest?.recoveryScore ?? null
  const hrv = latest?.hrvMs ?? null
  const rhr = latest?.rhr ?? null
  const hrv30 = mean(
    (recoveries ?? []).flatMap((r) => (r.hrvMs == null ? [] : [r.hrvMs])),
  )
  const rhr30 = mean(
    (recoveries ?? []).flatMap((r) => (r.rhr == null ? [] : [r.rhr])),
  )
  const baseline = mean(scores)
  const sleep = [...sleeps].filter((s) => !s.nap).at(-1)

  const verdict =
    score == null
      ? null
      : score >= 67
        ? ['RECOVERED', 'TRAIN AS PLANNED']
        : score >= 34
          ? ['MODERATE', 'TRAIN, WATCH THE LOAD']
          : ['RUN DOWN', 'GO EASY TODAY']

  // ---- today's session (meso-aware) ----
  const now = Date.now()
  const week = meso ? Math.min(mesoWeek(meso, now), meso.weeks - 1) : 0
  const next = meso ? nextDayIndex(meso, workouts, now) : 0
  const day = meso?.days[next]
  const preview = useMemo(() => {
    if (!meso || !day) return null
    const mesoWorkouts = workouts.filter((w) => w.mesoId === meso.id)
    const planned = plannedSets(meso, day, week, mesoWorkouts, lookup, now)
    const setsByName = Object.fromEntries(
      planned.map((e) => [e.name, e.setCount]),
    )
    const rx = prescribeExercises(
      meso,
      planned.map((e) => e.name),
      week,
      mesoWorkouts,
      workouts,
      setsByName,
      lookup,
      bodyWeightLb,
    )
    const totalSets = planned.reduce((n, e) => n + e.setCount, 0)
    const lines = planned.map((e) => {
      const p = rx[e.name]
      return p?.weight != null
        ? `${e.name} ${p.sets}×${p.targetReps ?? p.repLow} @ ${p.weight}`
        : `${e.name} ${e.setCount} sets`
    })
    return { planned, totalSets, lines }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meso, day, week, workouts, lookup, bodyWeightLb])

  // ---- this calendar week (Mon-first) ----
  const weekDays = useMemo(() => {
    const today = new Date()
    const monday = new Date(today)
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7))
    const trained = new Set(
      workouts.map((w) => new Date(w.start).toDateString()),
    )
    // Planned squares budget per MESO week — the calendar row can straddle
    // a meso-week boundary, so each grid day draws from its own week's
    // remaining sessions, not from one shared counter.
    const dayIdx = (d: Date) =>
      Math.round(
        Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000,
      )
    const startIdx = meso ? dayIdx(new Date(meso.startDate)) : 0
    const remaining = new Map<number, number>()
    const remainingFor = (wk: number): number => {
      if (!meso || wk < 0 || wk >= meso.weeks) return 0
      if (!remaining.has(wk)) {
        remaining.set(
          wk,
          Math.max(
            0,
            meso.days.length - workoutsInWeek(meso, workouts, wk).length,
          ),
        )
      }
      return remaining.get(wk)!
    }
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday)
      d.setDate(monday.getDate() + i)
      const isToday = d.toDateString() === today.toDateString()
      const done = trained.has(d.toDateString())
      const future = d > today || isToday
      let plan = false
      if (!done && future && meso) {
        const wk = Math.floor((dayIdx(d) - startIdx) / 7)
        if (remainingFor(wk) > 0) {
          plan = true
          remaining.set(wk, remainingFor(wk) - 1)
        }
      }
      return {
        label: d.toLocaleDateString(undefined, { weekday: 'narrow' }),
        num: d.getDate(),
        done,
        plan,
        isToday,
      }
    })
  }, [workouts, meso])

  const pr = useMemo(() => lastPr(workouts), [workouts])

  return (
    <div className="flex flex-col gap-4">
      {score != null && (
        <section>
          <p className="kicker mb-1.5">Readiness</p>
          <div className="flex items-end justify-between">
            <div className="text-6xl font-extrabold leading-[.9] tracking-tight">
              {score}
              <span className="text-3xl">%</span>
            </div>
            {verdict && (
              <div className="pb-1 text-right text-[11px] font-semibold tracking-wider text-ink/55">
                {verdict[0]}
                <br />
                <span className="text-accent-700">{verdict[1]}</span>
              </div>
            )}
          </div>
          <Spark points={scores} baseline={baseline} />
          <div className="mt-0.5 flex justify-between text-[9px] font-semibold tracking-widest text-ink/45">
            <span>30 DAYS</span>
            {baseline != null && <span>DOTTED = BASELINE {Math.round(baseline)}</span>}
          </div>
          <div className="mt-3 grid grid-cols-3 border-b-2 border-t border-ink/40">
            <div className="py-2.5">
              <div className="text-[9px] font-semibold tracking-widest text-ink/50">
                HRV
              </div>
              <div className="text-lg font-extrabold">
                {hrv != null ? Math.round(hrv) : '—'}{' '}
                <span className="text-[11px] font-semibold">MS</span>
              </div>
              {hrv != null && hrv30 != null && (
                <div
                  className={`text-[10px] ${hrv - hrv30 >= 0 ? 'text-accent-700' : 'text-ink/55'}`}
                >
                  {hrv - hrv30 >= 0 ? '+' : ''}
                  {Math.round(hrv - hrv30)} VS 30D
                </div>
              )}
            </div>
            <div className="border-l border-ink/25 py-2.5 pl-3">
              <div className="text-[9px] font-semibold tracking-widest text-ink/50">
                REST HR
              </div>
              <div className="text-lg font-extrabold">
                {rhr != null ? Math.round(rhr) : '—'}{' '}
                <span className="text-[11px] font-semibold">BPM</span>
              </div>
              {rhr != null && rhr30 != null && (
                <div className="text-[10px] text-ink/55">
                  {rhr - rhr30 >= 0 ? '+' : ''}
                  {Math.round(rhr - rhr30)} VS 30D
                </div>
              )}
            </div>
            <div className="border-l border-ink/25 py-2.5 pl-3">
              <div className="text-[9px] font-semibold tracking-widest text-ink/50">
                SLEEP
              </div>
              <div className="text-lg font-extrabold">
                {sleep?.performancePct != null
                  ? `${Math.round(sleep.performancePct)}`
                  : '—'}
                <span className="text-[11px] font-semibold">%</span>
              </div>
              {sleep?.inBedMin != null &&
                (() => {
                  const m = Math.round(sleep.inBedMin) // whole minutes first — 479.6 must be 8:00, not 7:60
                  return (
                    <div className="text-[10px] text-ink/55">
                      {Math.floor(m / 60)}:{String(m % 60).padStart(2, '0')} IN
                      BED
                    </div>
                  )
                })()}
            </div>
          </div>
        </section>
      )}

      <section>
        {meso && mesoOverdue(meso, now) ? (
          <>
            <p className="kicker mb-1">Block finished</p>
            <h2 className="text-3xl font-extrabold leading-none tracking-tight">
              {meso.name}
            </h2>
            <p className="mt-1 text-xs text-ink/55">
              All {meso.weeks} weeks are behind you — wrap it up and train
              free, or plan the next block.
            </p>
            <button
              onClick={onEndMeso}
              className={`${buttonClass} mt-3 w-full justify-between`}
            >
              Mark completed<span>→</span>
            </button>
            <button
              onClick={onStartWorkout}
              className="mt-2 w-full border border-ink/40 px-4 py-2 text-sm font-semibold text-ink hover:bg-ink/5"
            >
              Start an open workout
            </button>
          </>
        ) : meso && day ? (
          <>
            <p className="kicker mb-1">
              Today — wk {week + 1} of {meso.weeks}
              {isDeloadWeek(meso, week) ? ' · deload' : ''}
              {meso.focus.length > 0 ? ` · ${meso.focus.join(' + ')}` : ''}
            </p>
            <h2 className="text-3xl font-extrabold leading-none tracking-tight">
              {day.label}
            </h2>
            {preview && (
              <>
                <p className="mt-1 text-xs text-ink/55">
                  {preview.planned.length} exercises · {preview.totalSets} sets
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-ink/80">
                  {preview.lines.slice(0, 4).join(' · ')}
                  {preview.lines.length > 4 &&
                    ` · +${preview.lines.length - 4} more`}
                </p>
              </>
            )}
            <button
              onClick={() => onStartMesoDay(next)}
              className={`${buttonClass} mt-3 w-full justify-between`}
            >
              Start session<span>→</span>
            </button>
          </>
        ) : (
          <>
            <p className="kicker mb-1">Today</p>
            <h2 className="text-3xl font-extrabold leading-none tracking-tight">
              Open training
            </h2>
            <p className="mt-1 text-xs text-ink/55">
              No block running — start anything, or plan a mesocycle for
              per-session prescriptions.
            </p>
            <button
              onClick={onStartWorkout}
              className={`${buttonClass} mt-3 w-full justify-between`}
            >
              Start workout<span>→</span>
            </button>
            <button
              onClick={onPlan}
              className="mt-2 w-full border border-ink/40 px-4 py-2 text-sm font-semibold text-ink hover:bg-ink/5"
            >
              Plan a mesocycle
            </button>
          </>
        )}
      </section>

      <section>
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="kicker-muted">This week</span>
          <span className="text-[9px] font-semibold tracking-widest text-ink/45">
            ▪ DONE · ▫ PLANNED
          </span>
        </div>
        <div className="grid grid-cols-7 border border-ink/40">
          {weekDays.map((d, i) => (
            <div
              key={i}
              className={`py-2 text-center ${i < 6 ? 'border-r border-ink/25' : ''} ${
                d.isToday ? 'shadow-[inset_0_0_0_2px_#ec3013]' : ''
              }`}
            >
              <div
                className={`text-[9px] font-semibold ${d.isToday ? 'text-accent-700' : 'text-ink/50'}`}
              >
                {d.label.toUpperCase()}
              </div>
              <div
                className={`text-sm font-extrabold ${d.isToday ? 'text-accent-700' : ''}`}
              >
                {d.num}
              </div>
              <div
                className={`mx-auto mt-1 h-2 w-2 ${
                  d.done
                    ? 'bg-accent'
                    : d.plan
                      ? 'border-[1.5px] border-accent'
                      : ''
                }`}
              />
            </div>
          ))}
        </div>
        {pr && (
          <div className="mt-3 flex justify-between border-t border-ink/25 pt-2 text-[10px] font-semibold tracking-wider text-ink/55">
            <span>
              LAST PR — {pr.name.toUpperCase()} {Math.round(pr.e1rm)} LB E1RM
            </span>
            <span>
              {new Date(pr.date)
                .toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                })
                .toUpperCase()}
            </span>
          </div>
        )}
      </section>
    </div>
  )
}
