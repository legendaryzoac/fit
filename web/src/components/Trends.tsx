import { useEffect, useId, useMemo, useState } from 'react'
import {
  bedtimeSeries,
  drillsByFrequency,
  e1rmSeries,
  exerciseDetail,
  exercisesByFrequency,
  loadVsRecovery,
  personalRecords,
  recoveryByWeekday,
  runSeries,
  sprintSeries,
  weeklyVolume,
  weeklyZones,
} from '../lib/analytics'
import type { Api } from '../lib/api'
import {
  localDate,
  mean,
  withRollingMean,
  type Metrics,
} from '../lib/metrics'
import { localToday, sortWeights, type WeightEntry } from '../lib/weights'
import type { SessionRecord, Workout } from '../lib/workouts'
import { Banner, type BannerTone } from './cadence/Banner'
import { Button } from './cadence/Button'
import { Card, CardHead } from './cadence/Card'
import {
  Bars,
  ComboChart,
  SERIES,
  SLEEP,
  StackedBars,
  TrendChart,
  ZONES,
  shortDate,
  type TrendPoint,
} from './cadence/charts'
import { Field, TextInput } from './cadence/Field'
import { List, ListItem } from './cadence/ListItem'
import { LiveHR } from './LiveHR'
import { Chips } from './shell/Chips'
import { Segment } from './shell/Segment'

type Group = 'recovery' | 'sleep' | 'strength' | 'running' | 'body'

const GROUPS: Array<{ value: Group; label: string }> = [
  { value: 'recovery', label: 'Recovery' },
  { value: 'sleep', label: 'Sleep' },
  { value: 'strength', label: 'Strength' },
  { value: 'running', label: 'Running' },
  { value: 'body', label: 'Body' },
]

type Range = '30' | '90' | '180'

const RANGES: Array<{ value: Range; label: string }> = [
  { value: '30', label: '30 d' },
  { value: '90', label: '90 d' },
  { value: '180', label: '180 d' },
]

type Me = {
  createdAt: string
  whoop: {
    connected: boolean
    status?: 'active' | 'error'
    lastSyncAt?: string | null
    backfillDone?: boolean
    bodyWeightLb?: number
  }
}

interface SleepPoint {
  date: string
  deep: number
  rem: number
  light: number
  awake: number
}

const SLEEP_KEYS = [
  { key: 'deep', label: 'Deep', color: SLEEP.deep },
  { key: 'rem', label: 'REM', color: SLEEP.rem },
  { key: 'light', label: 'Light', color: SLEEP.light },
  { key: 'awake', label: 'Awake', color: SLEEP.awake },
]

const ZONE_KEYS = ZONES.map((color, i) => ({
  key: `z${i + 1}`,
  label: `Zone ${i + 1}`,
  color,
}))

/** The WHOOP OAuth redirect lands here with its result in the query. */
function whoopLanding(): {
  group: Group | null
  banner: { tone: BannerTone; text: string } | null
} {
  const q = new URLSearchParams(window.location.search)
  const whoop = q.get('whoop')
  if (whoop === 'connected') {
    return {
      group: 'recovery',
      banner: { tone: 'info', text: 'Strap connected. History is syncing.' },
    }
  }
  if (whoop === 'error') {
    const reason = q.get('reason') ?? 'unknown'
    const detail = q.get('detail')
    return {
      group: 'recovery',
      banner: {
        tone: 'error',
        text: `Connection failed (${reason}${detail ? `: ${detail}` : ''}).`,
      },
    }
  }
  return { group: null, banner: null }
}

function recoveryTone(score: number): string {
  if (score >= 67) return 'text-brand-strong'
  if (score >= 34) return 'text-amber-strong'
  return 'text-rose-strong'
}

