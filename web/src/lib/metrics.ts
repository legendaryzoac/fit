export interface RecoveryPoint {
  date: string
  recoveryScore?: number
  rhr?: number
  hrvMs?: number
  scoreState?: string
  userCalibrating?: boolean
}

export interface SleepRecord {
  end: string
  timezoneOffset?: string
  nap: boolean
  inBedMin?: number
  awakeMin?: number
  lightMin?: number
  deepMin?: number
  remMin?: number
  performancePct?: number
  efficiencyPct?: number
  consistencyPct?: number
  respiratoryRate?: number
  disturbances?: number
  scoreState?: string
}

export interface CycleRecord {
  start: string
  end?: string
  timezoneOffset?: string
  strain?: number
  kilojoule?: number
  avgHr?: number
  maxHr?: number
  scoreState?: string
}

export interface Metrics {
  days: number
  recoveries: RecoveryPoint[]
  sleeps: SleepRecord[]
  cycles: CycleRecord[]
}

/** UTC timestamp + WHOOP "-06:00"-style offset → the user's local date. */
export function localDate(iso: string, offset?: string): string {
  const match = offset?.match(/^([+-])(\d{2}):(\d{2})/)
  if (!match) return iso.slice(0, 10)
  const shift =
    (Number(match[2]) * 60 + Number(match[3])) *
    60_000 *
    (match[1] === '-' ? -1 : 1)
  return new Date(new Date(iso).getTime() + shift).toISOString().slice(0, 10)
}

/** Trailing mean over the previous `window` non-null values (inclusive). */
export function withRollingMean<T extends Record<string, unknown>>(
  points: T[],
  key: keyof T,
  outKey: string,
  window: number,
): Array<T & Record<string, number | null>> {
  const seen: number[] = []
  return points.map((point) => {
    const value = point[key]
    if (typeof value === 'number') seen.push(value)
    const slice = seen.slice(-window)
    const mean =
      slice.length >= Math.min(7, window)
        ? slice.reduce((a, b) => a + b, 0) / slice.length
        : null
    return {
      ...point,
      [outKey]: mean === null ? null : Math.round(mean * 10) / 10,
    } as T & Record<string, number | null>
  })
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}
