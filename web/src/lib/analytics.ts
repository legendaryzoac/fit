import { muscleFor } from './exercises'
import { localDate } from './metrics'
import type { SessionRecord, Workout } from './workouts'

/** Epley estimated one-rep max; a single at weight is its own e1RM. */
export function epley(weight: number, reps: number): number {
  return reps <= 1 ? weight : weight * (1 + reps / 30)
}

/**
 * Monday of the week containing a calendar day. Anchoring at noon UTC keeps
 * the whole computation in one time frame — mixing local getDay() with UTC
 * toISOString() used to split evening sessions into a phantom second bucket.
 */
function mondayOf(dayIso: string): string {
  const d = new Date(`${dayIso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

/** Calendar day in the browser's timezone — right frame for hand-logged workouts. */
function browserLocalDay(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export interface E1rmPoint {
  date: string
  e1rm: number
  bestSet: string
}

/** Best e1RM per training day for one exercise, oldest first. */
export function e1rmSeries(workouts: Workout[], exercise: string): E1rmPoint[] {
  const lower = exercise.toLowerCase()
  const byDate = new Map<string, E1rmPoint>()
  for (const w of workouts) {
    if (w.kind !== 'strength') continue
    const match = w.exercises.find((e) => e.name.toLowerCase() === lower)
    if (!match) continue
    let best: E1rmPoint | null = null
    const date = w.start.slice(0, 10)
    for (const s of match.sets) {
      if (s.weight == null || s.reps == null || s.reps < 1) continue
      const value = Math.round(epley(s.weight, s.reps) * 10) / 10
      if (!best || value > best.e1rm) {
        best = { date, e1rm: value, bestSet: `${s.weight}×${s.reps}` }
      }
    }
    if (!best) continue
    const existing = byDate.get(date)
    if (!existing || best.e1rm > existing.e1rm) byDate.set(date, best)
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export function exercisesByFrequency(workouts: Workout[]): string[] {
  const counts = new Map<string, number>()
  for (const w of workouts) {
    if (w.kind !== 'strength') continue
    for (const e of w.exercises) {
      if (e.sets.some((s) => s.weight != null && s.reps != null)) {
        counts.set(e.name, (counts.get(e.name) ?? 0) + 1)
      }
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name)
}

export interface PrRow {
  exercise: string
  bestE1rm: number
  bestSet: string
  date: string
}

export function personalRecords(workouts: Workout[], top = 6): PrRow[] {
  return exercisesByFrequency(workouts)
    .slice(0, top)
    .flatMap((exercise) => {
      const series = e1rmSeries(workouts, exercise)
      if (series.length === 0) return []
      const best = series.reduce((a, b) => (b.e1rm >= a.e1rm ? b : a))
      return [
        {
          exercise,
          bestE1rm: Math.round(best.e1rm),
          bestSet: best.bestSet,
          date: best.date,
        },
      ]
    })
}

export interface WeekVolumeRow {
  week: string
  [muscle: string]: number | string
}

/** Weekly tonnage (weight×reps) stacked by muscle group, last `weeks` weeks. */
export function weeklyVolume(
  workouts: Workout[],
  weeks = 12,
): { rows: WeekVolumeRow[]; muscles: string[] } {
  const totals = new Map<string, Map<string, number>>() // week → muscle → lb
  const muscleTotals = new Map<string, number>()
  for (const w of workouts) {
    if (w.kind !== 'strength') continue
    const week = mondayOf(browserLocalDay(w.start))
    for (const e of w.exercises) {
      const muscle = muscleFor(e.name) ?? 'other'
      for (const s of e.sets) {
        if (s.weight == null || s.reps == null) continue
        const tonnage = s.weight * s.reps
        const perWeek = totals.get(week) ?? new Map<string, number>()
        perWeek.set(muscle, (perWeek.get(muscle) ?? 0) + tonnage)
        totals.set(week, perWeek)
        muscleTotals.set(muscle, (muscleTotals.get(muscle) ?? 0) + tonnage)
      }
    }
  }

  const topMuscles = [...muscleTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([m]) => m)
  const hasOther = muscleTotals.size > topMuscles.length

  const rows = [...totals.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-weeks)
    .map(([week, perMuscle]) => {
      const row: WeekVolumeRow = { week: week.slice(5) }
      for (const m of topMuscles) row[m] = Math.round(perMuscle.get(m) ?? 0)
      if (hasOther) {
        let other = 0
        for (const [m, v] of perMuscle) {
          if (!topMuscles.includes(m)) other += v
        }
        row.other = Math.round(other)
      }
      return row
    })

  return { rows, muscles: hasOther ? [...topMuscles, 'other'] : topMuscles }
}

export interface LoadRecoveryPoint {
  date: string
  strain?: number
  recovery?: number
}

/** Daily WHOOP strain against next-morning recovery — the flagship overlay. */
export function loadVsRecovery(
  recoveries: Array<{ date: string; recoveryScore?: number }>,
  cycles: Array<{ start: string; timezoneOffset?: string; strain?: number }>,
): LoadRecoveryPoint[] {
  const byDate = new Map<string, LoadRecoveryPoint>()
  const at = (date: string): LoadRecoveryPoint => {
    const existing = byDate.get(date)
    if (existing) return existing
    const fresh: LoadRecoveryPoint = { date }
    byDate.set(date, fresh)
    return fresh
  }
  for (const c of cycles) {
    if (c.strain == null) continue
    const date = localDate(c.start, c.timezoneOffset)
    const point = at(date)
    point.strain = Math.round(c.strain * 10) / 10
  }
  for (const r of recoveries) {
    if (r.recoveryScore == null) continue
    at(r.date.slice(0, 10)).recovery = r.recoveryScore
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export interface SprintPoint {
  date: string
  bestSec: number
}

export function drillsByFrequency(workouts: Workout[]): string[] {
  const counts = new Map<string, number>()
  for (const w of workouts) {
    if (w.kind !== 'speed') continue
    for (const e of w.exercises) {
      if (e.sets.some((s) => s.durationSec != null)) {
        counts.set(e.name, (counts.get(e.name) ?? 0) + 1)
      }
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name)
}

/** Fastest rep per day for one drill — lower is better. */
export function sprintSeries(workouts: Workout[], drill: string): SprintPoint[] {
  const lower = drill.toLowerCase()
  const byDate = new Map<string, number>()
  for (const w of workouts) {
    if (w.kind !== 'speed') continue
    const match = w.exercises.find((e) => e.name.toLowerCase() === lower)
    if (!match) continue
    const date = w.start.slice(0, 10)
    for (const s of match.sets) {
      if (s.durationSec == null || s.durationSec <= 0) continue
      const best = byDate.get(date)
      if (best === undefined || s.durationSec < best) {
        byDate.set(date, s.durationSec)
      }
    }
  }
  return [...byDate.entries()]
    .map(([date, bestSec]) => ({ date, bestSec }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export interface ExerciseDetailPoint {
  date: string
  volume: number
  sets: number
  topWeight?: number
  e1rm?: number
}

/** Per-session volume, heaviest set, and e1RM for one exercise. */
export function exerciseDetail(
  workouts: Workout[],
  exercise: string,
): ExerciseDetailPoint[] {
  const lower = exercise.toLowerCase()
  const byDate = new Map<string, ExerciseDetailPoint>()
  for (const w of workouts) {
    if (w.kind !== 'strength') continue
    const match = w.exercises.find((e) => e.name.toLowerCase() === lower)
    if (!match) continue
    const date = w.start.slice(0, 10)
    const point = byDate.get(date) ?? { date, volume: 0, sets: 0 }
    for (const s of match.sets) {
      if (s.weight == null || s.reps == null) continue
      point.sets += 1
      point.volume += s.weight * s.reps
      if (point.topWeight === undefined || s.weight > point.topWeight) {
        point.topWeight = s.weight
      }
      const est = Math.round(epley(s.weight, s.reps) * 10) / 10
      if (point.e1rm === undefined || est > point.e1rm) point.e1rm = est
    }
    if (point.sets > 0) {
      point.volume = Math.round(point.volume)
      byDate.set(date, point)
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export interface ZoneWeekRow {
  week: string
  z1: number
  z2: number
  z3: number
  z4: number
  z5: number
}

/** Hours per HR zone per week across all captured activity. */
export function weeklyZones(sessions: SessionRecord[], weeks = 12): ZoneWeekRow[] {
  const totals = new Map<string, ZoneWeekRow>()
  for (const s of sessions) {
    if (!s.zoneMin) continue
    // The session's own timezone offset puts it on the right calendar day
    const week = mondayOf(localDate(s.start, s.timezoneOffset))
    const row =
      totals.get(week) ?? { week, z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 }
    row.z1 += s.zoneMin.z1 ?? 0
    row.z2 += s.zoneMin.z2 ?? 0
    row.z3 += s.zoneMin.z3 ?? 0
    row.z4 += s.zoneMin.z4 ?? 0
    row.z5 += s.zoneMin.z5 ?? 0
    totals.set(week, row)
  }
  return [...totals.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-weeks)
    .map(([week, row]) => ({
      week: week.slice(5),
      z1: Math.round((row.z1 / 60) * 10) / 10,
      z2: Math.round((row.z2 / 60) * 10) / 10,
      z3: Math.round((row.z3 / 60) * 10) / 10,
      z4: Math.round((row.z4 / 60) * 10) / 10,
      z5: Math.round((row.z5 / 60) * 10) / 10,
    }))
}

/** Decimal clock hours in the sleep's own timezone, minus an offset in minutes. */
function localClock(iso: string, offset?: string, minusMin = 0): number {
  const m = offset?.match(/^([+-])(\d{2}):(\d{2})/)
  const shift = m
    ? (Number(m[2]) * 60 + Number(m[3])) * 60_000 * (m[1] === '-' ? -1 : 1)
    : 0
  const d = new Date(new Date(iso).getTime() + shift - minusMin * 60_000)
  return d.getUTCHours() + d.getUTCMinutes() / 60
}

export interface BedtimePoint {
  date: string
  /** Hours relative to midnight; 23:30 → -0.5 so lines don't wrap. */
  bed: number
  wake: number
}

/** Bed and wake times per night (bedtime derived as end − time in bed). */
export function bedtimeSeries(
  sleeps: Array<{
    end: string
    timezoneOffset?: string
    nap: boolean
    inBedMin?: number
  }>,
): BedtimePoint[] {
  return sleeps
    .flatMap((s) => {
      if (s.nap || s.inBedMin == null) return []
      const wake = localClock(s.end, s.timezoneOffset)
      const bedRaw = localClock(s.end, s.timezoneOffset, s.inBedMin)
      const bed = bedRaw > 12 ? bedRaw - 24 : bedRaw
      return [
        {
          date: localDate(s.end, s.timezoneOffset),
          bed: Math.round(bed * 100) / 100,
          wake: Math.round(wake * 100) / 100,
        },
      ]
    })
    .sort((a, b) => a.date.localeCompare(b.date))
}

export interface WeekdayRecovery {
  day: string
  avg: number
  nights: number
}

export function recoveryByWeekday(
  recoveries: Array<{ date: string; recoveryScore?: number }>,
): WeekdayRecovery[] {
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const sums = new Map<string, { total: number; n: number }>()
  for (const r of recoveries) {
    if (r.recoveryScore == null) continue
    const utcDay = new Date(`${r.date.slice(0, 10)}T12:00:00Z`).getUTCDay()
    const day = DAYS[(utcDay + 6) % 7]
    const entry = sums.get(day) ?? { total: 0, n: 0 }
    entry.total += r.recoveryScore
    entry.n += 1
    sums.set(day, entry)
  }
  return DAYS.flatMap((day) => {
    const entry = sums.get(day)
    if (!entry) return []
    return [{ day, avg: Math.round(entry.total / entry.n), nights: entry.n }]
  })
}

export interface RunPoint {
  date: string
  paceMinMi: number
  avgHr?: number
}

/** Pace + heart rate for WHOOP-detected runs — efficiency shows as the gap narrowing. */
export function runSeries(sessions: SessionRecord[]): RunPoint[] {
  const MILE = 1609.34
  return sessions
    .flatMap((s) => {
      if (s.sport !== 'running' || s.distanceM == null || !s.end) return []
      const miles = s.distanceM / MILE
      if (miles < 0.75) return []
      const minutes =
        (new Date(s.end).getTime() - new Date(s.start).getTime()) / 60_000
      if (minutes <= 0) return []
      return [
        {
          date: localDate(s.start, s.timezoneOffset),
          paceMinMi: Math.round((minutes / miles) * 100) / 100,
          avgHr: s.avgHr,
        },
      ]
    })
    .sort((a, b) => a.date.localeCompare(b.date))
}
