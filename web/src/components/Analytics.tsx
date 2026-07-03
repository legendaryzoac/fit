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
  exercisesByFrequency,
  loadVsRecovery,
  personalRecords,
  runSeries,
  sprintSeries,
  weeklyVolume,
} from '../lib/analytics'
import type { Api } from '../lib/api'
import type { Metrics } from '../lib/metrics'
import type { SessionRecord, Workout } from '../lib/workouts'
import { Card } from './ui'

const tickStyle = { fill: '#737373', fontSize: 11 }
const tooltipStyle = {
  backgroundColor: '#171717',
  border: '1px solid #404040',
  borderRadius: 8,
  fontSize: 12,
}
const dateTick = (d: string) => d.slice(5)
const MUSCLE_COLORS = [
  '#2dd4bf',
  '#a78bfa',
  '#38bdf8',
  '#f59e0b',
  '#f87171',
  '#737373',
]

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
      className={`shrink-0 rounded-full px-3 py-1 text-xs ${
        active
          ? 'bg-teal-500/15 text-teal-300'
          : 'text-neutral-500 hover:text-neutral-300'
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
}: {
  api: Api
  workouts: Workout[]
  sessions: SessionRecord[]
}) {
  const [metrics, setMetrics] = useState<Metrics | null>(null)
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
  const volume = useMemo(() => weeklyVolume(workouts), [workouts])

  const drills = useMemo(() => drillsByFrequency(workouts), [workouts])
  const activeDrill = drill ?? drills[0] ?? null
  const sprints = useMemo(
    () => (activeDrill ? sprintSeries(workouts, activeDrill) : []),
    [workouts, activeDrill],
  )

  const runs = useMemo(() => runSeries(sessions), [sessions])

  const currentPr = activeExercise
    ? prs.find((p) => p.exercise === activeExercise)
    : undefined

  return (
    <div className="flex flex-col gap-4">
      <Card
        title="Load vs recovery"
        subtitle="daily strain (bars) against recovery score (line)"
      >
        {overlay.length > 0 ? (
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart
              data={overlay}
              margin={{ top: 4, right: -14, bottom: 0, left: -18 }}
            >
              <CartesianGrid stroke="#262626" strokeDasharray="3 3" vertical={false} />
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
              <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#d4d4d4' }} />
              <Bar
                yAxisId="strain"
                dataKey="strain"
                fill="#0f766e"
                name="strain"
                radius={[2, 2, 0, 0]}
              />
              <Line
                yAxisId="recovery"
                type="monotone"
                dataKey="recovery"
                stroke="#f59e0b"
                strokeWidth={1.5}
                dot={false}
                connectNulls
                name="recovery %"
              />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <p className="py-6 text-center text-sm text-neutral-600">
            {metricsError
              ? 'Could not load recovery data.'
              : metrics
                ? 'No WHOOP strain/recovery history yet.'
                : 'Loading…'}
          </p>
        )}
      </Card>

      <Card title="Strength" subtitle="estimated 1RM (Epley) per training day">
        {exercises.length === 0 ? (
          <p className="py-6 text-center text-sm text-neutral-600">
            Log strength workouts with weight × reps to see e1RM trends and PRs.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex gap-1 overflow-x-auto pb-1">
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
              <p className="text-sm text-neutral-400">
                PR{' '}
                <span className="font-semibold text-teal-300">
                  {currentPr.bestE1rm} lb e1RM
                </span>{' '}
                <span className="text-neutral-500">
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
                  <CartesianGrid
                    stroke="#262626"
                    strokeDasharray="3 3"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="date"
                    {...axisProps()}
                    tickFormatter={dateTick}
                    minTickGap={32}
                  />
                  <YAxis width={46} domain={['auto', 'auto']} {...axisProps()} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelStyle={{ color: '#d4d4d4' }}
                    formatter={(value, _name, item) => [
                      `${value} lb (${(item?.payload as { bestSet?: string })?.bestSet ?? ''})`,
                      'e1RM',
                    ]}
                  />
                  <Line
                    type="monotone"
                    dataKey="e1rm"
                    stroke="#2dd4bf"
                    strokeWidth={1.5}
                    dot={{ r: 2.5, fill: '#2dd4bf' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="py-4 text-center text-sm text-neutral-600">
                One session logged — the trend appears after the next one.
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
                <span className="text-neutral-200">{pr.exercise}</span>
                <span className="text-neutral-400">
                  <span className="font-semibold text-teal-300">
                    {pr.bestE1rm} lb
                  </span>{' '}
                  · {pr.bestSet} · {pr.date}
                </span>
              </div>
            ))}
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
              <CartesianGrid stroke="#262626" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="week" {...axisProps()} minTickGap={24} />
              <YAxis width={52} {...axisProps()} />
              <Tooltip
                contentStyle={tooltipStyle}
                labelStyle={{ color: '#d4d4d4' }}
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
        <Card title="Speed" subtitle="fastest rep per day — lower is better">
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
                <CartesianGrid stroke="#262626" strokeDasharray="3 3" vertical={false} />
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
                  labelStyle={{ color: '#d4d4d4' }}
                  formatter={(value) => [`${value}s`, 'best']}
                />
                <Line
                  type="monotone"
                  dataKey="bestSec"
                  stroke="#a78bfa"
                  strokeWidth={1.5}
                  dot={{ r: 2.5, fill: '#a78bfa' }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="py-4 text-center text-sm text-neutral-600">
              Two timed sessions of a drill unlock the trend.
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
              <CartesianGrid stroke="#262626" strokeDasharray="3 3" vertical={false} />
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
              <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#d4d4d4' }} />
              <Line
                yAxisId="pace"
                type="monotone"
                dataKey="paceMinMi"
                stroke="#38bdf8"
                strokeWidth={1.5}
                dot={{ r: 2.5, fill: '#38bdf8' }}
                name="pace min/mi"
              />
              <Line
                yAxisId="hr"
                type="monotone"
                dataKey="avgHr"
                stroke="#f87171"
                strokeWidth={1.5}
                dot={false}
                connectNulls
                name="avg bpm"
              />
            </ComposedChart>
          </ResponsiveContainer>
          <p className="mt-1 text-xs text-neutral-600">
            Faster pace at the same heart rate = improving aerobic fitness.
            (Pace axis is reversed so up means faster.)
          </p>
        </Card>
      )}
    </div>
  )
}
