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
import { CHECKIN_ITEMS, type Checkin } from '../lib/checkins'
import { confirm } from '../lib/confirm'
import {
  localDate,
  mean,
  withRollingMean,
  type Metrics,
} from '../lib/metrics'
import {
  ROM_TESTS,
  RETEST_DAYS,
  romSummary,
  useRomTests,
  type RomKey,
  type RomTest,
} from '../lib/romtests'
import {
  baselineAt,
  behaviourImpact,
  consistencyPct,
  dailySeries,
  IMPACT_MIN_N,
  weeklyLoad,
  weeklyMinutesByModality,
} from '../lib/wellness'
import { localToday, sortWeights, type WeightEntry } from '../lib/weights'
import type { Modality, SessionRecord, Workout, WorkoutKind } from '../lib/workouts'
import { Banner, type BannerTone } from './cadence/Banner'
import { Button } from './cadence/Button'
import { Card, CardHead } from './cadence/Card'
import { EmptyState } from './cadence/EmptyState'
import {
  Bars,
  ComboChart,
  SERIES,
  SLEEP,
  StackedBars,
  TrendChart,
  ZONES,
  shortDate,
  type ChartTone,
  type TrendPoint,
} from './cadence/charts'
import { Field, TextInput } from './cadence/Field'
import { IconButton } from './cadence/IconButton'
import { List, ListItem } from './cadence/ListItem'
import { StatusPill } from './cadence/StatusPill'
import { LiveHR } from './LiveHR'
import { modalityLabel } from './QuickLog'
import { Chips } from './shell/Chips'
import { IconX } from './shell/icons'
import { Segment } from './shell/Segment'
import { Sheet } from './shell/Sheet'
import { useSheetDismiss } from './shell/useSheetDismiss'

type Group = 'recovery' | 'sleep' | 'strength' | 'running' | 'load' | 'body'

const GROUPS: Array<{ value: Group; label: string }> = [
  { value: 'recovery', label: 'Recovery' },
  { value: 'sleep', label: 'Sleep' },
  { value: 'strength', label: 'Strength' },
  { value: 'running', label: 'Running' },
  { value: 'load', label: 'Load' },
  { value: 'body', label: 'Body' },
]

/** Kind colours, shared by the load chart and the recovery signals. */
const KIND_COLOR: Record<WorkoutKind, string> = {
  strength: 'var(--brand)',
  speed: 'var(--ember)',
  cardio: 'var(--sky)',
  recovery: 'var(--amber)',
}

const KIND_LABEL: Record<WorkoutKind, string> = {
  strength: 'Strength',
  speed: 'Speed',
  cardio: 'Cardio',
  recovery: 'Recovery',
}

/** Recovery-minutes bars, in the order the design calls for. */
const MINUTES_COLORS = [
  'var(--amber)',
  'var(--sky)',
  'var(--brand)',
  'var(--ember)',
  'var(--rose)',
]

const OUTCOME_LABEL: Record<'soreness' | 'fatigue' | 'prs', string> = {
  soreness: 'Soreness',
  fatigue: 'Energy',
  prs: 'Recovered',
}

/** Sleep, energy, soreness, stress: one chart tone each. */
const READINESS_TONE: ChartTone[] = ['brand', 'effort', 'rest', 'caution']

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

/** cm → "toe touch" from "Toe touch" for the compact history line. */
function firstWord(label: string): string {
  return label.split(' ')[0]
}

/**
 * Range-of-motion field tests: the outcome measure for stretching. Read
 * against each test's minimal detectable change, so a within-band wobble
 * is never shown as progress.
 */
