import { describe, expect, it } from 'vitest'
import { prepare } from '../snapshot'
import { makeCtx } from './fixtures'

type Readiness = { strap: Record<string, unknown> | null; flags: string[] }
const readiness = (ctx: Parameters<typeof makeCtx>[0]) =>
  prepare(makeCtx(ctx)).state.readiness as Readiness

// What the coach is told about the wearable, band by band.
describe('strap in the coach snapshot', () => {
  it('passes a recovery score through and flags a low one', () => {
    const r = readiness({ strap: { recovery: 28.4, hrvMs: 41.6, rhr: 63 } })
    expect(r.strap).toEqual({ recovery: 28, hrv_ms: 42, resting_hr: 63 })
    expect(r.flags).toContain('readiness_low')
  })

  it('sends vitals alone for a band with no score, and raises no flag from them', () => {
    const r = readiness({
      strap: { hrvMs: 46, hrvVs30d: -9.26, rhr: 54, rhrVs30d: 3.1, sleepHours: 6.04 },
    })
    expect(r.strap).toEqual({
      hrv_ms: 46,
      hrv_vs_30d: -9.3,
      resting_hr: 54,
      resting_hr_vs_30d: 3.1,
      sleep_h: 6,
    })
    expect(r.strap).not.toHaveProperty('recovery')
    expect(r.flags).not.toContain('readiness_low')
  })

  it('says nothing about a strap when none is linked', () => {
    expect(readiness({ strap: null }).strap).toBeNull()
  })
})
