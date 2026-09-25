/**
 * Preferred weight unit for new workouts. A device setting like theme, so
 * it follows the same persisted-preference + useSyncExternalStore pattern
 * (see lib/theme.ts), but is namespaced per storage.ts so demo mode never
 * touches the signed-in user's preference.
 */
import { storageKey } from './storage'

export type WeightUnit = 'lb' | 'kg'

const KEY = 'fit.unit'

const listeners = new Set<() => void>()

export function getUnitPref(): WeightUnit {
  try {
    return localStorage.getItem(storageKey(KEY)) === 'kg' ? 'kg' : 'lb'
  } catch {
    return 'lb'
  }
}

export function setUnitPref(unit: WeightUnit): void {
  try {
    localStorage.setItem(storageKey(KEY), unit)
  } catch {
    // storage unavailable — the choice still applies for this page
  }
  for (const fn of listeners) fn()
}

export function subscribeUnit(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
