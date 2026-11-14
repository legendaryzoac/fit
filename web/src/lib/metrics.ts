// The wearable records and the /api/metrics shape come from the shared
// contract; the names below are the ones this app has always used.
export type {
  DailyLoad as CycleRecord,
  DailySteps,
  DailyVitals as RecoveryPoint,
  MetricsResponse as Metrics,
  SleepRecord,
} from '@fit/shared'

/** UTC timestamp + the wearer's "-06:00"-style offset → their local date. */
export function localDate(iso: string, offset?: string): string {
  const match = offset?.match(/^([+-])(\d{2}):(\d{2})/)
  if (!match) return iso.slice(0, 10)
  const shift =
    (Number(match[2]) * 60 + Number(match[3])) *
    60_000 *
    (match[1] === '-' ? -1 : 1)
  return new Date(new Date(iso).getTime() + shift).toISOString().slice(0, 10)
}

/**
 * A reading's moment as epoch ms, for "how old is this". Bands that
 * report per day send a bare date, which JavaScript would read as UTC
 * midnight — the evening before, west of Greenwich — so a bare date
 * means local noon of that day. A full timestamp is taken as it is.
 */
export function dayTime(date: string): number {
  const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!bare) return new Date(date).getTime()
  return new Date(Number(bare[1]), Number(bare[2]) - 1, Number(bare[3]), 12).getTime()
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
