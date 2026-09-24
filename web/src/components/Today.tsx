import { useEffect, useMemo, useState } from 'react'
import type { Api } from '../lib/api'
import {
  dayKind,
  doneDayIndexes,
  isDeloadWeek,
  mesoOverdue,
  mesoWeek,
  nextDayIndex,
  plannedSets,
  prescribeExercises,
  sessionsForToday,
  WEEKDAY_SHORT,
  workoutsInWeek,
  type Mesocycle,
} from '../lib/mesocycle'
import { fmtSec, totalSec } from '../lib/templates'
import type { Workout } from '../lib/workouts'
import { Banner } from './cadence/Banner'
import { Button } from './cadence/Button'
import { Card, CardHead } from './cadence/Card'
import { MetricTile } from './cadence/MetricTile'
import { RecoveryRing } from './cadence/RecoveryRing'
import { StatusPill } from './cadence/StatusPill'
import { WeekStrip } from './cadence/WeekStrip'

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

const signed = (n: number) => `${n >= 0 ? '+' : '-'}${Math.abs(n)}`

/** "7 h 42" from minutes in bed; whole minutes first so 479.6 is 8 h 00. */
function fmtSleepWords(min: number): string {
  const m = Math.round(min)
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`
}

/** "7:42" from minutes in bed. */
function fmtSleepClock(min: number): string {
  const m = Math.round(min)
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`
}

