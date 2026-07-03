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

const tickStyle = { fill: '#737373', fontSize: 11 }
const tooltipStyle = {
  backgroundColor: '#171717',
  border: '1px solid #404040',
  borderRadius: 8,
  fontSize: 12,
}
const dateTick = (d: string) => d.slice(5)

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
}: {
  data: TrendPoint[]
  color: string
  unit: string
  domain?: [number | 'auto', number | 'auto']
}) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
        <CartesianGrid stroke="#262626" strokeDasharray="3 3" vertical={false} />
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
          labelStyle={{ color: '#d4d4d4' }}
          formatter={(value, name) => [
            `${Math.round(Number(value) * 10) / 10} ${unit}`,
            String(name) === 'baseline' ? '30-day baseline' : unit,
          ]}
        />
        <Line
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={1.5}
          dot={false}
          connectNulls
          name="value"
        />
        <Line
          type="monotone"
          dataKey="baseline"
          stroke="#737373"
          strokeWidth={1}
          strokeDasharray="4 4"
          dot={false}
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
        <CartesianGrid stroke="#262626" strokeDasharray="3 3" vertical={false} />
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
          width={40}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          labelStyle={{ color: '#d4d4d4' }}
          formatter={(value, name) => [
            `${Math.round(Number(value) * 10) / 10} h`,
            String(name),
          ]}
        />
        <Bar dataKey="deep" stackId="s" fill="#0f766e" name="deep" />
        <Bar dataKey="rem" stackId="s" fill="#2dd4bf" name="REM" />
        <Bar dataKey="light" stackId="s" fill="#99f6e4" name="light" />
        <Bar dataKey="awake" stackId="s" fill="#525252" name="awake" />
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
    good: 'text-teal-300',
    warn: 'text-amber-300',
    bad: 'text-red-400',
    neutral: 'text-neutral-100',
  }[tone]
  return (
    <div className="rounded-xl border border-neutral-800/60 bg-neutral-900/60 p-3">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className={`text-xl font-semibold ${toneClass}`}>{value}</p>
      {sub && <p className="text-xs text-neutral-500">{sub}</p>}
    </div>
  )
}
