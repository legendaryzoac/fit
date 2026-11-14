// The wearable's last 30 days, fetched once and shared: the home screen
// draws it, and the coach reads a few numbers from it. Without a linked
// strap there is nothing to ask for and nothing to show (the server keeps
// old scores after a disconnect, so the gate sits here).

import { useEffect, useState } from 'react'
import type { DailySteps, DailyVitals, SleepRecord } from '@fit/shared'
import type { StrapSummary } from './agent/types'
import type { Api } from './api'
import { dayTime } from './metrics'

export interface StrapMetrics {
  /** null until the first fetch lands. */
  recoveries: DailyVitals[] | null
  sleeps: SleepRecord[]
  steps: DailySteps[]
}

const NONE: StrapMetrics = { recoveries: [], sleeps: [], steps: [] }

/** Long enough for a sync the app asked for to have landed. */
const SYNC_SETTLE_MS = 9000

/** A vitals row with something measured on it, scored or not. */
export const hasVital = (r: DailyVitals): boolean =>
  r.recoveryScore != null || r.hrvMs != null || r.rhr != null

/**
 * `refreshKey` refetches when it changes (the shell passes the open tab, so
 * returning to Home asks again, as the screen did when it owned the fetch).
 * Coming back to a backgrounded app refetches too: an installed app left
 * open overnight must not present yesterday's score as this morning's.
 * The last numbers stay up while the new ones load.
 *
 * `syncOnOpen` is for bands that do not push their changes to the server:
 * each time the app comes to the front it asks the server to pull, then
 * reads again once that has had time to land. (The server ignores a
 * request made within ten minutes of the last.)
 */
export function useStrapMetrics(
  api: Api,
  linked: boolean,
  refreshKey?: string,
  syncOnOpen = false,
): StrapMetrics {
  const [metrics, setMetrics] = useState<StrapMetrics>({
    recoveries: null,
    sleeps: [],
    steps: [],
  })
  const [woke, setWoke] = useState(0)
  const [synced, setSynced] = useState(0)
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') setWoke((n) => n + 1)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])
  useEffect(() => {
    if (!linked || !syncOnOpen) return
    let timer: ReturnType<typeof setTimeout> | undefined
    api
      .send('POST', '/api/strap/sync')
      .then(async (res) => {
        if (!res.ok) return
        const body = await res.json()
        if (body?.started) timer = setTimeout(() => setSynced((n) => n + 1), SYNC_SETTLE_MS)
      })
      .catch(() => {})
    return () => clearTimeout(timer)
  }, [api, linked, syncOnOpen, woke])
  useEffect(() => {
    if (!linked) {
      setMetrics(NONE)
      return
    }
    let alive = true
    api
      .get('/api/metrics?days=30')
      .then(async (res) => {
        if (!res.ok || !alive) return
        const body = await res.json()
        if (!alive) return
        setMetrics({
          recoveries: Array.isArray(body.recoveries) ? body.recoveries : [],
          sleeps: Array.isArray(body.sleeps) ? body.sleeps : [],
          steps: Array.isArray(body.steps) ? body.steps : [],
        })
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [api, linked, refreshKey, woke, synced])
  return metrics
}

const mean = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined

/**
 * The morning's numbers for the coach, or null when the newest reading is
 * more than two days old: a number from last week is not today's
 * readiness. `recovery` is there only for bands that publish a score.
 */
export function strapSummary(
  metrics: StrapMetrics,
  nowMs: number,
): StrapSummary | null {
  const recoveries = metrics.recoveries ?? []
  const latest = [...recoveries].reverse().find(hasVital)
  if (!latest) return null
  const age = Math.floor((nowMs - dayTime(latest.date)) / 86_400_000)
  if (age > 2) return null
  const hrv30 = mean(recoveries.flatMap((r) => (r.hrvMs == null ? [] : [r.hrvMs])))
  const rhr30 = mean(recoveries.flatMap((r) => (r.rhr == null ? [] : [r.rhr])))
  const night = metrics.sleeps.filter((s) => !s.nap).at(-1)
  return {
    ...(latest.recoveryScore != null && { recovery: latest.recoveryScore }),
    ...(latest.hrvMs != null && { hrvMs: latest.hrvMs }),
    ...(latest.hrvMs != null && hrv30 != null && { hrvVs30d: latest.hrvMs - hrv30 }),
    ...(latest.rhr != null && { rhr: latest.rhr }),
    ...(latest.rhr != null && rhr30 != null && { rhrVs30d: latest.rhr - rhr30 }),
    ...(night?.inBedMin != null && { sleepHours: night.inBedMin / 60 }),
    ...(night?.performancePct != null && {
      sleepPerformancePct: night.performancePct,
    }),
  }
}
