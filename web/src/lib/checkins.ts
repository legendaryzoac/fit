// Daily subjective check-in — the wearable-free readiness signal. Four
// single items on 1–5, oriented so HIGHER IS BETTER for every item
// (McLean 2010 anchors: 5 = very restful sleep, very fresh, no soreness,
// very relaxed). One row per local day, overwritten on re-save, so
// offline retries are idempotent. Per-item storage, never a composite.

import { useCallback, useEffect, useState } from 'react'
import type { Api } from './api'
import { makeQueue } from './queue'
import { storageKey } from './storage'
import { localToday } from './weights'

export interface Checkin {
  /** YYYY-MM-DD, local. */
  date: string
  sleep?: number
  fatigue?: number
  soreness?: number
  stress?: number
  mood?: number
  soreRegions?: string[]
  /** Perceived Recovery Status 0–10, taken before a session. */
  prs?: number
  restingHr?: number
  hrvMs?: number
  note?: string
  updatedAt?: string
}

export type CheckinItemKey = 'sleep' | 'fatigue' | 'soreness' | 'stress'

export const CHECKIN_ITEMS: Array<{
  key: CheckinItemKey
  label: string
  low: string
  high: string
}> = [
  { key: 'sleep', label: 'Sleep', low: 'poor', high: 'restful' },
  { key: 'fatigue', label: 'Energy', low: 'exhausted', high: 'fresh' },
  { key: 'soreness', label: 'Soreness', low: 'very sore', high: 'none' },
  { key: 'stress', label: 'Stress', low: 'stressed', high: 'relaxed' },
]

/** True once the four core items are all present. */
export function checkinComplete(c: Checkin | undefined): boolean {
  return (
    !!c &&
    c.sleep != null &&
    c.fatigue != null &&
    c.soreness != null &&
    c.stress != null
  )
}

const CACHE_KEY = 'fit.checkinsCache'

export function loadCheckinCache(): Checkin[] {
  try {
    return JSON.parse(localStorage.getItem(storageKey(CACHE_KEY)) ?? '[]')
  } catch {
    return []
  }
}

export function saveCheckinCache(list: Checkin[]): void {
  localStorage.setItem(storageKey(CACHE_KEY), JSON.stringify(list))
}

/** Newest first, one per date. */
export function sortCheckins(list: Checkin[]): Checkin[] {
  const byDate = new Map<string, Checkin>()
  for (const c of list) byDate.set(c.date, c)
  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date))
}

export function todayCheckin(list: Checkin[]): Checkin | undefined {
  const today = localToday()
  return list.find((c) => c.date === today)
}

const queue = makeQueue<Checkin>(
  'fit.pendingCheckins',
  '/api/checkins',
  (c) => c.date,
)

/**
 * Shared check-in state: cache-seeded, refreshed from the API on mount,
 * saves optimistic + queued. Owned by the app shell so Today, the ledger
 * and the Recovery tab all see the same list.
 */
export function useCheckins(api: Api): {
  checkins: Checkin[]
  save: (patch: Partial<Checkin> & { date?: string }) => void
  pending: number
} {
  const [checkins, setCheckins] = useState<Checkin[]>(() =>
    sortCheckins(loadCheckinCache()),
  )
  const [pending, setPending] = useState(() => queue.load().length)

  const sync = useCallback(async () => {
    const { remaining } = await queue.flush(api)
    setPending(remaining)
    try {
      const res = await api.get('/api/checkins?days=180')
      if (!res.ok) return
      const body = await res.json()
      if (!Array.isArray(body.checkins)) return
      // Anything still queued is newer than what the server has
      const queued = queue.load()
      const merged = sortCheckins([...body.checkins, ...queued])
      setCheckins(merged)
      saveCheckinCache(merged)
    } catch {
      /* offline — cache stands */
    }
  }, [api])

  useEffect(() => {
    void sync()
    const onOnline = () => void sync()
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [sync])

  const save = useCallback(
    (patch: Partial<Checkin> & { date?: string }) => {
      const date = patch.date ?? localToday()
      setCheckins((prev) => {
        const existing = prev.find((c) => c.date === date)
        const entry: Checkin = { ...existing, ...patch, date }
        delete entry.updatedAt
        queue.enqueue(entry)
        // sortCheckins keeps the LAST entry per date — the new one goes last
        const next = sortCheckins([...prev, entry])
        saveCheckinCache(next)
        return next
      })
      setPending(queue.load().length)
      void queue.flush(api).then(({ remaining }) => setPending(remaining))
    },
    [api],
  )

  return { checkins, save, pending }
}
