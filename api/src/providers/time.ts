// Time shapes shared by adapters. The contract is: instants are UTC ISO
// strings with milliseconds, offsets are `±HH:MM`, days are `YYYY-MM-DD`.

export interface CivilDate {
  year: number
  month: number
  day: number
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Any parseable timestamp → `2026-11-12T06:30:00.000Z`. */
export function toUtcIso(time: string): string {
  return new Date(time).toISOString()
}

/** A duration in seconds (`"-14400s"`, `"19800s"`, `-14400`) → `-04:00`, `+05:30`. */
export function toOffset(seconds: string | number | undefined): string | undefined {
  if (seconds === undefined) return undefined
  const total = typeof seconds === 'number' ? seconds : Number.parseFloat(seconds)
  if (!Number.isFinite(total)) return undefined
  const minutes = Math.round(Math.abs(total) / 60)
  return `${total < 0 ? '-' : '+'}${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
}

export function isoDate(date: CivilDate): string {
  return `${date.year}-${pad(date.month)}-${pad(date.day)}`
}

/** The UTC calendar day of an instant, shifted by whole days. */
export function utcDay(at: Date, shiftDays = 0): CivilDate {
  const d = new Date(at.getTime() + shiftDays * 86_400_000)
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}

export function civilToUtc(date: CivilDate): Date {
  return new Date(Date.UTC(date.year, date.month - 1, date.day))
}
