import { useEffect, useMemo, useRef, useState } from 'react'
import {
  fmtSec,
  sectionTone,
  totalSec,
  type SectionTone,
} from '../lib/templates'
import {
  saveTimerDraft,
  type SessionRecord,
  type TimerDraft,
  type Workout,
} from '../lib/workouts'
import { buttonClass, inputClass } from './ui'

const MILE = 1609.34

const TONE: Record<SectionTone, { pill: string; text: string; bar: string }> = {
  warm: { pill: 'bg-amber-500/15 text-amber-300', text: 'text-amber-300', bar: 'bg-amber-400' },
  work: { pill: 'bg-teal-500/15 text-teal-300', text: 'text-teal-300', bar: 'bg-teal-400' },
  rest: { pill: 'bg-sky-500/15 text-sky-300', text: 'text-sky-300', bar: 'bg-sky-400' },
  cool: { pill: 'bg-violet-500/15 text-violet-300', text: 'text-violet-300', bar: 'bg-violet-400' },
  other: { pill: 'bg-neutral-800 text-neutral-300', text: 'text-neutral-200', bar: 'bg-neutral-400' },
}

/** Best-effort chirp + vibration on section changes; silence is acceptable. */
function cue(times: number) {
  try {
    navigator.vibrate?.(
      Array.from({ length: times }, () => [150, 100]).flat(),
    )
  } catch {
    /* no vibration support */
  }
  try {
    const ctx = new AudioContext()
    for (let i = 0; i < times; i++) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.value = 880
      const t = ctx.currentTime + i * 0.25
      gain.gain.setValueAtTime(0.001, t)
      gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2)
      osc.start(t)
      osc.stop(t + 0.22)
    }
  } catch {
    /* autoplay policy — vibration already fired */
  }
}

