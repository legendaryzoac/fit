import { describe, expect, it } from 'vitest'
import { hrvReading, rhrReading, sleepReading } from '../vitals'

// A month of readings around 60 with a spread of about 4
const steady = [56, 64, 58, 62, 60, 55, 65, 61, 59, 60, 57, 63, 60, 58, 62]

describe('readings against a personal baseline', () => {
  it('calls HRV at or above its usual level in range', () => {
    expect(hrvReading([...steady, 60])).toMatchObject({ status: 'good', caption: 'In range' })
    expect(hrvReading([...steady, 75])).toMatchObject({ status: 'good' })
    // Half a standard deviation under is still ordinary variation
    expect(hrvReading([...steady, 59])).toMatchObject({ status: 'good' })
  })

  it('grades a drop in HRV by how far it falls', () => {
    expect(hrvReading([...steady, 56])).toMatchObject({ status: 'fading', caption: 'Fading' })
    expect(hrvReading([...steady, 48])).toMatchObject({ status: 'bad', caption: 'Low' })
  })

  it('reads resting heart rate the other way round: lower is better', () => {
    expect(rhrReading([...steady, 52])).toMatchObject({ status: 'good' })
    expect(rhrReading([...steady, 64])).toMatchObject({ status: 'fading', caption: 'Fading' })
    expect(rhrReading([...steady, 70])).toMatchObject({ status: 'bad', caption: 'High' })
  })

  it('places the value and the ideal range on the same gauge', () => {
    const hrv = hrvReading([...steady, 60])!
    expect(hrv.at).toBeCloseTo(0.5, 1)
    expect(hrv.ideal![1]).toBe(1)
    expect(hrv.ideal![0]).toBeLessThan(hrv.at)

    const low = hrvReading([...steady, 48])!
    expect(low.at).toBeLessThan(low.ideal![0])

    const rhr = rhrReading([...steady, 70])!
    expect(rhr.ideal![0]).toBe(0)
    expect(rhr.at).toBeGreaterThan(rhr.ideal![1])
  })

  it('keeps a far-off reading on the gauge', () => {
    expect(hrvReading([...steady, 5])!.at).toBe(0)
    expect(hrvReading([...steady, 500])!.at).toBe(1)
  })

  it('does not let a dead-steady history turn a small wobble into an alarm', () => {
    const flat = Array(14).fill(60)
    // One beat off a perfectly flat month is nothing
    expect(rhrReading([...flat, 61])).toMatchObject({ status: 'good' })
    expect(hrvReading([...flat, 59])).toMatchObject({ status: 'good' })
  })

  it('withholds judgement until there is a week of history', () => {
    expect(hrvReading([60, 61, 59, 30])).toEqual({
      value: 30,
      status: null,
      caption: 'Building baseline',
      at: 0.5,
      ideal: null,
    })
    expect(hrvReading([])).toBeNull()
  })

  it('judges against the thirty readings before this one, not older history', () => {
    const lowEra = Array(30).fill(40)
    const recent = Array.from({ length: 30 }, (_, i) => 60 + (i % 5) - 2)
    expect(hrvReading([...lowEra, ...recent, 60])).toMatchObject({ status: 'good' })
    expect(hrvReading([...lowEra, ...recent, 44])).toMatchObject({ status: 'bad' })
  })
})

describe('sleep against the hours an adult needs', () => {
  it('is in range from seven hours up', () => {
    expect(sleepReading(420)).toMatchObject({ status: 'good', caption: 'In range' })
    expect(sleepReading(560)).toMatchObject({ status: 'good' })
  })

  it('fades between six and seven hours and is short under six', () => {
    expect(sleepReading(419)).toMatchObject({ status: 'fading', caption: 'Fading' })
    expect(sleepReading(360)).toMatchObject({ status: 'fading' })
    expect(sleepReading(359)).toMatchObject({ status: 'bad', caption: 'Short' })
  })

  it('marks seven hours as the start of the ideal range on a 4–10 h gauge', () => {
    const sleep = sleepReading(420)!
    expect(sleep.ideal).toEqual([0.5, 1])
    expect(sleep.at).toBe(0.5)
    expect(sleepReading(120)!.at).toBe(0)
    expect(sleepReading(null)).toBeNull()
  })
})
