import { useEffect, useMemo, useRef, useState } from 'react'
import { cue } from '../lib/cue'
import { SPEED_DRILLS } from '../lib/exercises'
import { registerTimerControls } from '../lib/lockScreen'
import {
  fmtSec,
  sectionTone,
  totalSec,
  type SectionTone,
} from '../lib/templates'
import {
  backSection,
  saveTimerDraft,
  skipSection,
  timerSnapshot,
  type SessionRecord,
  type TimerDraft,
  type Workout,
  type WorkoutExercise,
} from '../lib/workouts'
import { LockScreenToggle } from './LockScreenToggle'
import {
  buttonClass,
  ChevronDownIcon,
  iconButtonClass,
  inputClass,
  XIcon,
} from './ui'

const MILE = 1609.34
const YD = 0.9144

const repInput =
  'w-full rounded-lg border border-neutral-800 bg-neutral-900 px-1 py-2 ' +
  'text-center text-base text-neutral-100 placeholder-neutral-600 outline-none ' +
  'focus:border-teal-500'

/** Post-timer rep logging for speed sessions — feeds the sprint analytics. */
function DrillSetsEditor({
  drills,
  onChange,
}: {
  drills: WorkoutExercise[]
  onChange: (drills: WorkoutExercise[]) => void
}) {
  const [name, setName] = useState('')

  function addDrill() {
    const trimmed = name.trim()
    if (!trimmed) return
    onChange([...drills, { name: trimmed, sets: [{}] }])
    setName('')
  }

  const patch = (
    di: number,
    si: number,
    field: 'distanceM' | 'durationSec',
    raw: string,
  ) => {
    const value =
      raw === ''
        ? undefined
        : field === 'distanceM'
          ? Math.round(Number(raw) * YD * 100) / 100
          : Number(raw)
    onChange(
      drills.map((d, i) =>
        i !== di
          ? d
          : {
              ...d,
              sets: d.sets.map((s, j) =>
                j !== si ? s : { ...s, [field]: value },
              ),
            },
      ),
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-neutral-500">
        Log your rep times (optional — powers the speed trend chart):
      </p>
      {drills.map((d, di) => (
        <div key={di} className="rounded-lg border border-neutral-800 p-2.5">
          <div className="mb-1.5 flex items-baseline justify-between">
            <p className="text-sm font-medium text-neutral-200">{d.name}</p>
            <button
              onClick={() => onChange(drills.filter((_, i) => i !== di))}
              className="text-xs text-neutral-600 hover:text-red-400"
            >
              remove
            </button>
          </div>
          <div className="mb-1 grid grid-cols-[1.5rem_1fr_1fr_2rem] gap-1.5 text-[11px] uppercase tracking-wide text-neutral-600">
            <span>rep</span>
            <span className="text-center">yd</span>
            <span className="text-center">sec</span>
            <span />
          </div>
          {d.sets.map((s, si) => (
            <div
              key={si}
              className="mb-1 grid grid-cols-[1.5rem_1fr_1fr_2rem] items-center gap-1.5"
            >
              <span className="text-sm text-neutral-500">{si + 1}</span>
              <input
                className={repInput}
                type="number"
                inputMode="numeric"
                value={s.distanceM != null ? Math.round(s.distanceM / YD) : ''}
                onChange={(e) => patch(di, si, 'distanceM', e.target.value)}
              />
              <input
                className={repInput}
                type="number"
                inputMode="decimal"
                value={s.durationSec ?? ''}
                onChange={(e) => patch(di, si, 'durationSec', e.target.value)}
              />
              <button
                onClick={() =>
                  onChange(
                    drills.map((x, i) =>
                      i !== di
                        ? x
                        : { ...x, sets: x.sets.filter((_, j) => j !== si) },
                    ),
                  )
                }
                className="text-neutral-600 hover:text-red-400"
                aria-label="remove rep"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            onClick={() =>
              onChange(
                drills.map((x, i) =>
                  i !== di ? x : { ...x, sets: [...x.sets, { ...x.sets.at(-1) }] },
                ),
              )
            }
            className="text-xs font-medium text-teal-400 hover:text-teal-300"
          >
            + add rep
          </button>
        </div>
      ))}
      <div className="flex gap-2">
        <input
          className={inputClass}
          list="drill-names"
          placeholder="add drill…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addDrill()}
        />
        <datalist id="drill-names">
          {SPEED_DRILLS.map((d) => (
            <option key={d.name} value={d.name} />
          ))}
        </datalist>
        <button onClick={addDrill} className={`${buttonClass} shrink-0`}>
          Add
        </button>
      </div>
    </div>
  )
}

const TONE: Record<SectionTone, { pill: string; text: string; bar: string }> = {
  warm: { pill: 'bg-amber-500/15 text-amber-300', text: 'text-amber-300', bar: 'bg-amber-400' },
  work: { pill: 'bg-teal-500/15 text-teal-300', text: 'text-teal-300', bar: 'bg-teal-400' },
  rest: { pill: 'bg-sky-500/15 text-sky-300', text: 'text-sky-300', bar: 'bg-sky-400' },
  cool: { pill: 'bg-violet-500/15 text-violet-300', text: 'text-violet-300', bar: 'bg-violet-400' },
  other: { pill: 'bg-neutral-800 text-neutral-300', text: 'text-neutral-200', bar: 'bg-neutral-400' },
}

export function IntervalSession({
  initial,
  sessions,
  onSave,
  onCancel,
  onMinimize,
}: {
  initial: TimerDraft
  sessions: SessionRecord[]
  onSave: (w: Workout) => void
  onCancel: () => void
  onMinimize: () => void
}) {
  const [draft, setDraft] = useState<TimerDraft>(initial)
  const [now, setNow] = useState(Date.now())
  const [phase, setPhase] = useState<'run' | 'done'>('run')
  const [title, setTitle] = useState(initial.title ?? '')
  const [miles, setMiles] = useState('')
  const [notes, setNotes] = useState('')
  const [linkedSk, setLinkedSk] = useState<string | undefined>()
  const [drills, setDrills] = useState<WorkoutExercise[]>([])
  const lastIdxRef = useRef(0)
  const doneElapsedRef = useRef(0)
  // A timer that ran out while this screen was unmounted already announced
  // itself (lock-screen driver) — resuming into it shouldn't beep again.
  const finishedAtMount = useRef(
    initial.sections.length > 0 && timerSnapshot(initial, Date.now()).finished,
  )

  const sections = draft.sections
  const stopwatch = sections.length === 0
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
  const finished = !stopwatch && idx === -1
  const current = (finished ? sections[sections.length - 1] : sections[idx]) ?? {
    label: 'Work',
    durationSec: 1,
  }
  const remaining = finished ? 0 : cumEnd[idx] - elapsedSec
  const next = finished || idx === sections.length - 1 ? null : sections[idx + 1]

  useEffect(() => {
    if (stopwatch) return
    if (phase !== 'run') return
    if (!finished && idx !== lastIdxRef.current) {
      lastIdxRef.current = idx
      cue(2)
    }
    if (finished) {
      doneElapsedRef.current = Math.min(elapsedMs, total * 1000)
      saveTimerDraft(null)
      if (!finishedAtMount.current) cue(3)
      setPhase('done')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, finished, phase])

  // Lock-screen media keys drive this screen while it's mounted. The ref
  // keeps the handlers on the freshest closures without re-registering.
  const controlsRef = useRef({ pause, resume, skip, back })
  controlsRef.current = { pause, resume, skip, back }
  useEffect(
    () =>
      registerTimerControls({
        pause: () => controlsRef.current.pause(),
        resume: () => controlsRef.current.resume(),
        skip: () => controlsRef.current.skip(),
        back: () => controlsRef.current.back(),
      }),
    [],
  )

  // These also fire from lock-screen media keys, which arrive in any state
  // (a headset can send play while running) and possibly while the 250ms
  // `now` state is stale from background throttling — so each one guards on
  // the draft itself and reads the clock at call time, not from the render.
  function pause() {
    setDraft((d) =>
      d.paused
        ? d
        : {
            ...d,
            paused: true,
            pausedElapsedMs: Date.now() - d.startEpoch + d.skipOffsetMs,
          },
    )
  }

  function resume() {
    setDraft((d) =>
      d.paused
        ? {
            ...d,
            paused: false,
            startEpoch: Date.now(),
            skipOffsetMs: d.pausedElapsedMs,
          }
        : d,
    )
  }

  function skip() {
    setDraft((d) => skipSection(d, Date.now()))
  }

  function back() {
    setDraft((d) => backSection(d, Date.now()))
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
      exercises: drills,
      ...(sections.length > 0 && { intervals: sections }),
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
        {draft.kind === 'speed' && (
          <DrillSetsEditor drills={drills} onChange={setDrills} />
        )}
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
    <div className="-mt-4 flex min-h-[78dvh] flex-col">
      {/* top-16 tucks under the sticky app header */}
      <div className="sticky top-16 z-20 -mx-4 flex items-center justify-between border-b border-neutral-800/60 bg-neutral-950/95 px-4 py-3 backdrop-blur">
        {/* icon-only: two labeled buttons + the clock don't fit at 375px.
            gap-3 + 40px squares keep the unconfirmed Cancel mis-tap-safe. */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              saveTimerDraft(null)
              onCancel()
            }}
            aria-label="cancel session"
            title="Cancel session"
            className={`${iconButtonClass} min-h-10 min-w-10 justify-center`}
          >
            <XIcon />
          </button>
          <button
            onClick={onMinimize}
            aria-label="minimize session"
            title="Minimize"
            className={`${iconButtonClass} min-h-10 min-w-10 justify-center`}
          >
            <ChevronDownIcon />
          </button>
        </div>
        {stopwatch ? (
          <span className="font-mono text-sm tabular-nums text-neutral-400">
            {fmtSec(elapsedSec)}
          </span>
        ) : (
          <span className="font-mono text-sm tabular-nums text-neutral-400">
            {fmtSec(Math.min(elapsedSec, total))} / {fmtSec(total)}
          </span>
        )}
        {!stopwatch && (
          <span className="text-xs tabular-nums text-neutral-600">
            {idx + 1}/{sections.length}
          </span>
        )}
      </div>

      <LockScreenToggle className="flex justify-end pt-2" />

      <div className="flex flex-1 flex-col items-center justify-center gap-5">
        {stopwatch ? (
          <>
            <p className="font-mono text-[5.5rem] leading-none tabular-nums text-sky-300 sm:text-[7rem]">
              {fmtSec(elapsedSec)}
            </p>
            <p className="text-sm text-neutral-500">elapsed</p>
          </>
        ) : (
          <>
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
          </>
        )}
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
        {!stopwatch && (
          <button
            onClick={skip}
            className="rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:border-neutral-500"
          >
            Skip
          </button>
        )}
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
