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