/** Decimal clock hours as "07:42"; negatives wrap back before midnight. */
function clock(v: number): string {
  const h = ((v % 24) + 24) % 24
  const hh = Math.floor(h)
  const mm = Math.round((h - hh) * 60)
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

function Well({
  label,
  value,
  unit,
  sub,
  tone = 'text-ink',
}: {
  label: string
  value: string
  unit?: string
  sub?: string
  tone?: string
}) {
  return (
    <div className="rounded-md bg-surface-2 p-3.5">
      <p className="text-eyebrow text-ink-2">{label}</p>
      <p className="mt-1 flex items-baseline gap-1">
        <span className={`text-numeric-lg ${tone}`}>{value}</span>
        {unit && (
          <span className="text-caption font-semibold text-ink-2">{unit}</span>
        )}
      </p>
      {sub && <p className="text-caption text-ink-3">{sub}</p>}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <p className="text-body text-ink-2">{children}</p>
    </Card>
  )
}

/**
 * Manual body-weight log. A typed entry always outranks the strap's
 * measurement, which keeps bodyweight lifts honest once a strap goes away.
 */
function BodyCard({
  api,
  entries,
  onChange,
  whoopLb,
}: {
  api: Api
  entries: WeightEntry[]
  onChange: (entries: WeightEntry[]) => void
  whoopLb?: number
}) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const weightId = useId()

  const sorted = useMemo(() => sortWeights(entries), [entries])
  /** Oldest-first for the trend chart. */
  const trend = useMemo(
    () => [...sorted].reverse().map((e) => ({ date: e.date, value: e.lb })),
    [sorted],
  )
  const newest = sorted[0]
  const prior = sorted.find((e) => e.date !== newest?.date)
  const delta =
    newest && prior ? Math.round((newest.lb - prior.lb) * 10) / 10 : null

  function save() {
    const lb = Number(draft)
    if (!Number.isFinite(lb) || lb < 40 || lb > 1200) {
      setError('Enter a weight between 40 and 1200 lb.')
      return
    }
    const entry: WeightEntry = {
      date: localToday(),
      lb: Math.round(lb * 10) / 10,
    }
    // Optimistic — one entry per day, today's overwrites
    onChange([...entries.filter((e) => e.date !== entry.date), entry])
    setDraft('')
    setError(null)
    void api
      .send('POST', '/api/weights', entry)
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status))
      })
      .catch(() => setError('Saved locally. Syncs when online.'))
  }

  const field = (
    <Field label="Weight" htmlFor={weightId} error={error ?? undefined}>
      <div className="flex gap-2">
        <TextInput
          id={weightId}
          type="number"
          inputMode="decimal"
          step="0.1"
          placeholder={newest ? String(newest.lb) : 'lb'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
        <Button variant="tonal" size="sm" className="shrink-0" onClick={save}>
          Log
        </Button>
      </div>
    </Field>
  )

  if (!newest) {
    return (
      <Card>
        <p className="text-body text-ink-2">Log a weight.</p>
        {whoopLb != null && (
          <>
            <p className="mt-3 flex items-baseline gap-1.5">
              <span className="text-display-lg text-ink">{whoopLb}</span>
              <span className="text-title-sm text-ink-2">lb</span>
            </p>
            <p className="text-caption text-ink-3">From strap</p>
          </>
        )}
        <div className="mt-4">{field}</div>
      </Card>
    )
  }

  return (
    <Card>
      <CardHead title="Body weight" />
      <p className="mt-3 flex items-baseline gap-1.5">
        <span className="text-display-lg text-ink">{newest.lb}</span>
        <span className="text-title-sm text-ink-2">lb</span>
      </p>
      <p className="text-caption text-ink-3">
        {shortDate(newest.date)}
        {delta != null && (
          <span className={delta > 0 ? ' text-brand-strong' : ''}>
            {' · '}
            {delta > 0 ? '+' : ''}
            {delta} since last
          </span>
        )}
      </p>
      {trend.length > 1 && (
        <div className="mt-4">
          <TrendChart
            data={trend}
            tone="brand"
            unit="lb"
            height={160}
            animate={false}
          />
        </div>
      )}
      <div className="mt-4">{field}</div>
      {sorted.length > 1 && (
        <div className="-mx-5 mt-3">
          <List>
            {sorted.slice(0, 8).map((e) => (
              <ListItem
                key={e.date}
                title={shortDate(e.date)}
                trail={`${e.lb} lb`}
              />
            ))}
          </List>
        </div>
      )}
    </Card>
  )
}

