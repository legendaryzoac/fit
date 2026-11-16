import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeDemoApi } from '../demo'
import { hrvReading, rhrReading, sleepReading } from '../vitals'

type Opts = Parameters<typeof makeDemoApi>[0]

interface Metrics {
  recoveries: {
    date: string
    recoveryScore?: number | null
    hrvMs?: number | null
    rhr?: number | null
  }[]
  sleeps: { nap?: boolean; inBedMin?: number | null }[]
}

async function metrics(opts: Opts): Promise<Metrics> {
  const res = await makeDemoApi(opts).get('/api/metrics?days=60')
  return (await res.json()) as Metrics
}

function series(m: Metrics, key: 'hrvMs' | 'rhr'): number[] {
  return m.recoveries.map((r) => r[key]).filter((v): v is number => v != null)
}

const lastNight = (m: Metrics) => m.sleeps.filter((s) => !s.nap).at(-1)

describe.each(['whoop', 'google'] as const)('demo (%s)', (strap) => {
  afterEach(() => vi.useRealTimers())

  it('is an ordinary night without roughNight', async () => {
    const m = await metrics({ strap })
    expect(lastNight(m)?.inBedMin).not.toBe(318)
  })

  it('shows a bad night with roughNight', async () => {
    const m = await metrics({ strap, roughNight: true })
    const night = lastNight(m)
    expect(hrvReading(series(m, 'hrvMs'))?.status).toBe('bad')
    expect(rhrReading(series(m, 'rhr'))?.status).toBe('bad')
    expect(sleepReading(night?.inBedMin)?.status).toBe('bad')
    expect(night?.inBedMin).toBe(318)
    const newest = m.recoveries.at(-1)
    if (strap === 'whoop') expect(newest?.recoveryScore).toBe(22)
    else expect(newest?.recoveryScore ?? null).toBeNull()
  })

  it('changes only the newest day', async () => {
    // The demo stamps its days from the clock, so hold the clock still
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-15T12:00:00Z'))
    const plain = await metrics({ strap })
    const rough = await metrics({ strap, roughNight: true })
    expect(rough.recoveries.slice(0, -1)).toEqual(plain.recoveries.slice(0, -1))
  })
})
