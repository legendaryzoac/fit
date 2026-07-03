import { muscleFor } from './exercises'
import { localDate } from './metrics'
import type { SessionRecord, Workout } from './workouts'

/** Epley estimated one-rep max; a single at weight is its own e1RM. */
export function epley(weight: number, reps: number): number {
  return reps <= 1 ? weight : weight * (1 + reps / 30)
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
  const mondayKey = (iso: string): string => {
    const d = new Date(iso)
    const shift = (d.getDay() + 6) % 7
    d.setDate(d.getDate() - shift)
    return d.toISOString().slice(0, 10)
  }

  const totals = new Map<string, Map<string, number>>() // week → muscle → lb
  const muscleTotals = new Map<string, number>()
  for (const w of workouts) {
    if (w.kind !== 'strength') continue
    const week = mondayKey(w.start)
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
