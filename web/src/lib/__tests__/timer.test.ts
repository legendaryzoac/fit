import { describe, expect, it } from 'vitest'
import {
  backSection,
  skipSection,
  timerSnapshot,
  type TimerDraft,
} from '../workouts'

const base: TimerDraft = {
  kind: 'speed',
  sections: [
    { label: 'Work', durationSec: 60 },
    { label: 'Rest', durationSec: 60 },
  ],
  startEpoch: 0,
  skipOffsetMs: 0,
  paused: false,
  pausedElapsedMs: 0,
}

describe('an ended timer draft', () => {
  it('stays finished at the time it ended, however late it is read', () => {
    const d = { ...base, done: { elapsedMs: 30_000, at: 30_000 } }
    const snap = timerSnapshot(d, 10 * 60_000)
    expect(snap.finished).toBe(true)
    expect(snap.elapsedMs).toBe(30_000)
    expect(snap.section?.label).toBe('Work')
    expect(snap.next).toBeNull()
  })

  it('finishes a stopwatch too', () => {
    const d = { ...base, sections: [], done: { elapsedMs: 90_000, at: 90_000 } }
    const snap = timerSnapshot(d, 10 * 60_000)
    expect(snap.finished).toBe(true)
    expect(snap.elapsedMs).toBe(90_000)
    expect(snap.section).toBeNull()
  })

  it('ignores skip and back', () => {
    const d = { ...base, done: { elapsedMs: 30_000, at: 30_000 } }
    expect(skipSection(d, 30_000)).toBe(d)
    expect(backSection(d, 30_000)).toBe(d)
  })

  it('leaves a running timer as it was', () => {
    const snap = timerSnapshot(base, 90_000)
    expect(snap.finished).toBe(false)
    expect(snap.section?.label).toBe('Rest')
    expect(timerSnapshot(base, 3 * 60_000).finished).toBe(true)
  })
})