function greeting(hour: number): string {
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

/** 'FRI' becomes 'Fri' for the eyebrow. */
const weekdayLabel = (i: number) =>
  WEEKDAY_SHORT[i][0] + WEEKDAY_SHORT[i].slice(1).toLowerCase()

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

  // An unscored most-recent day (strap synced but not yet scored) must
  // not blank the section — fall back to the last SCORED entry.
  const latest = [...(recoveries ?? [])]
    .reverse()
    .find((r) => r.recoveryScore != null)
  // …but a score from last month is not "today's readiness". When the
  // strap stops reporting (subscription lapsed, device shelved) we say
  // so instead of dressing stale data up as current.
  const latestAgeDays =
    latest?.date != null
      ? Math.floor(
          (Date.now() - new Date(latest.date).getTime()) / 86_400_000,
        )
      : null
  const stale = latestAgeDays != null && latestAgeDays > 2
  // Fresh: a scored recovery at most two days old. A 3-to-7-day gap gets
  // a banner; anything older (or no data at all) is training alone.
  const fresh = latest != null && !stale
  const staleBanner = stale && latestAgeDays != null && latestAgeDays <= 7
  const score = stale ? null : (latest?.recoveryScore ?? null)
  const hrv = latest?.hrvMs ?? null
  const rhr = latest?.rhr ?? null
  const hrv30 = mean(
    (recoveries ?? []).flatMap((r) => (r.hrvMs == null ? [] : [r.hrvMs])),
  )
  const rhr30 = mean(
    (recoveries ?? []).flatMap((r) => (r.rhr == null ? [] : [r.rhr])),
  )
  const nights = sleeps.filter((s) => !s.nap)
  const sleep = nights.at(-1)
  const hrvSeries = (recoveries ?? [])
    .flatMap((r) => (r.hrvMs == null ? [] : [r.hrvMs]))
    .slice(-30)
  const rhrSeries = (recoveries ?? [])
    .flatMap((r) => (r.rhr == null ? [] : [r.rhr]))
    .slice(-30)
  const sleepSeries = nights
    .flatMap((s) => (s.inBedMin == null ? [] : [s.inBedMin]))
    .slice(-30)

  const verdict =
    score == null
      ? null
      : score >= 67
        ? 'Recovered. Train as planned.'
        : score >= 34
          ? 'Moderate. Watch the load.'
          : 'Run down. Go easy.'

  // ---- today's session(s), meso-aware; doubles are a feature ----
  const now = Date.now()
  const week = meso ? Math.min(mesoWeek(meso, now), meso.weeks - 1) : 0
  const todayIdxs = meso ? sessionsForToday(meso, workouts, now) : []
  const next = meso
    ? (todayIdxs[0] ?? nextDayIndex(meso, workouts, now))
    : 0
  const alsoToday = todayIdxs.slice(1)
  const day = meso?.days[next]
  const dayIsToday = todayIdxs.length > 0
  const preview = useMemo(() => {
    if (!meso || !day || dayKind(day) !== 'strength') return null
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
      next,
    )
    const totalSets = planned.reduce((n, e) => n + e.setCount, 0)
    const lines = planned.map((e) => {
      const p = rx[e.name]
      return p?.weight != null
        ? `${e.name} ${p.weight} × ${p.targetReps ?? p.repLow}`
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
    // Keep ORIGINAL indexes: done-state is tracked per day index, and a
    // square must clear once its session is trained — even off-schedule.
    const anchored = (meso?.days ?? [])
      .map((d, idx) => ({ d, idx }))
      .filter(({ d }) => d.weekday != null)
    const doneByWeek = new Map<number, Set<number>>()
    const doneFor = (wk: number): Set<number> => {
      if (!meso) return new Set()
      if (!doneByWeek.has(wk)) {
        doneByWeek.set(wk, doneDayIndexes(meso, workouts, wk))
      }
      return doneByWeek.get(wk)!
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
        if (wk >= 0 && wk < meso.weeks) {
          if (anchored.length > 0) {
            // Weekday-scheduled mesos: a square sits exactly on its day,
            // and clears once that session was trained this meso week
            plan = anchored.some(
              ({ d: md, idx }) => md.weekday === i && !doneFor(wk).has(idx),
            )
          } else if (remainingFor(wk) > 0) {
            plan = true
            remaining.set(wk, remainingFor(wk) - 1)
          }
        }
      }
      return {
        label: d.toLocaleDateString(undefined, { weekday: 'narrow' }),
        num: d.getDate(),
        done,
        planned: plan,
        today: isToday,
      }
    })
  }, [workouts, meso])

  const pr = useMemo(() => lastPr(workouts), [workouts])

  const sessionsDone = meso ? workoutsInWeek(meso, workouts, week).length : 0
  const sessionsPlanned = meso ? meso.days.length : 0
  const finished = meso != null && mesoOverdue(meso, now)

  const vitals = fresh
    ? [
        hrv != null ? `HRV ${Math.round(hrv)} ms` : null,
        rhr != null ? `Resting ${Math.round(rhr)} bpm` : null,
        sleep?.inBedMin != null
          ? `Slept ${fmtSleepWords(sleep.inBedMin)}`
          : null,
      ].filter((x): x is string => x != null)
    : []

  const sessionBlock =
    finished && meso ? (
      <>
        <p className="text-eyebrow text-ink-2">Block finished</p>
        <h2 className="mt-0.5 text-title text-ink">{meso.name}</h2>
        <Button variant="primary" block className="mt-3.5" onClick={onEndMeso}>
          Mark completed
        </Button>
        <Button
          variant="tonal"
          block
          className="mt-2"
          onClick={onStartWorkout}
        >
          Start an open workout
        </Button>
      </>
    ) : meso && day ? (
      <>
        <p className="text-eyebrow text-ink-2">
          {dayIsToday
            ? 'Today'
            : `Next${day.weekday != null ? ` · ${weekdayLabel(day.weekday)}` : ''}`}
          {` · Week ${week + 1} of ${meso.weeks}`}
          {isDeloadWeek(meso, week) ? ' · deload' : ''}
        </p>
        <h2 className="mt-0.5 text-title text-ink">{day.label}</h2>
        {dayKind(day) === 'cardio' ? (
          <p className="mt-1 text-caption text-ink-2">
            {day.sections && day.sections.length > 0
              ? `Intervals · ${day.sections.length} sections · ${fmtSec(totalSec(day.sections))}`
              : 'Stopwatch'}
          </p>
        ) : (
          preview && (
            <p className="mt-1 text-caption text-ink-2">
              {preview.planned.length} exercises · {preview.totalSets} sets
              {preview.lines.length > 0 &&
                ` · ${preview.lines.slice(0, 2).join(', ')}`}
            </p>
          )
        )}
        <Button
          variant="primary"
          block
          className="mt-3.5"
          onClick={() => onStartMesoDay(next)}
        >
          Start session
        </Button>
        {alsoToday.map((i) => {
          const d2 = meso.days[i]
          const kind =
            dayKind(d2) === 'cardio'
              ? d2.sections && d2.sections.length > 0
                ? `Intervals · ${fmtSec(totalSec(d2.sections))}`
                : 'Stopwatch'
              : `${d2.exercises.length} exercises`
          return (
            <div
              key={i}
              className="mt-2 flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="truncate text-body font-medium text-ink">
                  {d2.label}
                </div>
                <div className="text-caption text-ink-2">{kind}</div>
              </div>
              <Button
                variant="tonal"
                size="sm"
                onClick={() => onStartMesoDay(i)}
              >
                Start
              </Button>
            </div>
          )
        })}
      </>
    ) : (
      <>
        <p className="text-eyebrow text-ink-2">Today</p>
        <h2 className="mt-0.5 text-title text-ink">Open training</h2>
        <Button
          variant="primary"
          block
          className="mt-3.5"
          onClick={onStartWorkout}
        >
          Start workout
        </Button>
        <Button variant="tonal" block className="mt-2" onClick={onPlan}>
          Plan a mesocycle
        </Button>
      </>
    )

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-title-lg text-ink">
          {greeting(new Date().getHours())}
        </h1>
        {meso && (
          <p className="text-caption text-ink-2">
            Week {week + 1} of {meso.weeks} · {sessionsDone} of{' '}
            {sessionsPlanned} sessions done
          </p>
        )}
      </div>

      {staleBanner && (
        <Banner tone="caution">No strap data for {latestAgeDays} days.</Banner>
      )}

      <Card hero>
        {fresh && score != null && (
          <>
            <div className="flex items-center gap-5">
              <RecoveryRing score={score} size="lg" />
              <div className="min-w-0">
                <p className="text-eyebrow text-ink-2">Readiness</p>
                {verdict && (
                  <p className="mt-0.5 text-body-lg text-ink">{verdict}</p>
                )}
                {vitals.length > 0 && (
                  <p className="mt-1 text-caption text-ink-3">
                    {vitals.join(' · ')}
                  </p>
                )}
              </div>
            </div>
            <div className="my-4 h-px bg-hairline" />
          </>
        )}
        {sessionBlock}
      </Card>

      {fresh && (
        <div className="grid grid-cols-3 gap-3">
          {hrv != null && (
            <MetricTile
              label="HRV"
              value={Math.round(hrv)}
              unit="ms"
              delta={
                hrv30 != null
                  ? `${signed(Math.round(hrv - hrv30))} vs 30 d`
                  : undefined
              }
              deltaTone={
                hrv30 == null || Math.round(hrv - hrv30) === 0
                  ? 'neutral'
                  : hrv > hrv30
                    ? 'up'
                    : 'down'
              }
              values={hrvSeries}
              tone="brand"
            />
          )}
          {rhr != null && (
            <MetricTile
              label="Resting HR"
              value={Math.round(rhr)}
              unit="bpm"
              delta={
                rhr30 != null
                  ? `${signed(Math.round(rhr - rhr30))} vs 30 d`
                  : undefined
              }
              deltaTone={
                rhr30 == null || Math.round(rhr - rhr30) === 0
                  ? 'neutral'
                  : rhr < rhr30
                    ? 'up'
                    : 'down'
              }
              values={rhrSeries}
              tone="effort"
            />
          )}
          {sleep?.inBedMin != null && (
            <MetricTile
              label="Sleep"
              value={fmtSleepClock(sleep.inBedMin)}
              unit="h"
              delta={
                sleep.performancePct != null
                  ? `${Math.round(sleep.performancePct)}% of need`
                  : undefined
              }
              deltaTone="neutral"
              values={sleepSeries}
              tone="rest"
            />
          )}
        </div>
      )}

      <Card>
        <CardHead
          title="This week"
          action={
            meso && !finished ? (
              <StatusPill tone="good" dot={false}>
                {sessionsDone} of {sessionsPlanned}
              </StatusPill>
            ) : undefined
          }
        />
        <div className="mt-4">
          <WeekStrip days={weekDays} />
        </div>
        {pr && (
          <p className="mt-3 text-caption text-ink-3">
            Last PR{' '}
            {new Date(pr.date).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
            })}{' '}
            · {pr.name} {Math.round(pr.e1rm)} lb e1RM
          </p>
        )}
      </Card>
    </div>
  )
}
