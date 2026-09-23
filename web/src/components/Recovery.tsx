import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { bedtimeSeries, recoveryByWeekday } from '../lib/analytics'
import type { Api } from '../lib/api'
import type { Checkin } from '../lib/checkins'
import {
  localDate,
  mean,
  withRollingMean,
  type Metrics,
} from '../lib/metrics'
import {
  RETEST_DAYS,
  ROM_TESTS,
  romSummary,
  useRomTests,
  type RomKey,
  type RomTest,
} from '../lib/romtests'
import { localToday } from '../lib/weights'
import { consistencyPct, localDay, recoveryDays } from '../lib/wellness'
import { loadWorkoutCache, type Workout } from '../lib/workouts'
import {
  SleepStagesChart,
  squareDot,
  StatCard,
  TrendChart,
  type SleepPoint,
  type TrendPoint,
} from './Charts'
import { BodyWeight } from './BodyWeight'
import { CheckinCard } from './Checkin'
import { buttonClass, Card, inputClass } from './ui'

/**
 * Mobility field tests: log every few weeks, read against each test's
 * minimal detectable change. A change inside the band is noise and is
 * shown as such; nothing here is ever called progress without clearing it.
 */
function MobilityTests({
  tests,
  onSave,
  onDelete,
}: {
  tests: RomTest[]
  onSave: (t: RomTest) => void
  onDelete: (date: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Record<RomKey, string>>({
    toeTouchCm: '',
    kneeToWallLCm: '',
    kneeToWallRCm: '',
    handBehindBackLCm: '',
    handBehindBackRCm: '',
  })
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const summary = romSummary(tests)
  const last = tests[0]
  const daysSince = last
    ? Math.floor(
        (Date.now() - new Date(`${last.date}T00:00:00`).getTime()) / 86_400_000,
      )
    : null
  const due = daysSince == null || daysSince >= RETEST_DAYS

  function save() {
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
    onSave(t)
    setOpen(false)
    setError(null)
    setNote('')
    setDraft({
      toeTouchCm: '',
      kneeToWallLCm: '',
      kneeToWallRCm: '',
      handBehindBackLCm: '',
      handBehindBackRCm: '',
    })
  }

  const fmt = (v: number | null) => (v == null ? '—' : `${v} cm`)

  return (
    <section className="border-t-2 border-ink/40 pt-2.5">
      <div className="mb-1.5 flex items-baseline justify-between">
        <p className="kicker">Mobility tests</p>
        <span className="text-[9px] font-semibold tracking-widest text-ink/45">
          {last ? `LAST ${daysSince === 0 ? 'TODAY' : `${daysSince}D AGO`}` : 'NONE YET'}
          {due ? ' · DUE' : ''}
        </span>
      </div>

      {tests.length > 0 && (
        <div className="flex flex-col">
          {summary.map((s) => {
            const meta = ROM_TESTS.find((t) => t.key === s.key)!
            return (
              <div
                key={s.key}
                className="grid grid-cols-[1fr_auto_auto] items-baseline gap-3 border-b border-ink/20 py-1.5 text-sm"
              >
                <span className="min-w-0 truncate font-semibold text-ink">
                  {meta.label}
                  {meta.side && (
                    <span className="ml-1 text-[10px] font-semibold uppercase tracking-wider text-ink/50">
                      {meta.side === 'L' ? 'left' : 'right'}
                    </span>
                  )}
                </span>
                <span className="tabular-nums text-ink">{fmt(s.latest)}</span>
                <span className="w-28 text-right text-xs tabular-nums text-ink/55">
                  {s.delta == null
                    ? ''
                    : s.beyondNoise
                      ? `${s.delta > 0 ? '+' : ''}${s.delta} · ${s.improved ? 'better' : 'worse'}`
                      : `${s.delta > 0 ? '+' : ''}${s.delta} · within ±${meta.mdcCm}`}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {!open ? (
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-xs text-ink/55">
            {due ? 'Due' : `Next test in ${RETEST_DAYS - (daysSince ?? 0)} days.`}
          </span>
          <button
            onClick={() => setOpen(true)}
            className="shrink-0 border border-ink/40 px-3 py-1.5 text-sm font-semibold text-ink hover:bg-ink/5"
          >
            Log a test
          </button>
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-3">
          {ROM_TESTS.map((t) => (
            <label key={t.key} className="flex flex-col gap-1">
              <span className="flex items-baseline justify-between text-[10px] font-semibold uppercase tracking-wider">
                <span className="text-ink">
                  {t.label}
                  {t.side ? ` · ${t.side === 'L' ? 'left' : 'right'}` : ''}
                </span>
                <span className="text-ink/45">cm · ±{t.mdcCm} noise</span>
              </span>
              <input
                className={inputClass}
                type="number"
                inputMode="decimal"
                step="0.5"
                placeholder="cm"
                value={draft[t.key]}
                onChange={(e) => setDraft({ ...draft, [t.key]: e.target.value })}
              />
              <span className="text-[11px] leading-snug text-ink/50">{t.how}</span>
            </label>
          ))}
          <input
            className={inputClass}
            placeholder="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {error && <p className="text-sm font-semibold text-accent-700">{error}</p>}
          <div className="flex items-center gap-3">
            <button onClick={save} className={`${buttonClass} flex-1`}>
              Save test
            </button>
            <button
              onClick={() => setOpen(false)}
              className="text-[10px] font-semibold uppercase tracking-widest text-ink/45 hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {tests.length > 1 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-widest text-ink/45 hover:text-ink">
            History ({tests.length})
          </summary>
          <div className="mt-1 flex flex-col">
            {tests.slice(0, 8).map((t) => (
              <div
                key={t.date}
                className="grid grid-cols-[auto_1fr_auto] gap-3 border-b border-ink/20 py-1 text-xs"
              >
                <span className="tabular-nums text-ink/55">{t.date}</span>
                <span className="truncate text-ink/70">
                  {ROM_TESTS.filter((m) => typeof t[m.key] === 'number')
                    .map((m) => `${m.label.split(' ')[0]}${m.side ? m.side : ''} ${t[m.key]}`)
                    .join(' · ')}
                </span>
                <button
                  onClick={() => {
                    if (window.confirm(`Delete the test from ${t.date}?`)) {
                      onDelete(t.date).catch(() => setError('Deleting needs a connection.'))
                    }
                  }}
                  className="text-ink/35 hover:text-accent-700"
                  aria-label={`delete test ${t.date}`}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  )
}

const tickStyle = {
  fill: '#7d7979',
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '.06em',
}
const tooltipStyle = {
  backgroundColor: '#f3f2f2',
  border: '1px solid #201e1d',
  borderRadius: 0,
  fontSize: 12,
  color: '#201e1d',
}
const gridStroke = 'rgba(32,30,29,.18)'
const dateTick = (d: string) => d.slice(5)
const secondaryButton =
  'border border-ink/40 px-4 py-2 text-sm font-semibold text-ink hover:bg-ink/5'

function axisProps() {
  return { tick: tickStyle, tickLine: false, axisLine: false } as const
}

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

const RANGES = [30, 90, 180] as const

function initialBanner(): string | null {
  const q = new URLSearchParams(window.location.search)
  if (q.get('whoop') === 'connected') {
    return 'WHOOP connected.'
  }
  if (q.get('whoop') === 'error') {
    const reason = q.get('reason') ?? 'unknown'
    const detail = q.get('detail')
    return `WHOOP connection failed (${reason}${detail ? `: ${detail}` : ''}).`
  }
  return null
}

function recoveryTone(score: number): 'good' | 'warn' | 'bad' {
  if (score >= 67) return 'good'
  if (score >= 34) return 'warn'
  return 'bad'
}

function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

/** Connect / status / disconnect for the strap — the optional part. */
function Wearable({
  me,
  onError,
  onChanged,
  api,
}: {
  me: Me
  onError: (message: string) => void
  onChanged: () => void
  api: Api
}) {
  const [busy, setBusy] = useState(false)

  async function connect() {
    setBusy(true)
    try {
      const res = await api.get('/api/whoop/connect')
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `API responded ${res.status}`)
      window.location.assign(body.url)
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not start connect')
      setBusy(false)
    }
  }

  async function disconnect() {
    if (
      !window.confirm('Disconnect WHOOP?')
    ) {
      return
    }
    setBusy(true)
    try {
      const res = await api.send('DELETE', '/api/whoop')
      if (!res.ok) throw new Error(`API responded ${res.status}`)
      onChanged()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not disconnect')
    } finally {
      setBusy(false)
    }
  }

  if (!me.whoop.connected) {
    return (
      <Card
        title={me.whoop.status === 'error' ? 'WHOOP needs attention' : 'Wearable'}
      >
        <button
          onClick={connect}
          disabled={busy}
          className={`${secondaryButton} w-full max-w-xs`}
        >
          {busy
            ? 'Redirecting…'
            : me.whoop.status === 'error'
              ? 'Reconnect WHOOP'
              : 'Connect WHOOP'}
        </button>
      </Card>
    )
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-ink/55">
        WHOOP connected
        {me.whoop.lastSyncAt
          ? ` · last synced ${fmtDay(me.whoop.lastSyncAt)}`
          : ' · nothing synced yet'}
      </p>
      <button
        onClick={disconnect}
        disabled={busy}
        className="text-[10px] font-semibold uppercase tracking-widest text-ink/45 hover:text-accent-700"
      >
        Disconnect
      </button>
    </div>
  )
}

export function Recovery({
  api,
  checkins,
  onSaveCheckin,
  onStartRecovery,
}: {
  api: Api
  checkins: Checkin[]
  onSaveCheckin: (patch: Partial<Checkin>) => void
  onStartRecovery: () => void
}) {
  const [me, setMe] = useState<Me | null>(null)
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [days, setDays] = useState<(typeof RANGES)[number]>(90)
  const [apiError, setApiError] = useState<string | null>(null)
  const [banner] = useState<string | null>(initialBanner)
  // Sessions come from the logger's cache: Workouts is unmounted while this
  // tab is up, and the cache is rewritten on every save, so it is current.
  const [workouts] = useState<Workout[]>(loadWorkoutCache)
  const rom = useRomTests(api)

  useEffect(() => {
    if (banner) window.history.replaceState(null, '', '/')
  }, [banner])

  const loadMe = () =>
    api
      .get('/api/me')
      .then(async (res) => {
        if (!res.ok) throw new Error(`API responded ${res.status}`)
        setMe(await res.json())
      })
      .catch((err: Error) => setApiError(err.message))

  useEffect(() => {
    void loadMe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // ---- recovery work: this week and the last four ----
  const today = localToday()
  const week = useMemo(() => {
    const monday = new Date()
    monday.setHours(0, 0, 0, 0)
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
    const done = recoveryDays(workouts, 60, today)
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday)
      d.setDate(monday.getDate() + i)
      const key = localDay(d.toISOString())
      return {
        label: d.toLocaleDateString(undefined, { weekday: 'narrow' }),
        done: done.has(key),
        isToday: key === today,
        future: key > today,
      }
    })
  }, [workouts, today])
  const consistency = consistencyPct(workouts, today)
  const recent = useMemo(
    () => workouts.filter((w) => w.kind === 'recovery').slice(0, 4),
    [workouts],
  )
  const weekMinutes = useMemo(() => {
    const monday = new Date()
    monday.setHours(0, 0, 0, 0)
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
    return workouts
      .filter(
        (w) => w.kind === 'recovery' && new Date(w.start).getTime() >= monday.getTime(),
      )
      .reduce((s, w) => s + (w.durationMin ?? 0), 0)
  }, [workouts])

  // ---- strap series (only when there is anything to show) ----
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

  const clock = (v: number) => {
    const h = ((v % 24) + 24) % 24
    const hh = Math.floor(h)
    const mm = Math.round((h - hh) * 60)
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
  }

  const latest = recoverySeries.at(-1)
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
      : `${value - base >= 0 ? '+' : ''}${Math.round((value - base) * 10) / 10} vs 30d`

  const hasStrapData = recoverySeries.length > 0

  return (
    <>
      {banner && (
        <p className="text-sm font-semibold text-accent-700">{banner}</p>
      )}
      {apiError && (
        <p className="text-sm font-semibold text-accent-700">{apiError}</p>
      )}

      <h1 className="text-2xl font-extrabold tracking-tight text-ink">
        Recovery
      </h1>

      <CheckinCard checkins={checkins} onSave={onSaveCheckin} />

      <section className="border-t-2 border-ink/40 pt-2.5">
        <div className="mb-1.5 flex items-baseline justify-between">
          <p className="kicker">Recovery work</p>
          <span className="text-[9px] font-semibold tracking-widest text-ink/45">
            {consistency}% · 28D
          </span>
        </div>
        <div className="grid grid-cols-7 border border-ink/40">
          {week.map((d, i) => (
            <div
              key={i}
              className={`py-2 text-center ${i < 6 ? 'border-r border-ink/25' : ''} ${
                d.isToday ? 'shadow-[inset_0_0_0_2px_#e0a112]' : ''
              }`}
            >
              <div className="text-[9px] font-semibold text-ink/50">
                {d.label.toUpperCase()}
              </div>
              <div
                className={`mx-auto mt-1 h-2 w-2 ${
                  d.done
                    ? 'bg-gold-500'
                    : d.future
                      ? ''
                      : 'border border-ink/25'
                }`}
              />
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-xs text-ink/55">
            {weekMinutes > 0 ? `${weekMinutes} min this week` : 'Nothing yet'}
          </span>
          <button
            onClick={onStartRecovery}
            className={`${buttonClass} shrink-0`}
          >
            Start recovery<span>→</span>
          </button>
        </div>
        {recent.length > 0 && (
          <div className="mt-3 flex flex-col">
            {recent.map((w) => (
              <div
                key={w.id}
                className="grid grid-cols-[1fr_auto] border-b border-ink/20 py-1.5 text-sm"
              >
                <span className="min-w-0 truncate font-semibold text-ink">
                  {w.title ?? w.modality ?? 'Recovery'}
                  {w.rating?.post != null && (
                    <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink/50">
                      feel {w.rating.post}/5
                    </span>
                  )}
                </span>
                <span className="text-xs text-ink/55">
                  {fmtDay(w.start)}
                  {w.durationMin != null ? ` · ${w.durationMin} min` : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <MobilityTests tests={rom.tests} onSave={rom.save} onDelete={rom.remove} />

      <BodyWeight api={api} whoopLb={me?.whoop.bodyWeightLb} />

      {/* ---- the strap, demoted: present when connected, honest when quiet ---- */}
      <section className="border-t-2 border-ink/40 pt-2.5">
        <div className="flex items-center justify-between">
          <p className="kicker-muted">Wearable</p>
          {hasStrapData && (
            <div className="flex divide-x divide-ink/40 border border-ink/40">
              {RANGES.map((r) => (
                <button
                  key={r}
                  onClick={() => setDays(r)}
                  className={`px-3 py-1.5 text-[10px] uppercase tracking-wider ${
                    days === r
                      ? 'bg-accent font-extrabold text-paper'
                      : 'font-semibold text-ink/60 hover:bg-ink/5'
                  }`}
                >
                  {r}d
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="mt-2">
          {me && (
            <Wearable me={me} onError={setApiError} onChanged={loadMe} api={api} />
          )}
          {me?.whoop.connected && metrics && !hasStrapData && (
            <p className="mt-1 text-xs text-ink/45">No data in this range.</p>
          )}
        </div>
      </section>

      {hasStrapData && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              label="Recovery"
              value={latest?.score != null ? `${latest.score}%` : '—'}
              tone={latest?.score != null ? recoveryTone(latest.score) : 'neutral'}
              sub={latest?.date}
            />
            <StatCard
              label="HRV"
              value={latest?.hrv != null ? `${Math.round(latest.hrv)} ms` : '—'}
              sub={delta(latest?.hrv, hrv30)}
            />
            <StatCard
              label="Resting HR"
              value={latest?.rhr != null ? `${Math.round(latest.rhr)} bpm` : '—'}
              sub={delta(latest?.rhr, rhr30)}
            />
            <StatCard
              label="Sleep perf."
              value={lastSleep?.value != null ? `${Math.round(lastSleep.value)}%` : '—'}
              sub={lastSleep?.date}
            />
          </div>

          <Card title="Recovery score">
            <TrendChart
              data={scoreSeries}
              color="#ec3013"
              unit="%"
              domain={[0, 100]}
              baselineLabel="7-day baseline"
            />
          </Card>
          <Card title="Heart-rate variability" subtitle="ms">
            <TrendChart data={hrvSeries} color="#d96a10" unit="ms" />
          </Card>
          <Card title="Resting heart rate" subtitle="bpm">
            <TrendChart data={rhrSeries} color="#ae1800" unit="bpm" />
          </Card>
          <Card title="Sleep stages" subtitle="hours per night">
            <SleepStagesChart data={sleepSeries} />
          </Card>
          <Card title="Sleep performance" subtitle="%">
            <TrendChart
              data={sleepPerfSeries}
              color="#ec3013"
              unit="%"
              domain={[0, 100]}
            />
          </Card>

          {bedtimes.length > 1 && (
            <Card title="Bedtime consistency" subtitle="bed and wake times per night">
              <ResponsiveContainer width="100%" height={200}>
                <LineChart
                  data={bedtimes}
                  margin={{ top: 4, right: 4, bottom: 0, left: -10 }}
                >
                  <CartesianGrid stroke={gridStroke} vertical={false} />
                  <XAxis
                    dataKey="date"
                    {...axisProps()}
                    tickFormatter={dateTick}
                    minTickGap={32}
                  />
                  <YAxis
                    width={52}
                    domain={['auto', 'auto']}
                    tickFormatter={clock}
                    {...axisProps()}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelStyle={{ color: '#201e1d', fontWeight: 600 }}
                    formatter={(value, name) => [clock(Number(value)), String(name)]}
                  />
                  <Line
                    type="monotone"
                    dataKey="bed"
                    stroke="#d96a10"
                    strokeWidth={2}
                    dot={squareDot('#d96a10')}
                    activeDot={false}
                    name="bedtime"
                  />
                  <Line
                    type="monotone"
                    dataKey="wake"
                    stroke="#201e1d"
                    strokeWidth={1.5}
                    dot={false}
                    activeDot={false}
                    name="wake"
                  />
                </LineChart>
              </ResponsiveContainer>
            </Card>
          )}

          {weekdays.length > 1 && (
            <Card title="Recovery by weekday" subtitle="average recovery score per day">
              <ResponsiveContainer width="100%" height={180}>
                <BarChart
                  data={weekdays}
                  margin={{ top: 4, right: 4, bottom: 0, left: -18 }}
                >
                  <CartesianGrid stroke={gridStroke} vertical={false} />
                  <XAxis dataKey="day" {...axisProps()} />
                  <YAxis width={40} domain={[0, 100]} {...axisProps()} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelStyle={{ color: '#201e1d', fontWeight: 600 }}
                    formatter={(value, _name, item) => [
                      `${value}% avg over ${(item?.payload as { nights?: number })?.nights ?? '?'} nights`,
                      'recovery',
                    ]}
                  />
                  <Bar dataKey="avg" fill="#ec3013" name="recovery" />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          )}
        </>
      )}
    </>
  )
}
