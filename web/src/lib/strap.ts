// The wearable's last 30 days, fetched once and shared: the home screen
// draws it, and the coach reads a few numbers from it. Without a linked
// strap there is nothing to ask for and nothing to show (the server keeps
// old scores after a disconnect, so the gate sits here).

import { useEffect, useState } from 'react'
import type { StrapSummary } from './agent/types'
import type { Api } from './api'

export interface StrapRecovery {
  date: string
  recoveryScore?: number | null
  hrvMs?: number | null
  rhr?: number | null
}

export interface StrapSleep {
  end?: string
  nap?: boolean
  inBedMin?: number
  performancePct?: number
}

export interface StrapMetrics {
  /** null until the first fetch lands. */
  recoveries: StrapRecovery[] | null
  sleeps: StrapSleep[]
}

const NONE: StrapMetrics = { recoveries: [], sleeps: [] }

export function useStrapMetrics(api: Api, linked: boolean): StrapMetrics {
  const [metrics, setMetrics] = useState<StrapMetrics>({
    recoveries: null,
    sleeps: [],
  })
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
        })
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [api, linked])
  return metrics
}

const mean = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined

/**
 * The morning's numbers for the coach, or null when the newest scored
 * recovery is more than two days old: a score from last week is not
 * today's readiness.
 */
export function strapSummary(
  metrics: StrapMetrics,
  nowMs: number,
): StrapSummary | null {
  const recoveries = metrics.recoveries ?? []
  const latest = [...recoveries].reverse().find((r) => r.recoveryScore != null)
  if (!latest || latest.recoveryScore == null) return null
  const age = Math.floor((nowMs - new Date(latest.date).getTime()) / 86_400_000)
  if (age > 2) return null
  const hrv30 = mean(recoveries.flatMap((r) => (r.hrvMs == null ? [] : [r.hrvMs])))
  const rhr30 = mean(recoveries.flatMap((r) => (r.rhr == null ? [] : [r.rhr])))
  const night = metrics.sleeps.filter((s) => !s.nap).at(-1)
  return {
    recovery: latest.recoveryScore,
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
