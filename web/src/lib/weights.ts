import type { Api } from './api'
import { makeQueue } from './queue'
import { storageKey } from './storage'

/**
 * Manually logged body weight — one entry per local calendar date. Kept
 * independent of WHOOP so bodyweight-exercise ghosts, e1RM math, and the
 * trend keep working when a strap or subscription goes away.
 */
export interface WeightEntry {
  /** YYYY-MM-DD, local. */
  date: string
  lb: number
}

const CACHE_KEY = 'fit.weightsCache'

export function loadWeightCache(): WeightEntry[] {
  try {
    return JSON.parse(localStorage.getItem(storageKey(CACHE_KEY)) ?? '[]')
  } catch {
    return []
  }
}

export function saveWeightCache(list: WeightEntry[]): void {
  localStorage.setItem(storageKey(CACHE_KEY), JSON.stringify(list))
}

/** Today's local date as YYYY-MM-DD. */
export function localToday(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Newest entry first. */
export function sortWeights(list: WeightEntry[]): WeightEntry[] {
  return [...list].sort((a, b) => b.date.localeCompare(a.date))
}

/** One entry per date, the new one winning; newest first. */
export function upsertWeight(
  list: WeightEntry[],
  entry: WeightEntry,
): WeightEntry[] {
  return sortWeights([...list.filter((e) => e.date !== entry.date), entry])
}

// ---- offline write queue ----
// A weigh-in lands locally first and POSTs when it can, like a workout or
// a check-in, so the morning prompt works at the gym with no signal.

const queue = makeQueue<WeightEntry>(
  'fit.pendingWeights',
  '/api/weights',
  (e) => e.date,
)

export function loadPendingWeights(): WeightEntry[] {
  return queue.load()
}

export function enqueueWeight(entry: WeightEntry): void {
  queue.enqueue(entry)
}

export function flushWeights(
  api: Api,
): Promise<{ flushed: number; remaining: number }> {
  return queue.flush(api)
}

/** The server's list with anything still queued laid over it, so an entry
 * mid-flush never vanishes when the server list (which lacks it) lands. */
export function mergeWeights(
  server: WeightEntry[],
  pending: WeightEntry[],
): WeightEntry[] {
  const queued = new Set(pending.map((e) => e.date))
  return sortWeights([...pending, ...server.filter((e) => !queued.has(e.date))])
}

// ---- the morning weigh-in prompt ----
// Like the readiness check-in, it asks once a day; unlike it, only in the
// morning, when a weight means something. Waving it off is remembered
// for the day.

const DISMISS_KEY = 'fit.weighInDismissed'

/** The local date the prompt was last waved off on, if any. */
export function weighInDismissedOn(): string | null {
  try {
    return localStorage.getItem(storageKey(DISMISS_KEY))
  } catch {
    return null
  }
}

export function dismissWeighIn(date: string): void {
  try {
    localStorage.setItem(storageKey(DISMISS_KEY), date)
  } catch {
    // storage unavailable — the dismissal still holds for this page
  }
}

export const WEIGH_IN_UNTIL_HOUR = 12

/** Due before noon on a day with no entry that has not been waved off. */
export function weighInDue(
  entries: WeightEntry[],
  dismissedOn: string | null,
  now: Date = new Date(),
): boolean {
  if (now.getHours() >= WEIGH_IN_UNTIL_HOUR) return false
  const today = localToday()
  if (dismissedOn === today) return false
  return !entries.some((e) => e.date === today)
}

/**
 * The weight to use for bodyweight lifts: the newest manual entry when
 * there is one, else whatever WHOOP last measured. A number the lifter
 * typed always beats a number a strap guessed.
 */
export function currentBodyWeight(
  entries: WeightEntry[],
  whoopLb?: number,
): number | undefined {
  const newest = sortWeights(entries)[0]
  return newest?.lb ?? whoopLb
}
