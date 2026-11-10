// The value a datetime-local input takes: local wall time, no zone.

/**
 * "2026-11-09T18:00" for a moment, in local time. The year is padded to
 * four digits: while a year is typed one digit at a time the browser
 * reports years 2, 20, 202, and anything shorter than four digits is not
 * a value the input accepts, so a controlled field would blank itself
 * after the first keystroke.
 */
export function localInputValue(when: Date | string): string {
  const d = typeof when === 'string' ? new Date(when) : when
  const pad = (n: number, width = 2) => String(n).padStart(width, '0')
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
