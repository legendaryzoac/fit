// Trend math for the check-in and recovery adherence. Rules from the
// monitoring literature are encoded here, not implied by the UI: personal
// 28-day rolling baselines, no flags before 14 entries, missing days stay
// missing (never interpolated), weekly averages only with ≥3 entries.

import type { Checkin, CheckinItemKey } from './checkins'
import type { Workout } from './workouts'

export const BASELINE_WINDOW = 28
export const MIN_ENTRIES_FOR_FLAGS = 14
export const FLAG_Z = 1.5
export const FLAG_DAYS = 3

export interface DailyPoint {
  date: string
  value: number | null
}

/** One point per calendar day over the last `days`, null where no entry. */
export function dailySeries(
  checkins: Checkin[],
  key: CheckinItemKey,
  days: number,
  today: string,
): DailyPoint[] {
  const byDate = new Map(checkins.map((c) => [c.date, c]))
  const out: DailyPoint[] = []
  const end = new Date(`${today}T00:00:00`)
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end)
    d.setDate(end.getDate() - i)
    const date = localDay(d.toISOString())
    const v = byDate.get(date)?.[key]
    out.push({ date, value: typeof v === 'number' ? v : null })
  }
  return out
}

/** Local calendar date of an instant, YYYY-MM-DD (never UTC). */
export function localDay(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export interface Baseline {
  mean: number
  sd: number
  n: number
}

/** Mean and SD of the last `window` non-null values before (excluding) index i. */
export function baselineAt(
  series: DailyPoint[],
  i: number,
  window: number = BASELINE_WINDOW,
): Baseline | null {
  const vals: number[] = []
  for (let j = i - 1; j >= 0 && j >= i - window; j--) {
    const v = series[j].value
    if (v != null) vals.push(v)
  }
  if (vals.length === 0) return null
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length
  const sd = Math.sqrt(
    vals.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, vals.length - 1),
  )
  return { mean, sd, n: vals.length }
}

export interface ItemFlag {
  key: CheckinItemKey
  /** Negative z = below the person's own baseline (all items: higher is better). */
  z: number
  days: number
  baseline: number
}

/**
 * A plain-language flag when an item has sat past ±FLAG_Z SD of its own
 * baseline for the last FLAG_DAYS logged days. Nothing before 14 entries.
 */
export function flagFor(
  checkins: Checkin[],
  key: CheckinItemKey,
  today: string,
): ItemFlag | null {
  const series = dailySeries(checkins, key, BASELINE_WINDOW + FLAG_DAYS + 7, today)
  const logged = series.filter((p) => p.value != null)
  if (logged.length < MIN_ENTRIES_FOR_FLAGS) return null
  // Walk back over the last FLAG_DAYS logged days
  let count = 0
  let zSum = 0
  let base = 0
  for (let i = series.length - 1; i >= 0 && count < FLAG_DAYS; i--) {
    const v = series[i].value
    if (v == null) continue
    const b = baselineAt(series, i)
    if (!b || b.sd < 0.25 || b.n < 7) return null
    const z = (v - b.mean) / b.sd
    if (Math.abs(z) < FLAG_Z) return null
    if (count > 0 && Math.sign(z) !== Math.sign(zSum)) return null
    count++
    zSum += z
    base = b.mean
  }
  if (count < FLAG_DAYS) return null
  return { key, z: zSum / count, days: count, baseline: base }
}

/** Logged-day count over a window — shown beside every trend. */
export function compliance(
  checkins: Checkin[],
  days: number,
  today: string,
): { logged: number; days: number } {
  const series = dailySeries(checkins, 'sleep', days, today)
  return { logged: series.filter((p) => p.value != null).length, days }
}

// ---- recovery adherence ----

/** Distinct days with a recovery session in the last `days` (incl. today). */
export function recoveryDays(
  workouts: Workout[],
  days: number,
  today: string,
): Set<string> {
  const end = new Date(`${today}T00:00:00`)
  const start = new Date(end)
  start.setDate(end.getDate() - (days - 1))
  const out = new Set<string>()
  for (const w of workouts) {
    if (w.kind !== 'recovery') continue
    const day = localDay(w.start)
    if (day >= localDay(start.toISOString()) && day <= today) out.add(day)
  }
  return out
}

/** Bend's "Bendometer" idea: share of the last 28 days with a session. */
export function consistencyPct(
  workouts: Workout[],
  today: string,
  days: number = 28,
): number {
  return Math.round((recoveryDays(workouts, days, today).size / days) * 100)
}

export interface ModalityWeekRow {
  week: string
  [modality: string]: number | string
}

/** Minutes per modality per ISO-ish (Monday-first) week, last `weeks`. */
export function weeklyMinutesByModality(
  workouts: Workout[],
  weeks: number = 12,
): { rows: ModalityWeekRow[]; modalities: string[] } {
  const mondayOf = (iso: string): string => {
    const d = new Date(iso)
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    return localDay(d.toISOString())
  }
  const totals = new Map<string, Map<string, number>>()
  const seen = new Map<string, number>()
  for (const w of workouts) {
    if (w.kind !== 'recovery') continue
    const wk = mondayOf(w.start)
    const m = w.modality ?? 'stretch'
    const row = totals.get(wk) ?? new Map<string, number>()
    row.set(m, (row.get(m) ?? 0) + (w.durationMin ?? 0))
    totals.set(wk, row)
    seen.set(m, (seen.get(m) ?? 0) + (w.durationMin ?? 0))
  }
  const modalities = [...seen.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([m]) => m)
  // Fill the last N weeks, including empty ones, oldest first
  const rows: ModalityWeekRow[] = []
  const thisMonday = new Date(mondayOf(new Date().toISOString()) + 'T00:00:00')
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(thisMonday)
    d.setDate(thisMonday.getDate() - i * 7)
    const key = localDay(d.toISOString())
    const row: ModalityWeekRow = { week: key.slice(5) }
    for (const m of modalities) row[m] = totals.get(key)?.get(m) ?? 0
    rows.push(row)
  }
  return { rows, modalities }
}