export function Trends({
  api,
  workouts,
  sessions,
  lookup,
  weights,
  onWeightsChange,
}: {
  api: Api
  workouts: Workout[]
  sessions: SessionRecord[]
  lookup: (name: string) => string | undefined
  weights: WeightEntry[]
  onWeightsChange: (entries: WeightEntry[]) => void
}) {
  const [landing] = useState(whoopLanding)
  const [picked, setPicked] = useState<Group | null>(landing.group)
  const [me, setMe] = useState<Me | null>(null)
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [days, setDays] = useState<Range>('90')
  const [apiError, setApiError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [exercise, setExercise] = useState<string | null>(null)
  const [drill, setDrill] = useState<string | null>(null)

  useEffect(() => {
    if (landing.banner) window.history.replaceState(null, '', '/')
  }, [landing])

  useEffect(() => {
    api
      .get('/api/me')
      .then(async (res) => {
        if (!res.ok) throw new Error(`API responded ${res.status}`)
        setMe(await res.json())
      })
      .catch((err: Error) => setApiError(err.message))
  }, [api])

  useEffect(() => {
    setMetrics(null)
    api
      .get(`/api/metrics?days=${days}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`API responded ${res.status}`)
        setMetrics(await res.json())
      })
      .catch((err: Error) => setApiError(err.message))
  }, [api, days])

  async function connect() {
    setConnecting(true)
    try {
      const res = await api.get('/api/whoop/connect')
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `API responded ${res.status}`)
      window.location.assign(body.url)
    } catch (err) {
      setApiError(err instanceof Error ? err.message : 'Could not start connect')
      setConnecting(false)
    }
  }

  // ---- recovery and sleep, from the strap ----

  const recoverySeries = useMemo(() => {
    if (!metrics) return []
    const byDate = new Map<
      string,
      { date: string; score: number | null; hrv: number | null; rhr: number | null }
    >()
    for (const r of metrics.recoveries) {
      if (r.recoveryScore == null) continue
      byDate.set(r.date.slice(0, 10), {
        date: r.date.slice(0, 10),
        score: r.recoveryScore,
        hrv: r.hrvMs ?? null,
        rhr: r.rhr ?? null,
      })
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
  }, [metrics])

  const hrvSeries: TrendPoint[] = useMemo(
    () =>
      withRollingMean(recoverySeries, 'hrv', 'baseline', 30).map((p) => ({
        date: p.date,
        value: p.hrv,
        baseline: p.baseline,
      })),
    [recoverySeries],
  )
  const rhrSeries: TrendPoint[] = useMemo(
    () =>
      withRollingMean(recoverySeries, 'rhr', 'baseline', 30).map((p) => ({
        date: p.date,
        value: p.rhr,
        baseline: p.baseline,
      })),
    [recoverySeries],
  )
  const scoreSeries: TrendPoint[] = useMemo(
    () =>
      withRollingMean(recoverySeries, 'score', 'baseline', 7).map((p) => ({
        date: p.date,
        value: p.score,
        baseline: p.baseline,
      })),
    [recoverySeries],
  )

  const sleepSeries: SleepPoint[] = useMemo(() => {
    if (!metrics) return []
    const byDate = new Map<string, SleepPoint & { inBed: number }>()
    for (const s of metrics.sleeps) {
      if (s.nap || s.deepMin == null) continue
      const date = localDate(s.end, s.timezoneOffset)
      const inBed = s.inBedMin ?? 0
      const existing = byDate.get(date)
      if (existing && existing.inBed >= inBed) continue
      byDate.set(date, {
        date,
        inBed,
        deep: (s.deepMin ?? 0) / 60,
        rem: (s.remMin ?? 0) / 60,
        light: (s.lightMin ?? 0) / 60,
        awake: (s.awakeMin ?? 0) / 60,
      })
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
  }, [metrics])

  const sleepPerfSeries: TrendPoint[] = useMemo(() => {
    if (!metrics) return []
    const points = metrics.sleeps
      .filter((s) => !s.nap && s.performancePct != null)
      .map((s) => ({
        date: localDate(s.end, s.timezoneOffset),
        perf: s.performancePct as number,
      }))
      .sort((a, b) => a.date.localeCompare(b.date))
    return withRollingMean(points, 'perf', 'baseline', 30).map((p) => ({
      date: p.date,
      value: p.perf,
      baseline: p.baseline,
    }))
  }, [metrics])

  const bedtimes = useMemo(
    () => (metrics ? bedtimeSeries(metrics.sleeps).slice(-45) : []),
    [metrics],
  )
  const weekdays = useMemo(
    () => (metrics ? recoveryByWeekday(metrics.recoveries) : []),
    [metrics],
  )
  const overlay = useMemo(
    () => (metrics ? loadVsRecovery(metrics.recoveries, metrics.cycles) : []),
    [metrics],
  )

  const latest = recoverySeries.at(-1)
  /** Days since the newest recovery record — drives the stale banner. */
  const staleDays =
    latest?.date != null
      ? Math.floor((Date.now() - new Date(latest.date).getTime()) / 86_400_000)
      : null
  const hrv30 = mean(
    recoverySeries.slice(-30).flatMap((p) => (p.hrv == null ? [] : [p.hrv])),
  )
  const rhr30 = mean(
    recoverySeries.slice(-30).flatMap((p) => (p.rhr == null ? [] : [p.rhr])),
  )
  const lastSleep = sleepPerfSeries.at(-1)

  const delta = (value: number | null | undefined, base: number | null) =>
    value == null || base == null
      ? undefined
      : `${value - base >= 0 ? '+' : ''}${Math.round((value - base) * 10) / 10} vs 30 d`

  // ---- strength and running, from the log ----

  const exercises = useMemo(() => exercisesByFrequency(workouts), [workouts])
  const activeExercise = exercise ?? exercises[0] ?? null
  const e1rm = useMemo(
    () => (activeExercise ? e1rmSeries(workouts, activeExercise) : []),
    [workouts, activeExercise],
  )
  const prs = useMemo(() => personalRecords(workouts), [workouts])
  const volume = useMemo(() => weeklyVolume(workouts, lookup), [workouts, lookup])
  const detail = useMemo(
    () => (activeExercise ? exerciseDetail(workouts, activeExercise) : []),
    [workouts, activeExercise],
  )
  const currentPr = activeExercise
    ? prs.find((p) => p.exercise === activeExercise)
    : undefined

  const drills = useMemo(() => drillsByFrequency(workouts), [workouts])
  const activeDrill = drill ?? drills[0] ?? null
  const sprints = useMemo(
    () => (activeDrill ? sprintSeries(workouts, activeDrill) : []),
    [workouts, activeDrill],
  )
  const runs = useMemo(() => runSeries(sessions), [sessions])
  const zones = useMemo(() => weeklyZones(sessions), [sessions])

  // ---- which group ----

  const settled = metrics != null || apiError != null
  const hasRecovery = recoverySeries.length > 0
  // Recovery leads; an account with no strap data at all opens on Strength.
  const group: Group =
    picked ?? (settled && !hasRecovery ? 'strength' : 'recovery')
  const connected = me?.whoop.connected === true
  const showConnect = me != null && !connected

  const range = (
    <Segment options={RANGES} value={days} onChange={setDays} ariaLabel="Range" />
  )

  const connectButton = me && (
    <Button
      variant="tonal"
      onClick={connect}
      disabled={connecting}
      className="self-start"
    >
      {me.whoop.status === 'error' ? 'Reconnect' : 'Connect'}
    </Button>
  )

  const strapEmpty = (
    <Card>
      <p className="text-body text-ink-2">
        {connected ? 'No strap data yet.' : 'Connect a strap to see recovery.'}
      </p>
      {showConnect && <div className="mt-4 flex">{connectButton}</div>}
    </Card>
  )

  let cards: React.ReactNode
  // The strap groups carry their own connect button in the empty state.
  let connectCard = showConnect

  if (group === 'recovery') {
    if (!settled) {
      cards = <p className="py-8 text-center text-body text-ink-3">Loading</p>
    } else if (!hasRecovery) {
      cards = strapEmpty
      connectCard = false
    } else {
      cards = (
        <>
          <Card>
            <CardHead title="Recovery" action={range} />
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Well
                label="Recovery"
                value={latest?.score != null ? String(latest.score) : '—'}
                unit="%"
                sub={latest?.date ? shortDate(latest.date) : undefined}
                tone={latest?.score != null ? recoveryTone(latest.score) : undefined}
              />
              <Well
                label="HRV"
                value={latest?.hrv != null ? String(Math.round(latest.hrv)) : '—'}
                unit="ms"
                sub={delta(latest?.hrv, hrv30)}
              />
              <Well
                label="Resting HR"
                value={latest?.rhr != null ? String(Math.round(latest.rhr)) : '—'}
                unit="bpm"
                sub={delta(latest?.rhr, rhr30)}
              />
              <Well
                label="Sleep"
                value={
                  lastSleep?.value != null ? String(Math.round(lastSleep.value)) : '—'
                }
                unit="%"
                sub={lastSleep?.date ? shortDate(lastSleep.date) : undefined}
              />
            </div>
            <div className="mt-4">
              <TrendChart
                data={scoreSeries}
                tone="brand"
                unit="%"
                domain={[0, 100]}
                baselineLabel="7 d baseline"
              />
            </div>
          </Card>
          <Card>
            <CardHead title="HRV" />
            <div className="mt-4">
              <TrendChart
                data={hrvSeries}
                tone="rest"
                unit="ms"
                baselineLabel="30 d baseline"
              />
            </div>
          </Card>
          <Card>
            <CardHead title="Resting heart rate" />
            <div className="mt-4">
              <TrendChart
                data={rhrSeries}
                tone="effort"
                unit="bpm"
                baselineLabel="30 d baseline"
              />
            </div>
          </Card>
          {weekdays.length > 1 && (
            <Card>
              <CardHead title="Recovery by weekday" />
              <div className="mt-4">
                <Bars
                  data={weekdays}
                  xKey="day"
                  dataKey="avg"
                  unit="%"
                  domain={[0, 100]}
                  formatX={(d) => d}
                  extra={(r) => `${String(r.nights)} nights`}
                />
              </div>
            </Card>
          )}
        </>
      )
    }
  } else if (group === 'sleep') {
    if (!settled) {
      cards = <p className="py-8 text-center text-body text-ink-3">Loading</p>
    } else if (!hasRecovery) {
      cards = strapEmpty
      connectCard = false
    } else {
      cards = (
        <>
          <Card>
            <CardHead title="Sleep stages" action={range} />
            <div className="mt-4">
              <StackedBars
                data={sleepSeries}
                keys={SLEEP_KEYS}
                unit="h"
                xKey="date"
              />
            </div>
          </Card>
          <Card>
            <CardHead title="Sleep performance" />
            <div className="mt-4">
              <TrendChart
                data={sleepPerfSeries}
                tone="rest"
                unit="%"
                domain={[0, 100]}
                baselineLabel="30 d baseline"
              />
            </div>
          </Card>
          {bedtimes.length > 1 && (
            <Card>
              <CardHead title="Bedtime" />
              <div className="mt-4">
                <ComboChart
                  data={bedtimes}
                  series={[
                    {
                      key: 'bed',
                      label: 'Bed',
                      color: 'var(--sky)',
                      kind: 'line',
                      format: clock,
                    },
                    {
                      key: 'wake',
                      label: 'Wake',
                      color: 'var(--ink-3)',
                      kind: 'line',
                      strokeWidth: 1.5,
                      format: clock,
                    },
                  ]}
                  left={{ format: clock, width: 48 }}
                />
              </div>
            </Card>
          )}
        </>
      )
    }
  } else if (group === 'strength') {
    if (exercises.length === 0 && overlay.length === 0) {
      cards = <Empty>Log a session to see strength.</Empty>
    } else {
      cards = (
        <>
          {overlay.length > 0 && (
            <Card>
              <CardHead title="Load and recovery" action={range} />
              <div className="mt-4">
                <ComboChart
                  data={overlay}
                  height={220}
                  series={[
                    {
                      key: 'strain',
                      label: 'Strain',
                      color: 'var(--ember)',
                      kind: 'bar',
                    },
                    {
                      key: 'recovery',
                      label: 'Recovery',
                      color: 'var(--brand)',
                      kind: 'line',
                      axis: 'right',
                      unit: '%',
                    },
                  ]}
                  left={{ domain: [0, 21] }}
                  right={{ domain: [0, 100] }}
                />
              </div>
            </Card>
          )}
          {exercises.length > 0 && (
            <Card>
              <CardHead title="Estimated 1RM" />
              <div className="mt-3 flex flex-col gap-3">
                <Chips
                  options={exercises.slice(0, 8).map((n) => ({ value: n, label: n }))}
                  value={activeExercise ?? exercises[0]}
                  onChange={setExercise}
                  ariaLabel="Exercise"
                />
                {currentPr && (
                  <p className="text-caption text-ink-3">
                    PR {currentPr.bestE1rm} lb · {currentPr.bestSet} ·{' '}
                    {shortDate(currentPr.date)}
                  </p>
                )}
                {e1rm.length > 1 ? (
                  <TrendChart
                    data={e1rm.map((p) => ({ date: p.date, value: p.e1rm }))}
                    tone="brand"
                    unit="lb"
                  />
                ) : (
                  <p className="text-caption text-ink-3">One session so far.</p>
                )}
              </div>
            </Card>
          )}
          {prs.length > 0 && (
            <Card>
              <CardHead title="Personal records" />
              <div className="-mx-5 mt-2">
                <List>
                  {prs.map((pr) => (
                    <ListItem
                      key={pr.exercise}
                      title={pr.exercise}
                      sub={`${shortDate(pr.date)} · ${pr.bestSet}`}
                      trail={`${pr.bestE1rm} lb`}
                    />
                  ))}
                </List>
              </div>
            </Card>
          )}
          {exercises.length > 0 && (
            <Card>
              <CardHead title="Exercise" />
              <p className="mt-1 text-caption text-ink-3">{activeExercise}</p>
              <div className="mt-4">
                {detail.length > 0 ? (
                  <ComboChart
                    data={detail}
                    height={220}
                    series={[
                      {
                        key: 'volume',
                        label: 'Volume',
                        color: 'var(--sky)',
                        kind: 'bar',
                        unit: 'lb',
                      },
                      {
                        key: 'topWeight',
                        label: 'Top set',
                        color: 'var(--brand)',
                        kind: 'line',
                        axis: 'right',
                        unit: 'lb',
                      },
                      {
                        key: 'e1rm',
                        label: 'e1RM',
                        color: 'var(--ink-3)',
                        kind: 'line',
                        axis: 'right',
                        unit: 'lb',
                        dashed: true,
                        strokeWidth: 1,
                      },
                    ]}
                  />
                ) : (
                  <p className="text-caption text-ink-3">No weighted sets.</p>
                )}
              </div>
            </Card>
          )}
          {volume.rows.length > 0 && (
            <Card>
              <CardHead title="Weekly volume" />
              <div className="mt-4">
                <StackedBars
                  data={volume.rows}
                  keys={volume.muscles.map((m, i) => ({
                    key: m,
                    label: m,
                    color: SERIES[i % SERIES.length],
                  }))}
                  unit="lb"
                  xKey="week"
                />
              </div>
            </Card>
          )}
        </>
      )
    }
  } else if (group === 'running') {
    cards = (
      <>
        {drills.length === 0 && runs.length <= 1 && zones.length === 0 && (
          <Empty>Log a run or intervals.</Empty>
        )}
        {drills.length > 0 && (
          <Card>
            <CardHead title="Speed" />
            <div className="mt-3 flex flex-col gap-3">
              <Chips
                options={drills.slice(0, 6).map((n) => ({ value: n, label: n }))}
                value={activeDrill ?? drills[0]}
                onChange={setDrill}
                ariaLabel="Drill"
              />
              {sprints.length > 1 ? (
                <TrendChart
                  data={sprints.map((p) => ({ date: p.date, value: p.bestSec }))}
                  tone="effort"
                  unit="s"
                  height={180}
                />
              ) : (
                <p className="text-caption text-ink-3">One session so far.</p>
              )}
            </div>
          </Card>
        )}
        {runs.length > 1 && (
          <Card>
            <CardHead title="Running efficiency" />
            <div className="mt-4">
              <ComboChart
                data={runs}
                series={[
                  {
                    key: 'paceMinMi',
                    label: 'Pace',
                    color: 'var(--ember)',
                    kind: 'line',
                    unit: 'min/mi',
                  },
                  {
                    key: 'avgHr',
                    label: 'Heart rate',
                    color: 'var(--sky)',
                    kind: 'line',
                    axis: 'right',
                    unit: 'bpm',
                    strokeWidth: 1.5,
                  },
                ]}
                left={{ reversed: true }}
              />
            </div>
          </Card>
        )}
        {zones.length > 0 && (
          <Card>
            <CardHead title="Heart-rate zones" />
            <div className="mt-4">
              <StackedBars data={zones} keys={ZONE_KEYS} unit="h" xKey="week" />
            </div>
          </Card>
        )}
      </>
    )
  } else {
    cards = (
      <BodyCard
        api={api}
        entries={weights}
        onChange={onWeightsChange}
        whoopLb={me?.whoop.bodyWeightLb}
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-title-lg text-ink">Trends</h1>
      <Chips options={GROUPS} value={group} onChange={setPicked} ariaLabel="Trends" />

      {landing.banner && (
        <Banner tone={landing.banner.tone}>{landing.banner.text}</Banner>
      )}
      {apiError && <Banner tone="error">{apiError}</Banner>}
      {/* Connected but silent — a lapsed subscription or a shelved strap
          stops producing records without ever failing a token refresh. */}
      {connected && staleDays != null && staleDays > 3 && (
        <Banner tone="caution">No strap data for {staleDays} days.</Banner>
      )}

      {cards}

      {connectCard && (
        <Card>
          <p className="text-title-sm text-ink">Connect a strap</p>
          <p className="mt-1 text-caption text-ink-2">Optional.</p>
          <div className="mt-4 flex">{connectButton}</div>
        </Card>
      )}

      {group === 'running' && <LiveHR />}
    </div>
  )
}
