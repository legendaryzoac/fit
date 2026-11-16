// The signed-in profile and the strap's state, from /api/me. Fetched once
// by the shell and shared, so Today, the Log, Trends and Settings all
// agree on whether a wearable is linked — and everything that only makes
// sense with one (recovery scores, sleep, captured sessions) can hide
// together when it is not.

import { useEffect, useSyncExternalStore } from 'react'
import type {
  Capabilities,
  MeResponse,
  ProviderInfo,
  StrapStatus,
} from '@fit/shared'
import type { Api } from './api'
import { storageKey } from './storage'

export type { Capabilities, ProviderInfo, StrapStatus } from '@fit/shared'

/** /api/me as the app holds it: `strap` and `providers` always present. */
export interface Me {
  userId?: string
  createdAt?: string
  /** The linked band, whichever it is. */
  strap: StrapStatus
  /** Bands that can be linked right now. */
  providers: ProviderInfo[]
}

const NO_CAPS: Capabilities = {
  recoveryScore: false,
  strain: false,
  sessions: false,
  steps: false,
}
const WHOOP_CAPS: Capabilities = {
  recoveryScore: true,
  strain: true,
  sessions: true,
  steps: false,
}

/**
 * /api/me in either of its shapes. The API and this app deploy
 * separately, so an older API (or a profile cached by an older app) has
 * only the `whoop` key: that reads as a WHOOP strap, the one band there
 * was. Anything unrecognisable is null.
 */
export function normalizeMe(body: unknown): Me | null {
  if (!body || typeof body !== 'object') return null
  const raw = body as Partial<MeResponse>
  if (!raw.strap && !raw.whoop) return null
  const legacy = raw.whoop ?? { connected: false }
  const strap: StrapStatus = raw.strap ?? {
    ...legacy,
    ...((legacy.connected || legacy.status) && {
      provider: 'whoop',
      capabilities: WHOOP_CAPS,
    }),
  }
  return {
    userId: raw.userId,
    createdAt: raw.createdAt,
    strap,
    providers: raw.providers ?? [{ id: 'whoop', label: 'WHOOP' }],
  }
}

const CACHE_KEY = 'fit.meCache'

let current: Me | null = null
const subs = new Set<() => void>()

function loadCache(): Me | null {
  try {
    const raw = localStorage.getItem(storageKey(CACHE_KEY))
    return raw ? normalizeMe(JSON.parse(raw)) : null
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
    const body = normalizeMe(await res.json())
    if (!body) return current
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
  return me?.strap.connected === true || me?.strap.status === 'error'
}

/**
 * What the linked band can ever supply; nothing without one. Screens show
 * a metric when it has data, and use these only to drop whole sections a
 * band will never fill (captured sessions, strain).
 */
export function strapCaps(me: Me | null): Capabilities {
  return strapLinked(me) ? (me?.strap.capabilities ?? NO_CAPS) : NO_CAPS
}

/** The linked band's name, for copy: "WHOOP", "Fitbit Air", else "Strap". */
export function strapLabel(me: Me | null): string {
  const id = me?.strap.provider
  return me?.providers.find((p) => p.id === id)?.label ?? (id === 'whoop' ? 'WHOOP' : 'Strap')
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
