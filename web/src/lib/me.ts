// The signed-in profile and the strap's state, from /api/me. Fetched once
// by the shell and shared, so Today, the Log, Trends and Settings all
// agree on whether a wearable is linked — and everything that only makes
// sense with one (recovery scores, sleep, captured sessions) can hide
// together when it is not.

import { useEffect, useSyncExternalStore } from 'react'
import type { Api } from './api'
import { storageKey } from './storage'

export interface StrapStatus {
  connected: boolean
  status?: 'active' | 'error'
  lastSyncAt?: string | null
  backfillDone?: boolean
  bodyWeightLb?: number
}

export interface Me {
  userId?: string
  createdAt?: string
  whoop: StrapStatus
}

const CACHE_KEY = 'fit.meCache'

let current: Me | null = null
const subs = new Set<() => void>()

function loadCache(): Me | null {
  try {
    const raw = localStorage.getItem(storageKey(CACHE_KEY))
    const me = raw ? (JSON.parse(raw) as Me) : null
    return me && typeof me === 'object' && me.whoop ? me : null
  } catch {
    return null
  }
}

function publish(me: Me | null): void {
  current = me
  for (const fn of subs) fn()
}

export function getMe(): Me | null {
  return current
}

export function subscribeMe(fn: () => void): () => void {
  subs.add(fn)
  return () => subs.delete(fn)
}

/** Ask the server again; offline, whatever we last knew stands. */
export async function refreshMe(api: Api): Promise<Me | null> {
  try {
    const res = await api.get('/api/me')
    if (!res.ok) return current
    const body = (await res.json()) as Me
    if (!body || typeof body !== 'object' || !body.whoop) return current
    publish(body)
    try {
      localStorage.setItem(storageKey(CACHE_KEY), JSON.stringify(body))
    } catch {
      // storage unavailable — the in-memory copy still serves this page
    }
  } catch {
    // offline — the cache stands
  }
  return current
}

/**
 * A strap counts as linked while a connection exists, whether it is
 * syncing or waiting on a re-auth. Only an account that never connected
 * one, or disconnected it, hides the strap-only parts of the app.
 */
export function strapLinked(me: Me | null): boolean {
  return me?.whoop.connected === true || me?.whoop.status === 'error'
}

/**
 * The shared profile. The shell passes the api: that re-seeds from the
 * cache of the storage namespace in use (demo and signed-in differ) and
 * asks the server once. Everyone else reads without.
 */
export function useMe(api?: Api): Me | null {
  const me = useSyncExternalStore(subscribeMe, getMe, getMe)
  useEffect(() => {
    if (!api) return
    publish(loadCache())
    void refreshMe(api)
  }, [api])
  return me
}
