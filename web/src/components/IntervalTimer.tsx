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
  'w-full border border-ink/40 bg-surface px-1 py-2 text-center text-base ' +
  'font-semibold text-ink placeholder:font-normal placeholder:text-ink/35 ' +
  'outline-none focus:border-accent'

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
      <p className="text-xs text-ink/55">
        Log your rep times (optional — powers the speed trend chart):
      </p>
      {drills.map((d, di) => (
        <div key={di} className="border-t-2 border-ink/40 pt-2">
          <div className="mb-1.5 flex items-baseline justify-between">
            <p className="text-base font-extrabold text-ink">{d.name}</p>
            <button
              onClick={() => onChange(drills.filter((_, i) => i !== di))}
              className="text-[10px] font-semibold uppercase tracking-widest text-ink/40 hover:text-accent-700"
            >
              remove
            </button>
          </div>
          <div className="mb-1 grid grid-cols-[1.5rem_1fr_1fr_2rem] gap-1.5 border-b-2 border-ink/40 pb-1 text-[9px] font-semibold uppercase tracking-widest text-ink/50">
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
              <span className="text-sm font-extrabold text-ink">{si + 1}</span>
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
                className="text-ink/35 hover:text-accent-700"
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
            className="py-1 text-[10px] font-extrabold uppercase tracking-widest text-accent-700 hover:text-accent-600"
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

// Monochrome+red: work shouts in red, rest is ink, warm/cool are tints.
const TONE: Record<SectionTone, { pill: string; text: string; bar: string }> = {
  warm: { pill: 'bg-accent-200 text-accent-800', text: 'text-accent-600', bar: 'bg-accent-400' },
  work: { pill: 'bg-accent text-paper', text: 'text-accent', bar: 'bg-accent' },
  rest: { pill: 'bg-ink text-paper', text: 'text-ink', bar: 'bg-ink' },
  cool: { pill: 'bg-neutral-300 text-neutral-800', text: 'text-neutral-600', bar: 'bg-neutral-500' },
  other: { pill: 'bg-surface text-neutral-800', text: 'text-ink', bar: 'bg-neutral-400' },
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
        <p className="kicker">Session complete</p>
        <p className="text-5xl font-extrabold tracking-tight tabular-nums text-ink">
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
                <p className="text-xs text-ink/55">
                  Attach WHOOP heart-rate data:
                </p>
                {linkCandidates.map((s) => (
                  <button
                    key={s.sk}
                    onClick={() =>
                      setLinkedSk(linkedSk === s.sk ? undefined : s.sk)
                    }
                    className={`border px-3 py-2.5 text-left text-xs font-semibold ${
                      linkedSk === s.sk
                        ? 'border-accent bg-accent-100 text-accent-800'
                        : 'border-ink/40 text-ink/70 hover:bg-ink/5'
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
            className="text-[10px] font-semibold uppercase tracking-widest text-ink/45 hover:text-accent-700"
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
      {/* top-[58px] (header 56px + 2px rule) tucks under the sticky app header; 1fr_auto_1fr keeps the
          clock dead-centre no matter how wide the flanking cells are */}
      <div className="sticky top-[58px] z-20 -mx-4 grid grid-cols-[1fr_auto_1fr] items-center border-b-2 border-ink/40 bg-paper px-4 py-2.5">
        {/* icon-only: two labeled buttons + the clock don't fit at 375px.
            gap-3 + 40px squares keep the unconfirmed Cancel mis-tap-safe. */}
        <div className="flex items-center gap-3 justify-self-start">
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
          <span className="justify-self-center text-xl font-extrabold leading-none tabular-nums">
            {fmtSec(elapsedSec)}
          </span>
        ) : (
          <span className="justify-self-center text-xl font-extrabold leading-none tabular-nums">
            {fmtSec(Math.min(elapsedSec, total))}{' '}
            <span className="text-sm font-semibold text-ink/50">
              / {fmtSec(total)}
            </span>
          </span>
        )}
        {!stopwatch ? (
          <span className="justify-self-end text-[10px] font-semibold tracking-widest text-ink/55">
            {idx + 1}/{sections.length}
          </span>
        ) : (
          <span />
        )}
      </div>

      <LockScreenToggle className="flex justify-end pt-2" />

      <div className="flex flex-1 flex-col items-center justify-center gap-5">
        {stopwatch ? (
          <>
            <p className="text-[5.5rem] font-extrabold leading-none tracking-tight tabular-nums text-ink sm:text-[7rem]">
              {fmtSec(elapsedSec)}
            </p>
            <p className="kicker-muted">elapsed</p>
          </>
        ) : (
          <>
            <span
              className={`px-4 py-1.5 text-sm font-extrabold uppercase tracking-widest ${tone.pill}`}
            >
              {current.label}
            </span>
            <p
              className={`text-[5.5rem] font-extrabold leading-none tracking-tight tabular-nums sm:text-[7rem] ${tone.text}`}
            >
              {fmtSec(Math.ceil(remaining))}
            </p>
            <div className="h-1.5 w-full max-w-sm overflow-hidden bg-ink/15">
              <div
                className={`h-full transition-[width] duration-200 ${tone.bar}`}
                style={{
                  width: `${Math.min(100, (1 - remaining / current.durationSec) * 100)}%`,
                }}
              />
            </div>
            <p className="text-sm font-semibold text-ink/55">
              {next
                ? `Next · ${next.label} ${fmtSec(next.durationSec)}`
                : 'Final section'}
            </p>
          </>
        )}
        {draft.paused && (
          <p className="text-xs font-extrabold uppercase tracking-widest text-accent-700">
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
            className="border border-ink/40 px-4 py-2 text-sm font-semibold text-ink hover:bg-ink/5"
          >
            Skip
          </button>
        )}
        <button
          onClick={endEarly}
          className="px-2 text-[10px] font-semibold uppercase tracking-widest text-ink/45 hover:text-accent-700"
        >
          End
        </button>
      </div>
    </div>
  )
}
