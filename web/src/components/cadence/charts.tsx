/**
 * Cadence charts: Recharts restyled with the theme variables so every
 * series follows Dawn and Dusk. This module carries the Recharts
 * dependency — import it only from screens that are lazy-loaded.
 */
import type { Key, ReactNode } from 'react'
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type DotItemDotProps,
  type TooltipContentProps,
} from 'recharts'

export type ChartTone = 'brand' | 'effort' | 'rest' | 'caution'

export const TONE: Record<ChartTone, string> = {
  brand: 'var(--brand)',
  effort: 'var(--ember)',
  rest: 'var(--sky)',
  caution: 'var(--amber)',
}

/** Sleep stages, deepest first. */
export const SLEEP = {
  deep: 'var(--sky-strong)',
  rem: 'var(--sky)',
  light: 'var(--sleep-light)',
  awake: 'var(--sleep-awake)',
}

/** Heart-rate zones 1 to 5. */
export const ZONES = [
  'var(--zone-1)',
  'var(--sky)',
  'var(--brand)',
  'var(--ember)',
  'var(--rose)',
]

/** Categorical series, in order of use. */
export const SERIES = [
  'var(--brand)',
  'var(--ember)',
  'var(--sky)',
  'var(--amber)',
  'var(--rose)',
  'var(--series-6)',
  'var(--series-7)',
]

const TICK = { fill: 'var(--ink-3)', fontSize: 11, fontWeight: 500 }
const MARGIN = { top: 8, right: 8, bottom: 0, left: -8 }
const AXIS = { tick: TICK, tickLine: false, axisLine: false } as const
const LINE_CURSOR = { stroke: 'var(--hairline)' }
const BAR_CURSOR = { fill: 'var(--surface-2)' }

export type Domain = [number | string, number | string]

/** "Sep 14" from an ISO day, an ISO timestamp, or an "MM-DD" week key. */
export function shortDate(s: string): string {
  const parts = s.slice(0, 10).split('-')
  const [mm, dd] = parts.length >= 3 ? [parts[1], parts[2]] : [parts[0], parts[1]]
  const month = Number(mm)
  const day = Number(dd)
  if (!month || !day) return s
  return new Date(Date.UTC(2000, month - 1, day)).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

/** Axis ticks: thousands shorten to "3.9k" so they fit a 36px axis. */
function compact(v: number): string {
  const abs = Math.abs(v)
  if (abs >= 10_000) return `${Math.round(v / 1000)}k`
  if (abs >= 1000) return `${(Math.round(v / 100) / 10).toString()}k`
  return String(v)
}

/**
 * Axis width from the widest label the ticks are likely to need: 36px
 * for "100", wider once "4.5k" or "10.45" come into play. Stacked keys
 * are summed, the way the axis will see them.
 */
function yWidth(rows: object[], keys: string[]): number {
  let min = Infinity
  let max = -Infinity
  for (const row of rows) {
    const cells = row as Record<string, unknown>
    let sum = 0
    for (const k of keys) {
      const v = cells[k]
      if (typeof v !== 'number') continue
      sum += v
      if (v < min) min = v
    }
    if (sum > max) max = sum
  }
  if (!Number.isFinite(max) || !Number.isFinite(min)) return 36
  // Ticks split the range in roughly four; a small step means decimals.
  const step = (max - min) / 4
  const decimals =
    step > 0 && step < 1 ? Math.ceil(-Math.log10(step)) + 1 : 0
  const label =
    Math.abs(max) >= 1000 ? compact(max) : Math.abs(max).toFixed(decimals)
  return label.length <= 3 ? 36 : label.length <= 4 ? 44 : 52
}

/** A number rounded to a tenth with its unit; anything else is a dash. */
export function fmtValue(v: unknown, unit = ''): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—'
  const n = (Math.round(v * 10) / 10).toLocaleString()
  return unit ? `${n} ${unit}` : n
}

export interface TipRow {
  label?: string
  value: string
  color?: string
}

