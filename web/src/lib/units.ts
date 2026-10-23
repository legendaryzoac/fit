/**
 * Preferred weight unit for new workouts. A device setting like theme, so
 * it follows the same persisted-preference + useSyncExternalStore pattern
 * (see lib/theme.ts), but is namespaced per storage.ts so demo mode never
 * touches the signed-in user's preference.
 */
import { useSyncExternalStore } from 'react'
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

export function useUnitPref(): WeightUnit {
  return useSyncExternalStore(subscribeUnit, getUnitPref, getUnitPref)
}

const KG_PER_LB = 0.45359237

/** Stored pounds shown in the preferred unit, to one decimal. */
export function fromLb(lb: number, unit: WeightUnit): number {
  const v = unit === 'kg' ? lb * KG_PER_LB : lb
  return Math.round(v * 10) / 10
}

/** A figure typed in the preferred unit, back to the stored pounds. */
export function toLb(value: number, unit: WeightUnit): number {
  const lb = unit === 'kg' ? value / KG_PER_LB : value
  return Math.round(lb * 10) / 10
}
