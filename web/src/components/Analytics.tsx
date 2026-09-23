import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  drillsByFrequency,
  e1rmSeries,
  exerciseDetail,
  exercisesByFrequency,
  loadVsRecovery,
  personalRecords,
  runSeries,
  sprintSeries,
  weeklyVolume,
  weeklyZones,
} from '../lib/analytics'
import type { Api } from '../lib/api'
import { CHECKIN_ITEMS, type Checkin } from '../lib/checkins'
import { makeMuscleLookup, type CustomExercise } from '../lib/exercises'
import type { Metrics } from '../lib/metrics'
import { localToday } from '../lib/weights'
import {
  behaviourImpact,
  consistencyPct,
  dailySeries,
  IMPACT_MIN_N,
  weeklyLoad,
  weeklyMinutesByModality,
} from '../lib/wellness'

const KIND_COLORS: Record<string, string> = {
  strength: '#ec3013',
  speed: '#201e1d',
  cardio: '#ef6853',
  recovery: '#e0a112',
}
const OUTCOME_LABEL: Record<string, string> = {
  soreness: 'soreness',
  fatigue: 'energy',
  prs: 'recovery (0–10)',
}
import type { SessionRecord, Workout } from '../lib/workouts'
import { LiveHR } from './LiveHR'
import { Card } from './ui'

