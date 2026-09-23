// Range-of-motion field tests: the outcome measure for stretching. Each
// test carries its minimal detectable change so a chart can draw the noise
// band and the UI never calls a within-band wobble "progress".

import { useCallback, useEffect, useState } from 'react'
import type { Api } from './api'
import { makeQueue } from './queue'
import { storageKey } from './storage'

export interface RomTest {
  /** YYYY-MM-DD, local. */
  date: string
  toeTouchCm?: number
  kneeToWallLCm?: number
  kneeToWallRCm?: number
  handBehindBackLCm?: number
  handBehindBackRCm?: number
  note?: string
  updatedAt?: string
}

export type RomKey = Exclude<keyof RomTest, 'date' | 'note' | 'updatedAt'>

export const ROM_TESTS: Array<{
  key: RomKey
  label: string
  side?: 'L' | 'R'
  /** Minimal detectable change, cm — changes inside this are noise. */
  mdcCm: number
  /** Direction of improvement. */
  better: 'lower' | 'higher'
  how: string
}> = [
  {
    key: 'toeTouchCm',
    label: 'Toe touch',
    mdcCm: 5,
    better: 'lower',
    how: 'Stand on a step, legs straight, reach down. Fingertips to step edge in cm; negative once you reach past it.',
  },
  {
    key: 'kneeToWallLCm',
    label: 'Knee to wall',
    side: 'L',
    mdcCm: 2,
    better: 'higher',
    how: 'Big toe to wall in cm with the heel down and the knee touching. Same shoes (or none) every time.',
  },
  {
    key: 'kneeToWallRCm',
    label: 'Knee to wall',
    side: 'R',
    mdcCm: 2,
    better: 'higher',
    how: 'As left. A side-to-side gap over 2–3 cm is worth noting.',
  },
  {
    key: 'handBehindBackLCm',
    label: 'Hand behind back',
    side: 'L',
    mdcCm: 2.5,
    better: 'lower',
    how: 'Left arm over the shoulder, right arm up the back; gap between fingertips in cm (0 if they touch).',
  },
  {
    key: 'handBehindBackRCm',
    label: 'Hand behind back',
    side: 'R',
    mdcCm: 2.5,
    better: 'lower',
    how: 'Right arm over, left arm up.',
  },
]

/** Retest cadence the evidence supports: every 2–4 weeks, fixed protocol. */
export const RETEST_DAYS = 21

const CACHE_KEY = 'fit.romTestsCache'

function loadCache(): RomTest[] {
  try {
    return JSON.parse(localStorage.getItem(storageKey(CACHE_KEY)) ?? '[]')
  } catch {
    return []
  }
}

function saveCache(list: RomTest[]): void {
  localStorage.setItem(storageKey(CACHE_KEY), JSON.stringify(list))
}

/** Newest first, one per date (last occurrence wins). */
export function sortRomTests(list: RomTest[]): RomTest[] {
  const byDate = new Map<string, RomTest>()
  for (const t of list) byDate.set(t.date, t)
  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date))
}

const queue = makeQueue<RomTest>('fit.pendingRomTests', '/api/romtests', (t) => t.date)

export function useRomTests(api: Api): {
  tests: RomTest[]
  save: (test: RomTest) => void
  remove: (date: string) => Promise<void>
} {
  const [tests, setTests] = useState<RomTest[]>(() => sortRomTests(loadCache()))

  const sync = useCallback(async () => {
    await queue.flush(api)
    try {
      const res = await api.get('/api/romtests')
      if (!res.ok) return
      const body = await res.json()
      if (!Array.isArray(body.tests)) return
      const merged = sortRomTests([...body.tests, ...queue.load()])
      setTests(merged)
      saveCache(merged)
    } catch {
      /* offline — cache stands */
    }
  }, [api])

  useEffect(() => {
    void sync()
  }, [sync])

  const save = useCallback(
    (test: RomTest) => {
      const entry = { ...test }
      delete entry.updatedAt
      queue.enqueue(entry)
      setTests((prev) => {
        const next = sortRomTests([...prev, entry])
        saveCache(next)
        return next
      })
      void queue.flush(api)
    },
    [api],
  )

  const remove = useCallback(
    async (date: string) => {
      const res = await api.send('DELETE', `/api/romtests?date=${encodeURIComponent(date)}`)
      if (!res.ok) throw new Error(`API responded ${res.status}`)
      setTests((prev) => {
        const next = prev.filter((t) => t.date !== date)
        saveCache(next)
        return next
      })
    },
    [api],
  )

  return { tests, save, remove }
}

/** Latest value per test plus the change from the previous test and
 * whether that change clears the noise band. */
export function romSummary(tests: RomTest[]): Array<{
  key: RomKey
  latest: number | null
  latestDate: string | null
  previous: number | null
  delta: number | null
  beyondNoise: boolean
  improved: boolean | null
}> {
  return ROM_TESTS.map((t) => {
    const withValue = tests.filter((x) => typeof x[t.key] === 'number')
    const latest = withValue[0]
    const previous = withValue[1]
    const lv = (latest?.[t.key] as number | undefined) ?? null
    const pv = (previous?.[t.key] as number | undefined) ?? null
    const delta = lv != null && pv != null ? Math.round((lv - pv) * 10) / 10 : null
    const beyondNoise = delta != null && Math.abs(delta) >= t.mdcCm
    const improved =
      delta == null || !beyondNoise
        ? null
        : t.better === 'lower'
          ? delta < 0
          : delta > 0
    return {
      key: t.key,
      latest: lv,
      latestDate: latest?.date ?? null,
      previous: pv,
      delta,
      beyondNoise,
      improved,
    }
  })
}
