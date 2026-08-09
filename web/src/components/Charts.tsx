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

/** Square 6x6 data-point mark — the Modernist replacement for round dots. */
export const squareDot =
  (fill: string) =>
  ({
    cx,
    cy,
    key,
  }: {
    cx?: number
    cy?: number
    key?: React.Key | null
  }) => {
    if (cx == null || cy == null) return <g key={key ?? undefined} />
    return (
      <rect
        key={key ?? undefined}
        x={cx - 3}
        y={cy - 3}
        width={6}
        height={6}
        fill={fill}
      />
    )
  }

export interface TrendPoint {
  date: string
  value: number | null
  baseline?: number | null
}

export function TrendChart({
  data,
  color,
  unit,
  domain,
  baselineLabel = '30-day baseline',
}: {
  data: TrendPoint[]
  color: string
  unit: string
  domain?: [number | 'auto', number | 'auto']
  baselineLabel?: string
}) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
        <CartesianGrid stroke={gridStroke} vertical={false} />
        <XAxis
          dataKey="date"
          tick={tickStyle}
          tickLine={false}
          axisLine={false}
          tickFormatter={dateTick}
          minTickGap={32}
        />
        <YAxis
          tick={tickStyle}
          tickLine={false}
          axisLine={false}
          domain={domain ?? ['auto', 'auto']}
          width={46}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          labelStyle={{ color: '#201e1d', fontWeight: 600 }}
          formatter={(value, name) => [
            `${Math.round(Number(value) * 10) / 10} ${unit}`,
            String(name) === 'baseline' ? baselineLabel : unit,
          ]}
        />
        <Line
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          dot={squareDot(color)}
          activeDot={false}
          connectNulls
          name="value"
        />
        <Line
          type="monotone"
          dataKey="baseline"
          stroke="#201e1d"
          strokeWidth={1}
          strokeDasharray="2 3"
          dot={false}
          activeDot={false}
          connectNulls
          name="baseline"
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

export interface SleepPoint {
  date: string
  deep: number
  rem: number
  light: number
  awake: number
}

export function SleepStagesChart({ data }: { data: SleepPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
        <CartesianGrid stroke={gridStroke} vertical={false} />
        <XAxis
          dataKey="date"
          tick={tickStyle}
          tickLine={false}
          axisLine={false}
          tickFormatter={dateTick}
          minTickGap={32}
        />
        <YAxis
          tick={tickStyle}
          tickLine={false}
          axisLine={false}
          unit="h"
          width={46}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          labelStyle={{ color: '#201e1d', fontWeight: 600 }}
          formatter={(value, name) => [
            `${Math.round(Number(value) * 10) / 10} h`,
            String(name),
          ]}
        />
        <Bar dataKey="deep" stackId="s" fill="#ec3013" name="deep" />
        <Bar dataKey="rem" stackId="s" fill="#d96a10" name="REM" />
        <Bar dataKey="light" stackId="s" fill="#e0a112" name="light" />
        <Bar dataKey="awake" stackId="s" fill="#d7d3d3" name="awake" />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function StatCard({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: string
  value: string
  sub?: string
  tone?: 'good' | 'warn' | 'bad' | 'neutral'
}) {
  const toneClass = {
    good: 'text-accent-700',
    warn: 'text-ink/55',
    bad: 'text-accent-600',
    neutral: 'text-ink',
  }[tone]
  return (
    <div className="border border-ink/40 p-3">
      <p className="kicker-muted">{label}</p>
      <p
        className={`mt-1.5 text-2xl font-extrabold leading-none tracking-tight ${toneClass}`}
      >
        {value}
      </p>
      {sub && <p className="mt-1 text-xs font-semibold text-ink/45">{sub}</p>}
    </div>
  )
}
