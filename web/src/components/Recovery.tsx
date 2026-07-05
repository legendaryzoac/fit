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
import {
  localDate,
  mean,
  withRollingMean,
  type Metrics,
} from '../lib/metrics'
import {
  SleepStagesChart,
  StatCard,
  TrendChart,
  type SleepPoint,
  type TrendPoint,
} from './Charts'
import { buttonClass, Card } from './ui'

const tickStyle = { fill: '#737373', fontSize: 11 }
const tooltipStyle = {
  backgroundColor: '#171717',
  border: '1px solid #404040',
  borderRadius: 8,
  fontSize: 12,
}
const dateTick = (d: string) => d.slice(5)

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
  }
}

const RANGES = [30, 90, 180] as const

function initialBanner(): string | null {
  const q = new URLSearchParams(window.location.search)
  if (q.get('whoop') === 'connected') {
    return 'WHOOP connected — your history is syncing now.'
  }
  if (q.get('whoop') === 'error') {
    const reason = q.get('reason') ?? 'unknown'
    const detail = q.get('detail')
    return `WHOOP connection failed (${reason}${detail ? `: ${detail}` : ''}) — please try again.`
  }
  return null
}

function recoveryTone(score: number): 'good' | 'warn' | 'bad' {
  if (score >= 67) return 'good'
  if (score >= 34) return 'warn'
  return 'bad'
}

function WhoopConnect({
  me,
  onError,
  api,
}: {
  me: Me
  onError: (message: string) => void
  api: Api
}) {
  const [connecting, setConnecting] = useState(false)

  async function connect() {
    setConnecting(true)
    try {
      const res = await api.get('/api/whoop/connect')
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `API responded ${res.status}`)
      window.location.assign(body.url)
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not start connect')
      setConnecting(false)
    }
  }

  if (me.whoop.connected) return null
  return (
    <Card
      title={me.whoop.status === 'error' ? 'WHOOP needs attention' : 'Connect WHOOP'}
      subtitle="Optional — workout tracking works without a strap."
    >
      <button
        onClick={connect}
        disabled={connecting}
        className={`${buttonClass} w-full max-w-xs`}
      >
        {connecting
          ? 'Redirecting…'
          : me.whoop.status === 'error'
            ? 'Reconnect WHOOP'
            : 'Connect WHOOP'}
      </button>
    </Card>
  )
}

export function Recovery({ api }: { api: Api }) {
  const [me, setMe] = useState<Me | null>(null)
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [days, setDays] = useState<(typeof RANGES)[number]>(90)
  const [apiError, setApiError] = useState<string | null>(null)
  const [banner] = useState<string | null>(initialBanner)

  useEffect(() => {
    if (banner) window.history.replaceState(null, '', '/')
  }, [banner])

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

  return (
    <>
      {banner && <p className="text-sm text-teal-300">{banner}</p>}
      {apiError && <p className="text-sm text-red-400">{apiError}</p>}

      {me && <WhoopConnect me={me} onError={setApiError} api={api} />}

      <div className="flex items-center justify-between">
        <h1 className="text-base font-medium text-neutral-300">Recovery</h1>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setDays(r)}
              className={`rounded-full px-3 py-1 text-xs ${
                days === r
                  ? 'bg-teal-500/15 text-teal-300'
                  : 'text-neutral-500 hover:text-neutral-300'
              }`}
            >
              {r}d
            </button>
          ))}
        </div>
      </div>

      {!metrics && !apiError && (
        <p className="py-8 text-center text-sm text-neutral-600">
          Loading metrics…
        </p>
      )}

      {metrics && recoverySeries.length === 0 && (
        me?.whoop.connected ? (
          <p className="py-8 text-center text-sm text-neutral-600">
            No recovery data yet — the backfill may still be running.
          </p>
        ) : (
          <div className="py-6 text-center">
            <p className="mx-auto max-w-sm text-sm text-neutral-500">
              This tab comes alive when a wearable is connected: daily
              recovery scores, HRV and resting-heart-rate trends against your
              own baselines, and sleep-stage breakdowns.
            </p>
            <p className="mx-auto mt-3 max-w-sm text-sm text-neutral-600">
              No strap? No problem — the Training tab is the full product:
              log workouts, build templates, run interval timers, and watch
              your strength analytics grow.
            </p>
          </div>
        )
      )}

      {metrics && recoverySeries.length > 0 && (
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

          <Card title="Recovery score" subtitle="daily · dashed 7-day baseline">
            <TrendChart
              data={scoreSeries}
              color="#2dd4bf"
              unit="%"
              domain={[0, 100]}
              baselineLabel="7-day baseline"
            />
          </Card>
          <Card
            title="Heart-rate variability"
            subtitle="RMSSD, ms · dashed 30-day baseline"
          >
            <TrendChart data={hrvSeries} color="#a78bfa" unit="ms" />
          </Card>
          <Card
            title="Resting heart rate"
            subtitle="bpm · dashed 30-day baseline"
          >
            <TrendChart data={rhrSeries} color="#f87171" unit="bpm" />
          </Card>
          <Card title="Sleep stages" subtitle="hours per night">
            <SleepStagesChart data={sleepSeries} />
          </Card>
          <Card
            title="Sleep performance"
            subtitle="sleep achieved ÷ sleep needed · dashed 30-day baseline"
          >
            <TrendChart
              data={sleepPerfSeries}
              color="#38bdf8"
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
                  <CartesianGrid stroke="#262626" strokeDasharray="3 3" vertical={false} />
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
                    labelStyle={{ color: '#d4d4d4' }}
                    formatter={(value, name) => [clock(Number(value)), String(name)]}
                  />
                  <Line
                    type="monotone"
                    dataKey="bed"
                    stroke="#a78bfa"
                    strokeWidth={1.5}
                    dot={false}
                    name="bedtime"
                  />
                  <Line
                    type="monotone"
                    dataKey="wake"
                    stroke="#f59e0b"
                    strokeWidth={1.5}
                    dot={false}
                    name="wake"
                  />
                </LineChart>
              </ResponsiveContainer>
              <p className="mt-1 text-xs text-neutral-600">
                Flat lines = consistent circadian rhythm; the vertical gap is your
                time in bed.
              </p>
            </Card>
          )}

          {weekdays.length > 1 && (
            <Card title="Recovery by weekday" subtitle="average recovery score per day">
              <ResponsiveContainer width="100%" height={180}>
                <BarChart
                  data={weekdays}
                  margin={{ top: 4, right: 4, bottom: 0, left: -18 }}
                >
                  <CartesianGrid stroke="#262626" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="day" {...axisProps()} />
                  <YAxis width={40} domain={[0, 100]} {...axisProps()} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelStyle={{ color: '#d4d4d4' }}
                    formatter={(value, _name, item) => [
                      `${value}% avg over ${(item?.payload as { nights?: number })?.nights ?? '?'} nights`,
                      'recovery',
                    ]}
                  />
                  <Bar
                    dataKey="avg"
                    fill="#2dd4bf"
                    name="recovery"
                    radius={[2, 2, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          )}
        </>
      )}
    </>
  )
}