function MobilityCard({ api }: { api: Api }) {
  const { tests, save, remove } = useRomTests(api)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const summary = useMemo(() => romSummary(tests), [tests])
  const last = tests[0]
  const daysSince =
    last != null
      ? Math.floor(
          (Date.now() - new Date(`${last.date}T00:00:00`).getTime()) / 86_400_000,
        )
      : null
  const due = daysSince == null || daysSince >= RETEST_DAYS

  return (
    <Card>
      <CardHead
        title="Mobility tests"
        action={
          due ? (
            <StatusPill tone="mid" dot={false}>
              Due
            </StatusPill>
          ) : (
            <span className="text-caption text-ink-3">
              Next in {RETEST_DAYS - (daysSince ?? 0)} d
            </span>
          )
        }
      />
      <p className="mt-1 text-caption text-ink-3">
        {last ? `Last ${daysSince === 0 ? 'today' : `${daysSince} d ago`}` : 'None yet'}
      </p>

      {error && (
        <div className="mt-3">
          <Banner tone="error">{error}</Banner>
        </div>
      )}

      {tests.length > 0 && (
        <div className="mt-4 flex flex-col">
          {summary
            .filter((s) => s.latest != null)
            .map((s, i) => {
              const meta = ROM_TESTS.find((t) => t.key === s.key)!
              return (
                <div key={s.key}>
                  {i > 0 && <div aria-hidden="true" className="h-px bg-hairline" />}
                  <div className="flex items-center justify-between gap-3 py-2">
                    <span className="text-body text-ink">
                      {meta.label}
                      {meta.side === 'L' && ' · Left'}
                      {meta.side === 'R' && ' · Right'}
                    </span>
                    <span className="flex flex-col items-end">
                      <span className="tabular-nums text-body font-medium text-ink">
                        {s.latest} cm
                      </span>
                      {s.delta != null && (
                        <span
                          className={`text-caption ${
                            s.beyondNoise
                              ? s.improved
                                ? 'text-brand-strong'
                                : 'text-rose-strong'
                              : 'text-ink-3'
                          }`}
                        >
                          {s.delta > 0 ? '+' : ''}
                          {s.delta}
                          {s.beyondNoise
                            ? ` · ${s.improved ? 'better' : 'worse'}`
                            : ` · within ±${meta.mdcCm}`}
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              )
            })}
        </div>
      )}

      <div className="mt-4">
        <Button variant="tonal" onClick={() => setOpen(true)}>
          Log a test
        </Button>
      </div>

      {tests.length > 1 && (
        <div className="-mx-5 mt-4">
          <List>
            {tests.slice(0, 8).map((t) => (
              <ListItem
                key={t.date}
                title={shortDate(t.date)}
                sub={ROM_TESTS.filter((m) => typeof t[m.key] === 'number')
                  .map((m) => `${firstWord(m.label)}${m.side ?? ''} ${t[m.key]}`)
                  .join(' · ')}
                action={
                  <IconButton
                    size="sm"
                    label="Delete"
                    onClick={async () => {
                      if (
                        await confirm({ title: 'Delete this test?', action: 'Delete' })
                      ) {
                        remove(t.date).catch(() =>
                          setError('Deleting needs a connection.'),
                        )
                      }
                    }}
                  >
                    <IconX className="h-4 w-4" />
                  </IconButton>
                }
              />
            ))}
          </List>
        </div>
      )}

      {open && (
        <MobilityForm
          onSave={(t) => {
            save(t)
            setOpen(false)
          }}
          onCancel={() => setOpen(false)}
        />
      )}
    </Card>
  )
}

function MobilityForm({
  onSave,
  onCancel,
}: {
  onSave: (t: RomTest) => void
  onCancel: () => void
}) {
  const { open, dismiss, onExited } = useSheetDismiss()
  const [draft, setDraft] = useState<Record<RomKey, string>>({
    toeTouchCm: '',
    kneeToWallLCm: '',
    kneeToWallRCm: '',
    handBehindBackLCm: '',
    handBehindBackRCm: '',
  })
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  function submit() {
    const t: RomTest = { date: localToday() }
    let any = false
    for (const k of Object.keys(draft) as RomKey[]) {
      const raw = draft[k].trim()
      if (raw === '') continue
      const n = Number(raw)
      if (!Number.isFinite(n)) {
        setError('Numbers only, in centimetres.')
        return
      }
      t[k] = Math.round(n * 10) / 10
      any = true
    }
    if (!any) {
      setError('Enter at least one measurement.')
      return
    }
    if (note.trim()) t.note = note.trim()
    dismiss(() => onSave(t))
  }

  return (
    <Sheet open={open} onClose={() => dismiss(onCancel)} onExited={onExited} title="Mobility test">
      <div className="flex flex-col gap-4">
        {ROM_TESTS.map((t) => (
          <Field
            key={t.key}
            label={`${t.label}${t.side === 'L' ? ' · Left' : t.side === 'R' ? ' · Right' : ''}`}
            help={`${t.how} ±${t.mdcCm} cm noise.`}
          >
            <TextInput
              type="number"
              inputMode="decimal"
              step="0.5"
              placeholder="cm"
              value={draft[t.key]}
              onChange={(e) => setDraft({ ...draft, [t.key]: e.target.value })}
            />
          </Field>
        ))}
        <Field label="Notes">
          <TextInput value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {error && <Banner tone="error">{error}</Banner>}
        <Button variant="primary" block onClick={submit}>
          Save
        </Button>
        <Button variant="ghost" block onClick={() => dismiss(onCancel)}>
          Cancel
        </Button>
      </div>
    </Sheet>
  )
}

export function Trends({
  api,
  workouts,
  sessions,
  lookup,
  weights,
  onWeightsChange,
  checkins,
}: {
  api: Api
  workouts: Workout[]
  sessions: SessionRecord[]
  lookup: (name: string) => string | undefined
  weights: WeightEntry[]
  onWeightsChange: (entries: WeightEntry[]) => void
  checkins: Checkin[]
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

  // ---- readiness, recovery minutes and what-helps, from the log ----

  // One small multiple per item: four integer series on one chart read as
  // noise. Gaps stay gaps; the dashed line is the 28-day personal baseline
  // once it has a week behind it.
  const readiness = useMemo(() => {
    const today = localToday()
    return CHECKIN_ITEMS.map((it, i) => {
      const series = dailySeries(checkins, it.key, 60, today)
      const points: TrendPoint[] = series.map((p, j) => {
        const b = baselineAt(series, j)
        return {
          date: p.date,
          value: p.value,
          baseline: b && b.n >= 7 ? Math.round(b.mean * 10) / 10 : null,
        }
      })
      const latest = [...series].reverse().find((p) => p.value != null)
      return {
        ...it,
        points,
        latest: latest?.value ?? null,
        tone: READINESS_TONE[i],
      }
    })
  }, [checkins])
  const hasReadiness = readiness.some((r) => r.latest != null)

  const recoveryMinutes = useMemo(
    () => weeklyMinutesByModality(workouts, 12),
    [workouts],
  )

  const impacts = useMemo(
    () => behaviourImpact(workouts, checkins, localToday()),
    [workouts, checkins],
  )
  const impactModalities = [...new Set(impacts.map((r) => r.modality))]

  // ---- which group ----

  const settled = metrics != null || apiError != null
  const hasRecovery = recoverySeries.length > 0
  const hasCheckin = checkins.length > 0
  const hasRecoveryWorkout = workouts.some((w) => w.kind === 'recovery')
  // Recovery leads whenever there is a wearable-free or strap signal at all;
  // an account with none of those opens on Strength instead.
  const group: Group =
    picked ??
    (settled && !hasRecovery && !hasCheckin && !hasRecoveryWorkout
      ? 'strength'
      : 'recovery')
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
    const readinessCard = hasReadiness && (
      <Card>
        <CardHead title="Readiness" />
        <p className="mt-1 text-caption text-ink-3">1 to 5, higher is better</p>
        <div className="mt-3 flex flex-col gap-3">
          {readiness.map((r) => (
            <div key={r.key}>
              <div className="flex items-baseline justify-between">
                <span className="text-caption font-semibold text-ink-2">
                  {r.label}
                </span>
                <span className="text-caption tabular-nums text-ink-3">
                  {r.latest ?? '—'}
                  <span className="text-ink-4">/5</span>
                </span>
              </div>
              <TrendChart
                data={r.points}
                tone={r.tone}
                unit=""
                domain={[1, 5]}
                ticks={[1, 3, 5]}
                height={96}
                baselineLabel="28 d baseline"
                connectNulls={false}
                animate={false}
              />
            </div>
          ))}
        </div>
      </Card>
    )

    const recoveryMinutesCard = recoveryMinutes.modalities.length > 0 && (
      <Card>
        <CardHead
          title="Recovery minutes"
          action={
            <StatusPill tone="mid" dot={false}>
              {consistencyPct(workouts, localToday())}% of 28 d
            </StatusPill>
          }
        />
        <div className="mt-4">
          <StackedBars
            data={recoveryMinutes.rows}
            keys={recoveryMinutes.modalities.map((m, i) => ({
              key: m,
              label: modalityLabel(m as Modality),
              color: MINUTES_COLORS[i % MINUTES_COLORS.length],
            }))}
            unit="min"
            xKey="week"
            formatX={(x) => x}
          />
        </div>
      </Card>
    )

    const whatHelpsCard = (
      <Card>
        <CardHead title="What helps" />
        <p className="mt-1 text-caption text-ink-3">
          Next morning, with a session the day before vs without
        </p>
        {impacts.length === 0 ? (
          <p className="mt-4 text-body text-ink-2">
            Needs {IMPACT_MIN_N} or more mornings with and without, in 90 days.
          </p>
        ) : (
          <div className="mt-4 flex flex-col">
            {impactModalities.map((m, i) => (
              <div key={m}>
                {i > 0 && (
                  <div aria-hidden="true" className="my-3 h-px bg-hairline" />
                )}
                <p className="text-body font-medium text-ink">
                  {modalityLabel(m as Modality)}
                </p>
                <div className="mt-1 flex flex-col gap-1">
                  {impacts
                    .filter((r) => r.modality === m)
                    .map((r) => (
                      <p key={r.outcome} className="text-caption text-ink-2">
                        {OUTCOME_LABEL[r.outcome]}{' '}
                        <span
                          className={
                            r.diff > 0
                              ? 'font-semibold text-brand-strong'
                              : r.diff < 0
                                ? 'font-semibold text-rose-strong'
                                : 'font-semibold text-ink-3'
                          }
                        >
                          {r.diff > 0 ? '+' : ''}
                          {r.diff}
                        </span>{' '}
                        <span className="text-ink-3">
                          {r.meanWith} vs {r.meanWithout} · n {r.nWith} vs{' '}
                          {r.nWithout}
                        </span>
                      </p>
                    ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    )

    let strapCards: React.ReactNode
    if (!settled) {
      strapCards = <p className="py-8 text-center text-caption text-ink-3">Loading</p>
    } else if (!hasRecovery) {
      strapCards = strapEmpty
      connectCard = false
    } else {
      strapCards = (
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

    cards = (
      <>
        {readinessCard}
        {recoveryMinutesCard}
        {whatHelpsCard}
        {strapCards}
      </>
    )
  } else if (group === 'sleep') {
    if (!settled) {
      cards = <p className="py-8 text-center text-caption text-ink-3">Loading</p>
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
    if (exercises.length === 0) {
      cards = (
        <EmptyState
          title="No strength yet"
          caption="Log a session to see it here."
        />
      )
    } else {
      cards = (
        <>
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
          <EmptyState title="No runs yet" caption="Log a run or intervals." />
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
  } else if (group === 'load') {
    const load = weeklyLoad(workouts, 8)
    const ratedAny = load.some((w) => w.rated > 0)
    if (!ratedAny) {
      cards = (
        <EmptyState
          title="No load yet"
          caption="Rate a session's effort to see it here."
        />
      )
    } else {
      const thisWeek = load[load.length - 1]
      const lastWeek = load[load.length - 2]
      const weekChange =
        lastWeek && lastWeek.load > 0
          ? Math.round(((thisWeek.load - lastWeek.load) / lastWeek.load) * 100)
          : null
      const loadKinds = (
        ['strength', 'speed', 'cardio', 'recovery'] as WorkoutKind[]
      ).filter((k) => load.some((w) => (w.byKind[k] ?? 0) > 0))
      cards = (
        <>
          <Card>
            <CardHead title="Training load" />
            <p className="mt-1 text-caption text-ink-3">Effort × minutes per week</p>
            <div className="mt-4">
              <StackedBars
                data={load.map((w) => ({ week: w.label, ...w.byKind }))}
                keys={loadKinds.map((k) => ({
                  key: k,
                  label: KIND_LABEL[k],
                  color: KIND_COLOR[k],
                }))}
                unit=""
                xKey="week"
                formatX={(x) => x}
              />
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <Well
                label="This week"
                value={thisWeek.load.toLocaleString()}
                sub={
                  weekChange != null
                    ? `${weekChange >= 0 ? '+' : ''}${weekChange}% vs last week`
                    : undefined
                }
              />
              <Well
                label="Monotony"
                value={thisWeek.monotony != null ? thisWeek.monotony.toLocaleString() : '—'}
              />
              <Well
                label="Strain"
                value={thisWeek.strain != null ? thisWeek.strain.toLocaleString() : '—'}
              />
            </div>
            <p className="mt-3 text-caption text-ink-3">
              {thisWeek.rated} of {thisWeek.sessions} rated this week
            </p>
          </Card>
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
        </>
      )
    }
  } else {
    cards = (
      <>
        <BodyCard
          api={api}
          entries={weights}
          onChange={onWeightsChange}
          whoopLb={me?.whoop.bodyWeightLb}
        />
        <MobilityCard api={api} />
      </>
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