const WELLNESS_COLORS: Record<string, string> = {
  sleep: '#201e1d',
  fatigue: '#ec3013',
  soreness: '#d96a10',
  stress: '#e0a112',
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
const tooltipLabelStyle = { color: '#201e1d' }
const GRID_STROKE = 'rgba(32,30,29,.18)'
const dateTick = (d: string) => d.slice(5)
// Focus muscle stays red; the rest cascade through the warm family
// (burnt orange, mustard) before falling into the ink ramp.
const MUSCLE_COLORS = [
  '#ec3013',
  '#d96a10',
  '#e0a112',
  '#201e1d',
  '#605d5d',
  '#9b9797',
  '#bab6b6',
]

const squareDot =
  (color: string) =>
  (props: { cx?: number; cy?: number; key?: React.Key | null }) => (
    <rect
      key={props.key ?? undefined}
      x={(props.cx ?? 0) - 3}
      y={(props.cy ?? 0) - 3}
      width={6}
      height={6}
      fill={color}
    />
  )

function axisProps() {
  return { tick: tickStyle, tickLine: false, axisLine: false } as const
}

function Chip({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider ${
        active
          ? 'border border-ink bg-ink text-paper'
          : 'border border-ink/40 text-ink/70 hover:bg-ink/5'
      }`}
    >
      {label}
    </button>
  )
}

export function Analytics({
  api,
  workouts,
  sessions,
  customs,
  checkins,
}: {
  api: Api
  workouts: Workout[]
  sessions: SessionRecord[]
  customs: CustomExercise[]
  checkins: Checkin[]
}) {
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const recoveryWeeks = useMemo(() => weeklyMinutesByModality(workouts), [workouts])
  const consistency = useMemo(
    () => consistencyPct(workouts, localToday()),
    [workouts],
  )
  const wellness = useMemo(() => {
    const today = localToday()
    const series = CHECKIN_ITEMS.map((it) => dailySeries(checkins, it.key, 60, today))
    return series[0].map((p, i) => ({
      date: p.date,
      sleep: series[0][i].value,
      fatigue: series[1][i].value,
      soreness: series[2][i].value,
      stress: series[3][i].value,
    }))
  }, [checkins])
  const hasWellness = wellness.some((r) => r.sleep != null)
  const hasRecovery = recoveryWeeks.modalities.length > 0
  const load = useMemo(() => weeklyLoad(workouts, 8), [workouts])
  const ratedAny = load.some((w) => w.rated > 0)
  const loadKinds = useMemo(
    () => ['strength', 'speed', 'cardio', 'recovery'].filter((k) => load.some((w) => (w.byKind[k] ?? 0) > 0)),
    [load],
  )
  const thisWeek = load[load.length - 1]
  const lastWeek = load[load.length - 2]
  const weekChange =
    thisWeek && lastWeek && lastWeek.load > 0
      ? Math.round(((thisWeek.load - lastWeek.load) / lastWeek.load) * 100)
      : null
  const impacts = useMemo(
    () => behaviourImpact(workouts, checkins, localToday()),
    [workouts, checkins],
  )
  const impactModalities = [...new Set(impacts.map((r) => r.modality))]
  const [metricsError, setMetricsError] = useState(false)
  const [exercise, setExercise] = useState<string | null>(null)
  const [drill, setDrill] = useState<string | null>(null)

  useEffect(() => {
    api
      .get('/api/metrics?days=90')
      .then(async (res) => {
        if (!res.ok) throw new Error()
        setMetrics(await res.json())
      })
      .catch(() => setMetricsError(true))
  }, [api])

  const overlay = useMemo(
    () =>
      metrics ? loadVsRecovery(metrics.recoveries, metrics.cycles).slice(-60) : [],
    [metrics],
  )

  const exercises = useMemo(() => exercisesByFrequency(workouts), [workouts])
  const activeExercise = exercise ?? exercises[0] ?? null
  const e1rm = useMemo(
    () => (activeExercise ? e1rmSeries(workouts, activeExercise) : []),
    [workouts, activeExercise],
  )
  const prs = useMemo(() => personalRecords(workouts), [workouts])
  const muscleLookup = useMemo(() => makeMuscleLookup(customs), [customs])
  const volume = useMemo(
    () => weeklyVolume(workouts, muscleLookup),
    [workouts, muscleLookup],
  )

  const drills = useMemo(() => drillsByFrequency(workouts), [workouts])
  const activeDrill = drill ?? drills[0] ?? null
  const sprints = useMemo(
    () => (activeDrill ? sprintSeries(workouts, activeDrill) : []),
    [workouts, activeDrill],
  )

  const runs = useMemo(() => runSeries(sessions), [sessions])
  const detail = useMemo(
    () => (activeExercise ? exerciseDetail(workouts, activeExercise) : []),
    [workouts, activeExercise],
  )
  const zones = useMemo(() => weeklyZones(sessions), [sessions])

  const currentPr = activeExercise
    ? prs.find((p) => p.exercise === activeExercise)
    : undefined

  return (
    <div className="flex flex-col gap-4">
      <Card title="Load vs recovery">
        {overlay.length > 0 ? (
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart
              data={overlay}
              margin={{ top: 4, right: -14, bottom: 0, left: -18 }}
            >
              <CartesianGrid stroke={GRID_STROKE} vertical={false} />
              <XAxis
                dataKey="date"
                {...axisProps()}
                tickFormatter={dateTick}
                minTickGap={32}
              />
              <YAxis yAxisId="strain" domain={[0, 21]} width={40} {...axisProps()} />
              <YAxis
                yAxisId="recovery"
                orientation="right"
                domain={[0, 100]}
                width={40}
                {...axisProps()}
              />
              <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} />
              <Bar
                yAxisId="strain"
                dataKey="strain"
                fill="#e0a112"
                name="strain"
              />
              <Line
                yAxisId="recovery"
                type="monotone"
                dataKey="recovery"
                stroke="#ec3013"
                strokeWidth={2}
                dot={false}
                connectNulls
                name="recovery %"
              />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <p className="py-6 text-center text-sm text-ink/45">
            {metricsError
              ? 'Could not load recovery data.'
              : metrics
                ? 'No WHOOP strain/recovery history yet.'
                : 'Loading…'}
          </p>
        )}
      </Card>

      {hasWellness && (
        <Card title="Readiness" subtitle="1 to 5, higher is better">
          <ResponsiveContainer width="100%" height={200}>
            <LineChart
              data={wellness}
              margin={{ top: 4, right: 4, bottom: 0, left: -24 }}
            >
              <CartesianGrid stroke={GRID_STROKE} vertical={false} />
              <XAxis
                dataKey="date"
                {...axisProps()}
                tickFormatter={dateTick}
                minTickGap={32}
              />
              <YAxis domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} width={40} {...axisProps()} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} />
              {CHECKIN_ITEMS.map((it) => (
                <Line
                  key={it.key}
                  type="monotone"
                  dataKey={it.key}
                  stroke={WELLNESS_COLORS[it.key]}
                  strokeWidth={it.key === 'sleep' ? 1.5 : 2}
                  dot={false}
                  connectNulls={false}
                  name={it.label.toLowerCase()}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}

      <Card title="Training load" subtitle="effort (0–10) × minutes, per week">
        {ratedAny ? (
          <>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart
                data={load.map((w) => ({ label: w.label, ...w.byKind }))}
                margin={{ top: 4, right: 4, bottom: 0, left: -18 }}
              >
                <CartesianGrid stroke={GRID_STROKE} vertical={false} />
                <XAxis dataKey="label" {...axisProps()} />
                <YAxis width={40} {...axisProps()} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} />
                {loadKinds.map((k) => (
                  <Bar key={k} dataKey={k} stackId="l" fill={KIND_COLORS[k]} name={k} />
                ))}
              </BarChart>
            </ResponsiveContainer>
            {thisWeek && (
              <div className="mt-2 grid grid-cols-3 border-b-2 border-t border-ink/40">
                <div className="py-2">
                  <div className="text-[9px] font-semibold tracking-widest text-ink/50">
                    THIS WEEK
                  </div>
                  <div className="text-lg font-extrabold">
                    {thisWeek.load.toLocaleString()}
                    {weekChange != null && (
                      <span className="ml-1 text-[10px] font-semibold text-ink/55">
                        {weekChange >= 0 ? '+' : ''}
                        {weekChange}%
                      </span>
                    )}
                  </div>
                </div>
                <div className="border-l border-ink/25 py-2 pl-3">
                  <div className="text-[9px] font-semibold tracking-widest text-ink/50">
                    MONOTONY
                  </div>
                  <div className="text-lg font-extrabold">
                    {thisWeek.monotony ?? '—'}
                  </div>
                </div>
                <div className="border-l border-ink/25 py-2 pl-3">
                  <div className="text-[9px] font-semibold tracking-widest text-ink/50">
                    STRAIN
                  </div>
                  <div className="text-lg font-extrabold">
                    {thisWeek.strain != null ? thisWeek.strain.toLocaleString() : '—'}
                  </div>
                </div>
              </div>
            )}
            <p className="mt-1 text-xs text-ink/45">
              {thisWeek?.rated ?? 0} of {thisWeek?.sessions ?? 0} rated this week
            </p>
          </>
        ) : (
          <p className="py-6 text-center text-sm text-ink/45">
            No rated sessions yet.
          </p>
        )}
      </Card>

      <Card
        title="What helps"
        subtitle="next-morning check-in, with a recovery session vs without"
      >
        {impacts.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink/45">
            Needs {IMPACT_MIN_N}+ mornings with and without, in 90 days.
          </p>
        ) : (
          <div className="flex flex-col">
            {impactModalities.map((m) => (
              <div
                key={m}
                className="grid grid-cols-[6rem_1fr] gap-2 border-b border-ink/20 py-1.5 text-sm"
              >
                <span className="font-extrabold capitalize text-ink">{m}</span>
                <span className="flex flex-col gap-0.5 text-ink/80">
                  {impacts
                    .filter((r) => r.modality === m)
                    .map((r) => (
                      <span key={r.outcome}>
                        {OUTCOME_LABEL[r.outcome]}{' '}
                        <span
                          className={`font-extrabold ${
                            r.diff > 0
                              ? 'text-accent-700'
                              : r.diff < 0
                                ? 'text-ink'
                                : 'text-ink/55'
                          }`}
                        >
                          {r.diff > 0 ? '+' : ''}
                          {r.diff}
                        </span>
                        <span className="text-xs text-ink/45">
                          {' '}
                          · {r.meanWith} vs {r.meanWithout} · n {r.nWith} vs{' '}
                          {r.nWithout}
                        </span>
                      </span>
                    ))}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {hasRecovery && (
        <Card
          title="Recovery minutes"
          subtitle={`per week by type · ${consistency}% of the last 28 days had a session`}
        >
          <ResponsiveContainer width="100%" height={180}>
            <BarChart
              data={recoveryWeeks.rows}
              margin={{ top: 4, right: 4, bottom: 0, left: -18 }}
            >
              <CartesianGrid stroke={GRID_STROKE} vertical={false} />
              <XAxis dataKey="week" {...axisProps()} />
              <YAxis width={40} {...axisProps()} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} />
              {recoveryWeeks.modalities.map((m, i) => (
                <Bar
                  key={m}
                  dataKey={m}
                  stackId="r"
                  fill={MUSCLE_COLORS[i % MUSCLE_COLORS.length]}
                  name={m}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      <Card title="Strength" subtitle="e1RM (Epley) per training day">
        {exercises.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink/45">
            No strength workouts logged.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="scroll-thin flex gap-1 overflow-x-auto pb-1">
              {exercises.slice(0, 8).map((name) => (
                <Chip
                  key={name}
                  label={name}
                  active={name === activeExercise}
                  onClick={() => setExercise(name)}
                />
              ))}
            </div>
            {currentPr && (
              <p className="text-sm text-ink/70">
                PR{' '}
                <span className="font-semibold text-accent-700">
                  {currentPr.bestE1rm} lb e1RM
                </span>{' '}
                <span className="text-ink/55">
                  ({currentPr.bestSet} on {currentPr.date})
                </span>
              </p>
            )}
            {e1rm.length > 1 ? (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart
                  data={e1rm}
                  margin={{ top: 4, right: 4, bottom: 0, left: -18 }}
                >
                  <CartesianGrid stroke={GRID_STROKE} vertical={false} />
                  <XAxis
                    dataKey="date"
                    {...axisProps()}
                    tickFormatter={dateTick}
                    minTickGap={32}
                  />
                  <YAxis width={46} domain={['auto', 'auto']} {...axisProps()} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelStyle={tooltipLabelStyle}
                    formatter={(value, _name, item) => [
                      `${value} lb (${(item?.payload as { bestSet?: string })?.bestSet ?? ''})`,
                      'e1RM',
                    ]}
                  />
                  <Line
                    type="monotone"
                    dataKey="e1rm"
                    stroke="#ec3013"
                    strokeWidth={2}
                    dot={squareDot('#ec3013')}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="py-4 text-center text-sm text-ink/45">
                One session logged.
              </p>
            )}
          </div>
        )}
      </Card>

      {prs.length > 0 && (
        <Card title="Personal records" subtitle="best estimated 1RM per lift">
          <div className="flex flex-col gap-1.5">
            {prs.map((pr) => (
              <div
                key={pr.exercise}
                className="flex items-baseline justify-between text-sm"
              >
                <span className="text-ink">{pr.exercise}</span>
                <span className="text-ink/70">
                  <span className="font-semibold text-accent-700">
                    {pr.bestE1rm} lb
                  </span>{' '}
                  · {pr.bestSet} · {pr.date}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {exercises.length > 0 && (
        <Card
          title="Exercise deep dive"
          subtitle="session volume, top set, and e1RM for one lift"
        >
          <div className="flex flex-col gap-3">
            <div className="scroll-thin flex gap-1 overflow-x-auto pb-1">
                {exercises.slice(0, 8).map((name) => (
                  <Chip
                    key={name}
                    label={name}
                    active={name === activeExercise}
                    onClick={() => setExercise(name)}
                  />
                ))}
              </div>
              {detail.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart
                    data={detail}
                    margin={{ top: 4, right: -14, bottom: 0, left: -10 }}
                  >
                    <CartesianGrid stroke={GRID_STROKE} vertical={false} />
                    <XAxis
                      dataKey="date"
                      {...axisProps()}
                      tickFormatter={dateTick}
                      minTickGap={32}
                    />
                    <YAxis yAxisId="volume" width={52} {...axisProps()} />
                    <YAxis
                      yAxisId="weight"
                      orientation="right"
                      width={44}
                      domain={['auto', 'auto']}
                      {...axisProps()}
                    />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      labelStyle={tooltipLabelStyle}
                      formatter={(value, name) => [
                        `${Number(value).toLocaleString()} lb`,
                        String(name),
                      ]}
                    />
                    <Bar
                      yAxisId="volume"
                      dataKey="volume"
                      fill="#e0a112"
                      name="session volume"
                    />
                    <Line
                      yAxisId="weight"
                      type="monotone"
                      dataKey="topWeight"
                      stroke="#ec3013"
                      strokeWidth={2}
                      dot={squareDot('#ec3013')}
                      name="top set"
                    />
                    <Line
                      yAxisId="weight"
                      type="monotone"
                      dataKey="e1rm"
                      stroke="#201e1d"
                      strokeWidth={1}
                      strokeDasharray="2 3"
                      dot={false}
                      name="e1RM"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <p className="py-4 text-center text-sm text-ink/45">
                  No weighted sets logged for {activeExercise} yet.
                </p>
              )}
            </div>
        </Card>
      )}

      {volume.rows.length > 0 && (
        <Card title="Weekly volume" subtitle="tonnage by muscle group, lb">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart
              data={volume.rows}
              margin={{ top: 4, right: 4, bottom: 0, left: -10 }}
            >
              <CartesianGrid stroke={GRID_STROKE} vertical={false} />
              <XAxis dataKey="week" {...axisProps()} minTickGap={24} />
              <YAxis width={52} {...axisProps()} />
              <Tooltip
                contentStyle={tooltipStyle}
                labelStyle={tooltipLabelStyle}
                formatter={(value, name) => [
                  `${Number(value).toLocaleString()} lb`,
                  String(name),
                ]}
              />
              {volume.muscles.map((m, i) => (
                <Bar
                  key={m}
                  dataKey={m}
                  stackId="v"
                  fill={MUSCLE_COLORS[i % MUSCLE_COLORS.length]}
                  name={m}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {drills.length > 0 && (
        <Card title="Speed" subtitle="fastest rep per day, lower is better">
          <div className="mb-2 flex gap-1 overflow-x-auto pb-1">
            {drills.slice(0, 6).map((name) => (
              <Chip
                key={name}
                label={name}
                active={name === activeDrill}
                onClick={() => setDrill(name)}
              />
            ))}
          </div>
          {sprints.length > 1 ? (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart
                data={sprints}
                margin={{ top: 4, right: 4, bottom: 0, left: -18 }}
              >
                <CartesianGrid stroke={GRID_STROKE} vertical={false} />
                <XAxis
                  dataKey="date"
                  {...axisProps()}
                  tickFormatter={dateTick}
                  minTickGap={32}
                />
                <YAxis
                  width={46}
                  domain={['auto', 'auto']}
                  {...axisProps()}
                  unit="s"
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelStyle={tooltipLabelStyle}
                  formatter={(value) => [`${value}s`, 'best']}
                />
                <Line
                  type="monotone"
                  dataKey="bestSec"
                  stroke="#d96a10"
                  strokeWidth={2}
                  dot={squareDot('#d96a10')}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="py-4 text-center text-sm text-ink/45">
              Needs two timed sessions.
            </p>
          )}
        </Card>
      )}

      {runs.length > 1 && (
        <Card
          title="Running efficiency"
          subtitle="pace (min/mi, left) and avg heart rate (right) per run"
        >
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart
              data={runs}
              margin={{ top: 4, right: -14, bottom: 0, left: -18 }}
            >
              <CartesianGrid stroke={GRID_STROKE} vertical={false} />
              <XAxis
                dataKey="date"
                {...axisProps()}
                tickFormatter={dateTick}
                minTickGap={32}
              />
              <YAxis
                yAxisId="pace"
                width={46}
                domain={['auto', 'auto']}
                reversed
                {...axisProps()}
              />
              <YAxis
                yAxisId="hr"
                orientation="right"
                width={40}
                domain={['auto', 'auto']}
                {...axisProps()}
              />
              <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} />
              <Line
                yAxisId="pace"
                type="monotone"
                dataKey="paceMinMi"
                stroke="#ec3013"
                strokeWidth={2}
                dot={squareDot('#ec3013')}
                name="pace min/mi"
              />
              <Line
                yAxisId="hr"
                type="monotone"
                dataKey="avgHr"
                stroke="#d96a10"
                strokeWidth={1.5}
                dot={false}
                connectNulls
                name="avg bpm"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>
      )}

      {zones.length > 0 && (
        <Card title="HR zone mix" subtitle="hours per zone, per week">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart
              data={zones}
              margin={{ top: 4, right: 4, bottom: 0, left: -18 }}
            >
              <CartesianGrid stroke={GRID_STROKE} vertical={false} />
              <XAxis dataKey="week" {...axisProps()} minTickGap={24} />
              <YAxis width={46} unit="h" {...axisProps()} />
              <Tooltip
                contentStyle={tooltipStyle}
                labelStyle={tooltipLabelStyle}
                formatter={(value, name) => [`${value} h`, String(name)]}
              />
              <Bar dataKey="z1" stackId="z" fill="#d7d3d3" name="zone 1" />
              <Bar dataKey="z2" stackId="z" fill="#e0a112" name="zone 2" />
              <Bar dataKey="z3" stackId="z" fill="#d96a10" name="zone 3" />
              <Bar dataKey="z4" stackId="z" fill="#ec3013" name="zone 4" />
              <Bar dataKey="z5" stackId="z" fill="#ae1800" name="zone 5" />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      <LiveHR />
    </div>
  )
}