export function IntervalSession({
  initial,
  sessions,
  onSave,
  onCancel,
}: {
  initial: TimerDraft
  sessions: SessionRecord[]
  onSave: (w: Workout) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState<TimerDraft>(initial)
  const [now, setNow] = useState(Date.now())
  const [phase, setPhase] = useState<'run' | 'done'>('run')
  const [title, setTitle] = useState(initial.title ?? '')
  const [miles, setMiles] = useState('')
  const [notes, setNotes] = useState('')
  const [linkedSk, setLinkedSk] = useState<string | undefined>()
  const lastIdxRef = useRef(0)
  const doneElapsedRef = useRef(0)

  const sections = draft.sections
  const total = useMemo(() => totalSec(sections), [sections])
  const cumEnd = useMemo(() => {
    let acc = 0
    return sections.map((s) => (acc += s.durationSec))
  }, [sections])

  useEffect(() => {
    if (phase === 'run') saveTimerDraft(draft)
  }, [draft, phase])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [])

  const elapsedMs = draft.paused
    ? draft.pausedElapsedMs
    : now - draft.startEpoch + draft.skipOffsetMs
  const elapsedSec = elapsedMs / 1000
  const idx = cumEnd.findIndex((end) => elapsedSec < end)
  const finished = idx === -1
  const current = (finished ? sections[sections.length - 1] : sections[idx]) ?? {
    label: 'Work',
    durationSec: 1,
  }
  const remaining = finished ? 0 : cumEnd[idx] - elapsedSec
  const next = finished || idx === sections.length - 1 ? null : sections[idx + 1]

  useEffect(() => {
    if (phase !== 'run') return
    if (!finished && idx !== lastIdxRef.current) {
      lastIdxRef.current = idx
      cue(2)
    }
    if (finished) {
      doneElapsedRef.current = Math.min(elapsedMs, total * 1000)
      saveTimerDraft(null)
      cue(3)
      setPhase('done')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, finished, phase])

  function pause() {
    setDraft((d) => ({ ...d, paused: true, pausedElapsedMs: elapsedMs }))
  }

  function resume() {
    setDraft((d) => ({
      ...d,
      paused: false,
      startEpoch: Date.now(),
      skipOffsetMs: d.pausedElapsedMs,
    }))
  }

  function skip() {
    if (finished) return
    const target = cumEnd[idx] * 1000
    setDraft((d) =>
      d.paused
        ? { ...d, pausedElapsedMs: target }
        : { ...d, skipOffsetMs: d.skipOffsetMs + (target - elapsedMs) },
    )
  }

  function endEarly() {
    doneElapsedRef.current = elapsedMs
    saveTimerDraft(null)
    setPhase('done')
  }

  function save() {
    const durMs = doneElapsedRef.current
    onSave({
      id: crypto.randomUUID(),
      // Approximate: paused time is excluded from the duration on purpose
      start: new Date(Date.now() - durMs).toISOString(),
      end: new Date().toISOString(),
      kind: draft.kind,
      title: title || undefined,
      weightUnit: 'lb',
      exercises: [],
      intervals: sections,
      durationMin: Math.max(1, Math.round(durMs / 60_000)),
      distanceM: miles ? Math.round(Number(miles) * MILE) : undefined,
      notes: notes || undefined,
      linkedSessionSk: linkedSk,
    })
  }

  if (phase === 'done') {
    const linkCandidates = sessions.filter(
      (s) =>
        Math.abs(new Date(s.start).getTime() - Date.now()) < 6 * 3_600_000,
    )
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-neutral-500">Session complete</p>
        <p className="font-mono text-4xl tabular-nums text-teal-300">
          {fmtSec(doneElapsedRef.current / 1000)}
        </p>
        <input
          className={inputClass}
          placeholder="title (optional)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        {draft.kind === 'cardio' && (
          <>
            <input
              className={inputClass}
              type="number"
              inputMode="decimal"
              placeholder="distance (miles)"
              value={miles}
              onChange={(e) => setMiles(e.target.value)}
            />
            {linkCandidates.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <p className="text-xs text-neutral-500">
                  Attach WHOOP heart-rate data:
                </p>
                {linkCandidates.map((s) => (
                  <button
                    key={s.sk}
                    onClick={() =>
                      setLinkedSk(linkedSk === s.sk ? undefined : s.sk)
                    }
                    className={`rounded-lg border px-3 py-2.5 text-left text-xs ${
                      linkedSk === s.sk
                        ? 'border-teal-500/60 bg-teal-500/10 text-teal-200'
                        : 'border-neutral-800 text-neutral-400 hover:border-neutral-600'
                    }`}
                  >
                    {s.sport ?? 'activity'} ·{' '}
                    {new Date(s.start).toLocaleTimeString(undefined, {
                      timeStyle: 'short',
                    })}
                    {s.avgHr != null && ` · ${Math.round(s.avgHr)} bpm avg`}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        <textarea
          className={`${inputClass} min-h-16`}
          placeholder="notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <div className="flex items-center gap-3">
          <button onClick={save} className={`${buttonClass} flex-1`}>
            Save workout
          </button>
          <button
            onClick={onCancel}
            className="text-sm text-neutral-500 hover:text-neutral-300"
          >
            Discard
          </button>
        </div>
      </div>
    )
  }

  const tone = TONE[sectionTone(current.label)]
  return (
    <div className="flex min-h-[78dvh] flex-col">
      <div className="flex items-center justify-between">
        <button
          onClick={() => {
            saveTimerDraft(null)
            onCancel()
          }}
          className="text-sm text-neutral-500 hover:text-neutral-300"
        >
          ✕ Cancel
        </button>
        <span className="font-mono text-sm tabular-nums text-neutral-400">
          {fmtSec(Math.min(elapsedSec, total))} / {fmtSec(total)}
        </span>
        <span className="text-xs tabular-nums text-neutral-600">
          {idx + 1}/{sections.length}
        </span>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-5">
        <span
          className={`rounded-full px-4 py-1.5 text-sm font-semibold uppercase tracking-widest ${tone.pill}`}
        >
          {current.label}
        </span>
        <p
          className={`font-mono text-[5.5rem] leading-none tabular-nums sm:text-[7rem] ${tone.text}`}
        >
          {fmtSec(Math.ceil(remaining))}
        </p>
        <div className="h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-neutral-800">
          <div
            className={`h-full transition-[width] duration-200 ${tone.bar}`}
            style={{
              width: `${Math.min(100, (1 - remaining / current.durationSec) * 100)}%`,
            }}
          />
        </div>
        <p className="text-sm text-neutral-500">
          {next
            ? `Next · ${next.label} ${fmtSec(next.durationSec)}`
            : 'Final section'}
        </p>
        {draft.paused && (
          <p className="text-xs uppercase tracking-widest text-amber-400">
            paused
          </p>
        )}
      </div>

      <div className="flex items-center gap-3 pb-4">
        <button
          onClick={draft.paused ? resume : pause}
          className={`${buttonClass} flex-1`}
        >
          {draft.paused ? 'Resume' : 'Pause'}
        </button>
        <button
          onClick={skip}
          className="rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:border-neutral-500"
        >
          Skip
        </button>
        <button
          onClick={endEarly}
          className="px-2 text-sm text-red-400/80 hover:text-red-400"
        >
          End
        </button>
      </div>
    </div>
  )
}