/** The tooltip block: a date line, then one row per value. */
export function ChartTip({ title, rows }: { title: ReactNode; rows: TipRow[] }) {
  return (
    <div className="rounded-sm bg-surface px-3 py-2 text-caption shadow-float">
      <p className="font-semibold text-ink">{title}</p>
      {rows.map((r, i) => (
        <p key={i} className="flex items-center gap-1.5 text-ink-2">
          {r.color && (
            <span
              aria-hidden="true"
              className="h-2 w-2 shrink-0 rounded-pill"
              style={{ background: r.color }}
            />
          )}
          {r.label && <span className="text-ink-3">{r.label}</span>}
          <span className="font-medium text-ink-2">{r.value}</span>
        </p>
      ))}
    </div>
  )
}

/** The row under the pointer, or nothing when the tooltip is idle. */
function activeRow<T>(p: TooltipContentProps): T | null {
  if (!p.active || !p.payload || p.payload.length === 0) return null
  return (p.payload[0].payload as T) ?? null
}

/** A 4px circle on one index only; every other point stays bare. */
function lastDot(colour: string, last: number) {
  return (p: DotItemDotProps & { key?: Key | null }) =>
    p.index === last && p.cx != null && p.cy != null ? (
      <circle key={p.key ?? undefined} cx={p.cx} cy={p.cy} r={4} fill={colour} />
    ) : null
}

export interface TrendPoint {
  date: string
  value: number | null
  baseline?: number | null
}

/**
 * One series over time: a 2px monotone line over a soft area, a dot on
 * the last point, and an optional dashed baseline.
 */
