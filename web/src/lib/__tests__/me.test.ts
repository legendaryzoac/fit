import { describe, expect, it } from 'vitest'
import { normalizeMe, strapCaps, strapLabel, strapLinked } from '../me'

const whoopCaps = { recoveryScore: true, strain: true, sessions: true, steps: false }
const fitbitCaps = { recoveryScore: false, strain: false, sessions: false, steps: true }

describe('normalizeMe', () => {
  it('takes the current /api/me shape as it is', () => {
    const me = normalizeMe({
      userId: 'u1',
      whoop: { connected: false },
      strap: { provider: 'google', connected: true, status: 'active', capabilities: fitbitCaps },
      providers: [
        { id: 'whoop', label: 'WHOOP' },
        { id: 'google', label: 'Fitbit Air' },
      ],
    })
    expect(me?.strap.provider).toBe('google')
    expect(strapCaps(me!)).toEqual(fitbitCaps)
    expect(strapLabel(me!)).toBe('Fitbit Air')
  })

  it('reads an older API, which only knows WHOOP, as a WHOOP strap', () => {
    const me = normalizeMe({
      userId: 'u1',
      whoop: { connected: true, status: 'active', lastSyncAt: '2026-11-12T11:00:00.000Z' },
    })
    expect(me?.strap).toEqual({
      connected: true,
      status: 'active',
      lastSyncAt: '2026-11-12T11:00:00.000Z',
      provider: 'whoop',
      capabilities: whoopCaps,
    })
    expect(me?.providers).toEqual([{ id: 'whoop', label: 'WHOOP' }])
    expect(strapLabel(me!)).toBe('WHOOP')
  })

  it('keeps a WHOOP strap awaiting reconnect linked on an older API', () => {
    const me = normalizeMe({ whoop: { connected: false, status: 'error' } })
    expect(strapLinked(me)).toBe(true)
    expect(strapCaps(me)).toEqual(whoopCaps)
  })

  it('reads an older API with no strap as no strap', () => {
    const me = normalizeMe({ whoop: { connected: false } })
    expect(me?.strap).toEqual({ connected: false })
    expect(strapLinked(me)).toBe(false)
  })

  it('rejects anything that is not a profile', () => {
    expect(normalizeMe(null)).toBeNull()
    expect(normalizeMe('nope')).toBeNull()
    expect(normalizeMe({ error: 'not found' })).toBeNull()
  })
})

describe('strap state', () => {
  it('counts a strap as linked while connected or waiting on a re-auth', () => {
    expect(strapLinked(null)).toBe(false)
    expect(strapLinked(normalizeMe({ whoop: {}, strap: { connected: true } }))).toBe(true)
    expect(
      strapLinked(normalizeMe({ whoop: {}, strap: { connected: false, status: 'error' } })),
    ).toBe(true)
  })

  it('reports no capabilities without a linked strap, even if the profile lists some', () => {
    const none = { recoveryScore: false, strain: false, sessions: false, steps: false }
    expect(strapCaps(null)).toEqual(none)
    expect(
      strapCaps(normalizeMe({ whoop: {}, strap: { connected: false, capabilities: whoopCaps } })),
    ).toEqual(none)
  })

  it('falls back to a plain name for a band it has no label for', () => {
    expect(strapLabel(normalizeMe({ whoop: { connected: false } }))).toBe('Strap')
  })
})