export function TrendChart({
  data,
  tone,
  unit,
  domain,
  height = 200,
  baselineLabel = 'baseline',
  formatX = shortDate,
  animate = true,
  connectNulls = true,
  ticks,
}: {
  data: TrendPoint[]
  tone: ChartTone
  unit: string
  domain?: Domain
  height?: number
  baselineLabel?: string
  formatX?: (x: string) => string
  animate?: boolean
  /** False leaves missing days as gaps instead of bridging them. */
  connectNulls?: boolean
  ticks?: number[]
}) {
  const colour = TONE[tone]
  const hasBaseline = data.some((d) => d.baseline != null)
  let last = -1
  for (let i = data.length - 1; i >= 0; i--) {
    if (data[i].value != null) {
      last = i
      break
    }
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={MARGIN}>
        <CartesianGrid stroke="var(--hairline)" vertical={false} />
        <XAxis dataKey="date" {...AXIS} tickFormatter={formatX} minTickGap={32} />
        <YAxis
          {...AXIS}
          width={yWidth(data, ['value'])}
          domain={domain ?? ['auto', 'auto']}
          ticks={ticks}
          tickFormatter={compact}
        />
        <Tooltip
          cursor={LINE_CURSOR}
          content={(p: TooltipContentProps) => {
            const row = activeRow<TrendPoint>(p)
            if (!row) return null
            const rows: TipRow[] = [{ value: fmtValue(row.value, unit) }]
            if (row.baseline != null) {
              rows.push({ value: `${baselineLabel} ${fmtValue(row.baseline)}` })
            }
            return <ChartTip title={formatX(row.date)} rows={rows} />
          }}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke={colour}
          strokeWidth={2}
          fill={colour}
          fillOpacity={0.12}
          dot={lastDot(colour, last)}
          activeDot={{ r: 4, fill: colour, stroke: 'var(--surface)', strokeWidth: 2 }}
          connectNulls={connectNulls}
          isAnimationActive={animate}
        />
        {hasBaseline && (
          <Line
            type="monotone"
            dataKey="baseline"
            stroke="var(--ink-3)"
            strokeWidth={1}
            strokeDasharray="3 4"
            dot={false}
            activeDot={false}
            connectNulls
            isAnimationActive={animate}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  )
}

export interface LineKey {
  key: string
  label: string
  color: string
}

/** Several series over time, gaps left as gaps, with a legend row underneath. */
export function LinesChart({
  data,
  keys,
  unit,
  domain,
  ticks,
  height = 200,
  xKey = 'date',
  formatX = shortDate,
}: {
  data: object[]
  keys: LineKey[]
  unit: string
  domain?: Domain
  ticks?: number[]
  height?: number
  xKey?: string
  formatX?: (x: string) => string
}) {
  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={MARGIN}>
          <CartesianGrid stroke="var(--hairline)" vertical={false} />
          <XAxis dataKey={xKey} {...AXIS} tickFormatter={formatX} minTickGap={32} />
          <YAxis
            {...AXIS}
            width={yWidth(data, keys.map((k) => k.key))}
            domain={domain ?? ['auto', 'auto']}
            ticks={ticks}
            tickFormatter={compact}
          />
          <Tooltip
            cursor={LINE_CURSOR}
            content={(p: TooltipContentProps) => {
              const row = activeRow<Record<string, unknown>>(p)
              if (!row) return null
              const rows: TipRow[] = keys
                .filter((k) => typeof row[k.key] === 'number')
                .map((k) => ({
                  label: k.label,
                  value: fmtValue(row[k.key], unit),
                  color: k.color,
                }))
              if (rows.length === 0) return null
              return <ChartTip title={formatX(String(row[xKey]))} rows={rows} />
            }}
          />
          {keys.map((k) => (
            <Line
              key={k.key}
              type="monotone"
              dataKey={k.key}
              stroke={k.color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: k.color, stroke: 'var(--surface)', strokeWidth: 2 }}
              connectNulls={false}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-micro text-ink-3">
        {keys.map((k) => (
          <span key={k.key} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-pill"
              style={{ background: k.color }}
            />
            {k.label}
          </span>
        ))}
      </div>
    </div>
  )
}

export interface StackKey {
  key: string
  label: string
  color: string
}

/** Stacked bars per period with a legend row underneath. */
export function StackedBars({
  data,
  keys,
  unit,
  height = 200,
  xKey = 'week',
  formatX = shortDate,
}: {
  data: object[]
  keys: StackKey[]
  unit: string
  height?: number
  xKey?: string
  formatX?: (x: string) => string
}) {
  const top = keys.length - 1
  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={MARGIN}>
          <CartesianGrid stroke="var(--hairline)" vertical={false} />
          <XAxis dataKey={xKey} {...AXIS} tickFormatter={formatX} minTickGap={24} />
          <YAxis
            {...AXIS}
            width={yWidth(data, keys.map((k) => k.key))}
            tickFormatter={compact}
          />
          <Tooltip
            cursor={BAR_CURSOR}
            content={(p: TooltipContentProps) => {
              const row = activeRow<Record<string, unknown>>(p)
              if (!row) return null
              return (
                <ChartTip
                  title={formatX(String(row[xKey]))}
                  rows={keys.map((k) => ({
                    label: k.label,
                    value: fmtValue(row[k.key], unit),
                    color: k.color,
                  }))}
                />
              )
            }}
          />
          {keys.map((k, i) => (
            <Bar
              key={k.key}
              dataKey={k.key}
              stackId="s"
              fill={k.color}
              radius={i === top ? [4, 4, 0, 0] : undefined}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-micro text-ink-3">
        {keys.map((k) => (
          <span key={k.key} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-pill"
              style={{ background: k.color }}
            />
            {k.label}
          </span>
        ))}
      </div>
    </div>
  )
}

/** A single bar series. `extra` adds a second tooltip row from the row. */
export function Bars({
  data,
  xKey,
  dataKey,
  unit,
  tone = 'brand',
  domain,
  height = 180,
  formatX = shortDate,
  extra,
}: {
  data: object[]
  xKey: string
  dataKey: string
  unit: string
  tone?: ChartTone
  domain?: Domain
  height?: number
  formatX?: (x: string) => string
  extra?: (row: Record<string, unknown>) => string | undefined
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={MARGIN}>
        <CartesianGrid stroke="var(--hairline)" vertical={false} />
        <XAxis dataKey={xKey} {...AXIS} tickFormatter={formatX} minTickGap={24} />
        <YAxis
          {...AXIS}
          width={yWidth(data, [dataKey])}
          domain={domain ?? ['auto', 'auto']}
          tickFormatter={compact}
        />
        <Tooltip
          cursor={BAR_CURSOR}
          content={(p: TooltipContentProps) => {
            const row = activeRow<Record<string, unknown>>(p)
            if (!row) return null
            const rows: TipRow[] = [{ value: fmtValue(row[dataKey], unit) }]
            const more = extra?.(row)
            if (more) rows.push({ value: more })
            return <ChartTip title={formatX(String(row[xKey]))} rows={rows} />
          }}
        />
        <Bar dataKey={dataKey} fill={TONE[tone]} radius={4} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export interface ComboSeries {
  key: string
  label: string
  color: string
  kind: 'bar' | 'line'
  /** Which y axis carries it; the right axis appears when any series asks. */
  axis?: 'left' | 'right'
  unit?: string
  dashed?: boolean
  strokeWidth?: number
  /** Tooltip value; defaults to the number with its unit. */
  format?: (v: number) => string
}

export interface ComboAxis {
  domain?: Domain
  reversed?: boolean
  format?: (v: number) => string
  /** Axis width; clock labels need more than the 36px default. */
  width?: number
}

/**
 * Bars and lines sharing an x axis, with an optional second y axis on
 * the right — load against recovery, pace against heart rate.
 */
export function ComboChart({
  data,
  series,
  xKey = 'date',
  height = 200,
  left,
  right,
  formatX = shortDate,
}: {
  data: object[]
  series: ComboSeries[]
  xKey?: string
  height?: number
  left?: ComboAxis
  right?: ComboAxis
  formatX?: (x: string) => string
}) {
  const hasRight = series.some((s) => s.axis === 'right')
  const hasBar = series.some((s) => s.kind === 'bar')
  const keysOn = (axis: 'left' | 'right') =>
    series.filter((s) => (s.axis ?? 'left') === axis).map((s) => s.key)
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ ...MARGIN, right: hasRight ? -8 : 8 }}>
        <CartesianGrid stroke="var(--hairline)" vertical={false} />
        <XAxis dataKey={xKey} {...AXIS} tickFormatter={formatX} minTickGap={32} />
        <YAxis
          yAxisId="left"
          {...AXIS}
          width={left?.width ?? yWidth(data, keysOn('left'))}
          domain={left?.domain ?? ['auto', 'auto']}
          reversed={left?.reversed}
          tickFormatter={left?.format ?? compact}
        />
        {hasRight && (
          <YAxis
            yAxisId="right"
            orientation="right"
            {...AXIS}
            width={right?.width ?? yWidth(data, keysOn('right'))}
            domain={right?.domain ?? ['auto', 'auto']}
            reversed={right?.reversed}
            tickFormatter={right?.format ?? compact}
          />
        )}
        <Tooltip
          cursor={hasBar ? BAR_CURSOR : LINE_CURSOR}
          content={(p: TooltipContentProps) => {
            const row = activeRow<Record<string, unknown>>(p)
            if (!row) return null
            const rows: TipRow[] = []
            for (const s of series) {
              const v = row[s.key]
              if (typeof v !== 'number') continue
              rows.push({
                label: s.label,
                value: s.format ? s.format(v) : fmtValue(v, s.unit),
                color: s.color,
              })
            }
            return <ChartTip title={formatX(String(row[xKey]))} rows={rows} />
          }}
        />
        {series.map((s) =>
          s.kind === 'bar' ? (
            <Bar
              key={s.key}
              yAxisId={s.axis ?? 'left'}
              dataKey={s.key}
              fill={s.color}
              radius={4}
            />
          ) : (
            <Line
              key={s.key}
              yAxisId={s.axis ?? 'left'}
              type="monotone"
              dataKey={s.key}
              stroke={s.color}
              strokeWidth={s.strokeWidth ?? 2}
              strokeDasharray={s.dashed ? '3 4' : undefined}
              dot={false}
              activeDot={{ r: 4, fill: s.color, stroke: 'var(--surface)', strokeWidth: 2 }}
              connectNulls
            />
          ),
        )}
      </ComposedChart>
    </ResponsiveContainer>
  )
}
