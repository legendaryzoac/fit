import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import type { Api } from '../lib/api'
import {
  EXERCISES,
  MUSCLE_GROUPS,
  SPEED_DRILLS,
  isBodyweight,
  loadCustomExercises,
  makeMuscleLookup,
  saveCustomExercises,
  type CustomExercise,
} from '../lib/exercises'
import {
  buildIntervals,
  DEFAULT_PLAN,
  fmtSec,
  hasSlots,
  loadTemplateCache,
  saveTemplateCache,
  totalSec,
  type QuickIntervalPlan,
  type Template,
} from '../lib/templates'
import {
  enqueue,
  finalizeWorkout,
  flushQueue,
  loadDraft,
  loadPending,
  loadTimerDraft,
  loadWorkoutCache,
  newWorkout,
  saveDraft,
  saveTimerDraft,
  saveWorkoutCache,
  type IntervalSection,
  type SessionRecord,
  type TimerDraft,
  type Workout,
  type WorkoutKind,
  type WorkoutSet,
} from '../lib/workouts'
import {
  autoStartLockScreen,
  setLockScreenSuppressed,
  stopLockScreen,
} from '../lib/lockScreen'
import {
  activeMeso,
  dayKind,
  loadMesoCache,
  mesoWeek,
  plannedSets,
  prescribeExercises,
  saveMesoCache,
  type Mesocycle,
  type Prescription,
} from '../lib/mesocycle'
import { MesoCard, MesoSetup } from './Mesocycle'
import {
  applyRecommendations,
  feedbackMuscles,
  recommendations,
  type Recommendation,
} from '../lib/progression'
import { onResume, setInSession, setOverlay } from '../lib/sessionBus'
import { currentBodyWeight, loadWeightCache, saveWeightCache, type WeightEntry } from '../lib/weights'
import { FeedbackModal } from './Feedback'
import { IntervalSession } from './IntervalTimer'
import { LockScreenToggle } from './LockScreenToggle'
import { Manage } from './Manage'
import { SlotFill } from './SlotFill'
import { PlanFields, TemplateBuilder } from './TemplateBuilder'
import { Today } from './Today'
import {
  buttonClass,
  Card,
  ChevronDownIcon,
  ChevronLeftIcon,
  iconButtonClass,
  inputClass,
} from './ui'

// Analytics carries the recharts dependency — split it out of the logger path
const Analytics = lazy(() =>
  import('./Analytics').then((m) => ({ default: m.Analytics })),
)

// 16px font so iOS doesn't zoom on focus; big touch targets for gym thumbs.
// Ledger cell: surface fill, square, bold tabular numerals.
const setInput =
  'w-full border border-ink/40 bg-surface px-1 py-2.5 text-center text-base ' +
  'font-semibold text-ink placeholder:font-normal placeholder:text-ink/35 ' +
  'outline-none focus:border-accent'

const secondaryButton =
  'border border-ink/40 px-4 py-2 text-sm font-semibold text-ink hover:bg-ink/5'

const YD = 0.9144
const MILE = 1609.34

/** Long histories render in pages — keeps the list DOM small offline too. */
const PAGE = 20

// Kind identity in a monochrome+red system: strength=red, speed=ink,
// cardio=salmon.
const KIND_STYLE: Record<WorkoutKind, string> = {
  strength: 'bg-accent-100 text-accent-800',
  speed: 'bg-ink text-paper',
  cardio: 'bg-accent2-100 text-accent2-800',
}

function KindPill({ kind }: { kind: WorkoutKind }) {
  return (
    <span
      className={`px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${KIND_STYLE[kind]}`}
    >
      {kind}
    </span>
  )
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function fmtElapsed(ms: number): string {
  return fmtSec(ms / 1000)
}

function toLocalInput(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function prevSummary(kind: WorkoutKind, s: WorkoutSet): string | null {
  if (kind === 'speed') {
    if (s.distanceM == null && s.durationSec == null) return null
    const yd = s.distanceM != null ? `${Math.round(s.distanceM / YD)}yd` : ''
    const t = s.durationSec != null ? `${s.durationSec}s` : ''
    return [yd, t].filter(Boolean).join(' ')
  }
  if (s.weight == null && s.reps == null) return null
  return `${s.weight ?? '—'}×${s.reps ?? '—'}`
}

function setVolume(w: Workout): { sets: number; volume: number } {
  let sets = 0
  let volume = 0
  for (const e of w.exercises) {
    for (const s of e.sets) {
      sets++
      if (s.weight != null && s.reps != null) volume += s.weight * s.reps
    }
  }
  return { sets, volume }
}

// ---------------------------------------------------------------------------
// Strength session (RP-style: check off sets as you go)
// ---------------------------------------------------------------------------

function ActiveWorkout({
  initial,
  isNew,
  history,
  customs,
  lookup,
  bodyWeightLb,
  prescriptions,
  onSaveCustom,
  onFinish,
  onCancel,
  onMinimize,
  onDelete,
}: {
  initial: Workout
  isNew: boolean
  history: Workout[]
  customs: CustomExercise[]
  lookup: (name: string) => string | undefined
  bodyWeightLb?: number
  /** Meso targets per exercise — ghosts and check-offs adopt these. */
  prescriptions?: Record<string, Prescription>
  onSaveCustom: (name: string, muscle: string) => void
  onFinish: (w: Workout) => void
  onCancel: () => void
  onMinimize: () => void
  onDelete?: (w: Workout) => void
}) {
  const [w, setW] = useState<Workout>(initial)
  const [exerciseName, setExerciseName] = useState('')
  const [newMuscle, setNewMuscle] = useState<string>('other')
  const [now, setNow] = useState(Date.now())
  const [coachHidden, setCoachHidden] = useState(false)

  // Computed at mount (session start), so the 7-day windows are fresh.
  // Meso sessions get no global coach — the meso prescription IS the
  // coaching, and the two would contradict each other.
  const recs = useMemo(
    () =>
      isNew && !initial.mesoId
        ? recommendations(history, lookup)
        : ({} as Record<string, Recommendation>),
    [isNew, initial.mesoId, history, lookup],
  )

  // Coach lines for the muscle groups this session actually trains
  const coach = useMemo(() => {
    if (!isNew) return []
    const muscles: string[] = []
    for (const e of w.exercises) {
      const m = lookup(e.name)
      if (m && recs[m] && !muscles.includes(m)) muscles.push(m)
    }
    return muscles.map((m) => recs[m])
  }, [isNew, recs, w.exercises, lookup])

  // Bodyweight moves default to the athlete's WHOOP-measured mass (whole lb).
  const roundedBodyWeight =
    bodyWeightLb !== undefined ? Math.round(bodyWeightLb) : undefined

  // Drag-to-reorder: exercise cards move as the handle crosses a neighbour's
  // midpoint. Refs to the card elements let us read live positions on the fly.
  // The live drag position lives in a ref (not just state) so the move logic
  // stays out of state updaters — React double-invokes those in StrictMode,
  // which would swap twice and cancel the reorder.
  const cardRefs = useRef<(HTMLDivElement | null)[]>([])
  const dragFrom = useRef<number | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  // Draft autosave: a locked phone or dead battery must not eat a workout
  useEffect(() => {
    if (isNew) saveDraft(w)
  }, [w, isNew])

  useEffect(() => {
    if (!isNew) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [isNew])

  const knownNames = useMemo(() => {
    const base = w.kind === 'speed' ? SPEED_DRILLS : EXERCISES
    const names = new Set(base.map((e) => e.name))
    for (const c of customs) names.add(c.name)
    for (const past of history) {
      if (past.kind !== w.kind) continue
      for (const e of past.exercises) names.add(e.name)
    }
    return [...names].sort()
  }, [history, w.kind, customs])

  const typedUnknown =
    exerciseName.trim().length > 0 && lookup(exerciseName) === undefined

  /** Last performance of this exercise, for ghost placeholders per set index. */
  function prevSetsFor(name: string): WorkoutSet[] {
    for (const past of history) {
      const match = past.exercises.find(
        (e) => e.name.toLowerCase() === name.toLowerCase(),
      )
      if (match && match.sets.length > 0) return match.sets
    }
    return []
  }

  function addExercise() {
    const name = exerciseName.trim()
    if (!name) return
    // First time we see this name: remember it (and its muscle) per-user
    if (lookup(name) === undefined) onSaveCustom(name, newMuscle)
    const prev = prevSetsFor(name)
    const rows = Math.max(prev.length, 1)
    setW({
      ...w,
      exercises: [
        ...w.exercises,
        { name, sets: Array.from({ length: rows }, () => ({})) },
      ],
    })
    setExerciseName('')
    setNewMuscle('other')
  }

  function patchSet(ei: number, si: number, patch: Partial<WorkoutSet>) {
    setW({
      ...w,
      exercises: w.exercises.map((e, i) =>
        i !== ei
          ? e
          : {
              ...e,
              sets: e.sets.map((s, j) => (j !== si ? s : { ...s, ...patch })),
            },
      ),
    })
  }

  function toggleDone(ei: number, si: number, prev: WorkoutSet | undefined) {
    const current = w.exercises[ei].sets[si]
    if (current.done) {
      patchSet(ei, si, { done: false })
      return
    }
    // Checking an empty row adopts the target numbers — the meso
    // prescription when there is one, else last time's (RP-style "same
    // again"). Bodyweight moves track TODAY's measured mass. A typed
    // value always wins, and whatever lands here anchors the next meso
    // prescription — enter 355 where the plan said 335 and next session
    // builds on 355.
    const exName = w.exercises[ei].name
    const bw = w.kind !== 'speed' && isBodyweight(exName)
    const presc = prescriptions?.[exName]
    patchSet(ei, si, {
      done: true,
      // BW moves always follow today's measurement, even inside a meso
      weight:
        current.weight ??
        (bw
          ? (roundedBodyWeight ?? presc?.weight ?? prev?.weight)
          : (presc?.weight ?? prev?.weight)),
      reps: current.reps ?? presc?.targetReps ?? prev?.reps,
      durationSec: current.durationSec ?? prev?.durationSec,
      distanceM: current.distanceM ?? prev?.distanceM,
    })
  }

  function addSet(ei: number) {
    setW({
      ...w,
      exercises: w.exercises.map((e, i) =>
        i !== ei
          ? e
          : { ...e, sets: [...e.sets, { ...e.sets.at(-1), done: false }] },
      ),
    })
  }

  function removeExercise(ei: number) {
    setW({ ...w, exercises: w.exercises.filter((_, i) => i !== ei) })
  }

  // Drop one set; the exercise itself goes when its last set is removed.
  function removeSet(ei: number, si: number) {
    setW({
      ...w,
      exercises: w.exercises
        .map((e, i) =>
          i !== ei ? e : { ...e, sets: e.sets.filter((_, j) => j !== si) },
        )
        .filter((e) => e.sets.length > 0),
    })
  }

  function moveExercise(from: number, to: number) {
    if (from === to) return
    setW((prev) => {
      const next = [...prev.exercises]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return { ...prev, exercises: next }
    })
  }

  function onHandlePointerDown(ei: number, ev: React.PointerEvent) {
    ev.preventDefault()
    // preventDefault also suppresses the focus change a press would cause,
    // so end any in-progress set-field edit explicitly — inputs are keyed
    // to list positions and an edit must not follow the wrong exercise
    // through a reorder.
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
    try {
      // Capture keeps move events flowing to the handle once the finger
      // wanders off it; if capture is unavailable the drag still works
      // while the pointer stays over the handle.
      ev.currentTarget.setPointerCapture(ev.pointerId)
    } catch {
      /* no active pointer (synthetic events, exotic devices) */
    }
    dragFrom.current = ei
    setDragIndex(ei)
  }

  function onHandlePointerMove(ev: React.PointerEvent) {
    const from = dragFrom.current
    if (from === null) return
    // Swap once the pointer clears the midpoint of an adjacent card.
    const prev = cardRefs.current[from - 1]
    if (prev) {
      const r = prev.getBoundingClientRect()
      if (ev.clientY < r.top + r.height / 2) {
        moveExercise(from, from - 1)
        dragFrom.current = from - 1
        setDragIndex(from - 1)
        return
      }
    }
    const next = cardRefs.current[from + 1]
    if (next) {
      const r = next.getBoundingClientRect()
      if (ev.clientY > r.top + r.height / 2) {
        moveExercise(from, from + 1)
        dragFrom.current = from + 1
        setDragIndex(from + 1)
      }
    }
  }

  function onHandlePointerUp(ev: React.PointerEvent) {
    try {
      ev.currentTarget.releasePointerCapture(ev.pointerId)
    } catch {
      /* capture may never have been acquired */
    }
    dragFrom.current = null
    setDragIndex(null)
  }

  const numeric = (raw: string) => (raw === '' ? undefined : Number(raw))

  const doneCount = w.exercises.reduce(
    (n, e) => n + e.sets.filter((s) => s.done).length,
    0,
  )
  const totalCount = w.exercises.reduce((n, e) => n + e.sets.length, 0)

  return (
    <div className="-mt-4 flex flex-col gap-4 pb-24">
      {/* top-[58px] (header 56px + 2px rule) tucks under the sticky app header; 1fr_auto_1fr keeps the
          clock dead-centre no matter how wide the flanking cells are */}
      <div className="sticky top-[58px] z-20 -mx-4 grid grid-cols-[1fr_auto_1fr] items-center border-b-2 border-ink/40 bg-paper px-4 py-2.5">
        <div className="justify-self-start">
          {isNew ? (
            <button
              onClick={onMinimize}
              aria-label="minimize session"
              title="Minimize"
              className={`${iconButtonClass} min-h-10 min-w-10 justify-center`}
            >
              <ChevronDownIcon />
            </button>
          ) : (
            <button onClick={onCancel} className={`${iconButtonClass} px-3`}>
              <ChevronLeftIcon />
              Back
            </button>
          )}
        </div>
        {isNew ? (
          <span className="justify-self-center text-2xl font-extrabold leading-none tabular-nums">
            {fmtElapsed(now - new Date(w.start).getTime())}
          </span>
        ) : (
          <span />
        )}
        {totalCount > 0 ? (
          <span className="justify-self-end text-[10px] font-semibold tracking-widest text-ink/55">
            {doneCount} / {totalCount} SETS
          </span>
        ) : (
          <span />
        )}
      </div>
      {isNew && totalCount > 0 && (
        <div className="-mx-4 -mt-4 h-1 bg-ink/15">
          <div
            className="h-full bg-accent"
            style={{ width: `${Math.round((doneCount / totalCount) * 100)}%` }}
          />
        </div>
      )}

      {isNew && <LockScreenToggle className="-mt-2 flex justify-end" />}

      {coach.length > 0 && !coachHidden && (
        <div className="border-y-2 border-ink/40 py-2.5">
          <div className="mb-1.5 flex items-center justify-between">
            <p className="kicker">coach — from last time’s ratings</p>
            <button
              onClick={() => setCoachHidden(true)}
              aria-label="dismiss coach suggestions"
              className="px-1 text-ink/40 hover:text-ink"
            >
              ✕
            </button>
          </div>
          <div className="flex flex-col gap-1 text-sm">
            {coach.map((r) => (
              <p key={r.muscle} className="text-ink/80">
                <span className="font-extrabold capitalize text-ink">
                  {r.muscle}
                </span>
                {' — '}
                {r.summary}
                <span className="block text-xs text-ink/50">{r.reason}</span>
              </p>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          className={inputClass}
          placeholder="session title (optional)"
          value={w.title ?? ''}
          onChange={(e) => setW({ ...w, title: e.target.value || undefined })}
        />
        <input
          className={inputClass}
          type="datetime-local"
          aria-label="workout date and time"
          value={toLocalInput(w.start)}
          onChange={(e) =>
            e.target.value &&
            setW({ ...w, start: new Date(e.target.value).toISOString() })
          }
        />
      </div>

      {w.kind === 'cardio' && (
        <div className="flex gap-2">
          <input
            className={inputClass}
            type="number"
            inputMode="numeric"
            placeholder="duration (min)"
            value={w.durationMin ?? ''}
            onChange={(e) => setW({ ...w, durationMin: numeric(e.target.value) })}
          />
          <input
            className={inputClass}
            type="number"
            inputMode="decimal"
            placeholder="distance (miles)"
            value={
              w.distanceM != null
                ? Math.round((w.distanceM / MILE) * 100) / 100
                : ''
            }
            onChange={(e) =>
              setW({
                ...w,
                distanceM: e.target.value
                  ? Math.round(Number(e.target.value) * MILE)
                  : undefined,
              })
            }
          />
        </div>
      )}

      {w.exercises.map((e, ei) => {
        const prev = prevSetsFor(e.name)
        const muscle = lookup(e.name)
        const bw = w.kind !== 'speed' && isBodyweight(e.name)
        const presc = prescriptions?.[e.name]
        return (
          <div
            key={ei}
            ref={(el) => {
              cardRefs.current[ei] = el
            }}
            className={`border-t-2 border-ink/40 pt-2.5 ${
              dragIndex === ei ? 'bg-accent-100/70 outline outline-2 outline-accent' : ''
            }`}
          >
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <p className="min-w-0 flex-1 truncate text-xl font-extrabold tracking-tight text-ink">
                {e.name}
                {bw && (
                  <span className="ml-2 align-middle text-[9px] font-semibold uppercase tracking-wider text-ink/45">
                    BW
                  </span>
                )}
              </p>
              {muscle && (
                <span className="shrink-0 bg-surface px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-neutral-800">
                  {muscle}
                </span>
              )}
              <button
                onPointerDown={(ev) => onHandlePointerDown(ei, ev)}
                onPointerMove={onHandlePointerMove}
                onPointerUp={onHandlePointerUp}
                onPointerCancel={onHandlePointerUp}
                aria-label={`reorder ${e.name}`}
                className="touch-none cursor-grab select-none px-1 text-base leading-none text-ink/40 hover:text-ink"
              >
                ≡
              </button>
              <button
                onClick={() => removeExercise(ei)}
                className="text-[10px] font-semibold uppercase tracking-widest text-ink/40 hover:text-accent-700"
              >
                remove
              </button>
            </div>

            {presc && (
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-accent-700">
                target {presc.note}
              </p>
            )}

            <div className="grid grid-cols-[1.25rem_2.75rem_1fr_1fr_2.4rem_2rem_1.5rem] items-center gap-1 border-b-2 border-ink/40 pb-1 text-[9px] font-semibold uppercase tracking-widest text-ink/50">
              <span>set</span>
              <span>prev</span>
              {w.kind === 'speed' ? (
                <>
                  <span className="text-center">yd</span>
                  <span className="text-center">sec</span>
                  <span />
                </>
              ) : (
                <>
                  <span className="text-center">{w.weightUnit}</span>
                  <span className="text-center">reps</span>
                  <span className="text-center">rpe</span>
                </>
              )}
              <span />
              <span />
            </div>

            {e.sets.map((s, si) => {
              const ghost = prev[si] ?? prev.at(-1)
              return (
                <div
                  key={si}
                  className="grid grid-cols-[1.25rem_2.75rem_1fr_1fr_2.4rem_2rem_1.5rem] items-center gap-1 border-b border-ink/20 py-1.5"
                >
                  <span className="text-sm font-extrabold text-ink">
                    {si + 1}
                  </span>
                  <span className="truncate text-[11px] text-ink/50">
                    {ghost ? prevSummary(w.kind, ghost) : '—'}
                  </span>
                  {w.kind === 'speed' ? (
                    <>
                      <input
                        className={setInput}
                        type="number"
                        inputMode="numeric"
                        placeholder={
                          ghost?.distanceM != null
                            ? String(Math.round(ghost.distanceM / YD))
                            : ''
                        }
                        value={
                          s.distanceM != null ? Math.round(s.distanceM / YD) : ''
                        }
                        onChange={(ev) =>
                          patchSet(ei, si, {
                            distanceM:
                              ev.target.value === ''
                                ? undefined
                                : Math.round(Number(ev.target.value) * YD * 100) /
                                  100,
                          })
                        }
                      />
                      <input
                        className={setInput}
                        type="number"
                        inputMode="decimal"
                        placeholder={
                          ghost?.durationSec != null
                            ? String(ghost.durationSec)
                            : ''
                        }
                        value={s.durationSec ?? ''}
                        onChange={(ev) =>
                          patchSet(ei, si, {
                            durationSec: numeric(ev.target.value),
                          })
                        }
                      />
                      <span />
                    </>
                  ) : (
                    <>
                      <input
                        className={setInput}
                        type="number"
                        inputMode="decimal"
                        placeholder={
                          // today's body weight rules BW moves (even in
                          // a meso), then the meso target, then history
                          bw && roundedBodyWeight !== undefined
                            ? String(roundedBodyWeight)
                            : presc?.weight != null
                              ? String(presc.weight)
                              : ghost?.weight != null
                                ? String(ghost.weight)
                                : ''
                        }
                        value={s.weight ?? ''}
                        onChange={(ev) =>
                          patchSet(ei, si, { weight: numeric(ev.target.value) })
                        }
                      />
                      <input
                        className={setInput}
                        type="number"
                        inputMode="numeric"
                        placeholder={
                          presc?.targetReps != null
                            ? String(presc.targetReps)
                            : ghost?.reps != null
                              ? String(ghost.reps)
                              : ''
                        }
                        value={s.reps ?? ''}
                        onChange={(ev) =>
                          patchSet(ei, si, { reps: numeric(ev.target.value) })
                        }
                      />
                      <input
                        className={setInput}
                        type="number"
                        inputMode="decimal"
                        placeholder={
                          presc && presc.rir != null
                            ? String(10 - presc.rir) // RIR n ≈ RPE 10-n
                            : 'rpe'
                        }
                        value={s.rpe ?? ''}
                        onChange={(ev) =>
                          patchSet(ei, si, { rpe: numeric(ev.target.value) })
                        }
                      />
                    </>
                  )}
                  <button
                    onClick={() => toggleDone(ei, si, ghost)}
                    aria-label={s.done ? 'set done' : 'mark set done'}
                    className={`flex h-10 items-center justify-center text-base font-extrabold ${
                      s.done
                        ? 'bg-accent text-paper'
                        : 'border border-ink/40 text-ink/35 hover:border-accent'
                    }`}
                  >
                    ✓
                  </button>
                  <button
                    onClick={() => removeSet(ei, si)}
                    aria-label="remove set"
                    className="flex h-10 items-center justify-center text-sm text-ink/35 hover:text-accent-700"
                  >
                    ✕
                  </button>
                </div>
              )
            })}

            <button
              onClick={() => addSet(ei)}
              className="py-2 text-[10px] font-extrabold uppercase tracking-widest text-accent-700 hover:text-accent-600"
            >
              + add set
            </button>
          </div>
        )
      })}

      {w.kind !== 'cardio' && (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <input
              className={inputClass}
              list="exercise-names"
              placeholder={w.kind === 'speed' ? 'add drill…' : 'add exercise…'}
              value={exerciseName}
              onChange={(e) => setExerciseName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addExercise()}
            />
            <datalist id="exercise-names">
              {knownNames.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
            <button onClick={addExercise} className={`${buttonClass} shrink-0`}>
              Add
            </button>
          </div>
          {typedUnknown && (
            <label className="flex items-center gap-2 text-xs text-ink/55">
              new exercise — muscle group:
              <select
                className={`${inputClass} w-auto py-1.5`}
                value={newMuscle}
                onChange={(e) => setNewMuscle(e.target.value)}
              >
                {MUSCLE_GROUPS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      <textarea
        className={`${inputClass} min-h-16`}
        placeholder="notes (optional)"
        value={w.notes ?? ''}
        onChange={(e) => setW({ ...w, notes: e.target.value || undefined })}
      />

      <div className="fixed inset-x-0 bottom-0 z-30 border-t-2 border-ink/40 bg-paper pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-3xl items-center gap-4 px-4 py-3">
          <button
            onClick={() =>
              onFinish({ ...w, end: isNew ? new Date().toISOString() : w.end })
            }
            className={`${buttonClass} flex-1 justify-between`}
          >
            {isNew ? 'Finish workout' : 'Save changes'}
            <span>→</span>
          </button>
          {isNew && (
            <button
              onClick={onCancel}
              className="text-[10px] font-semibold uppercase tracking-widest text-ink/45 hover:text-accent-700"
            >
              Discard
            </button>
          )}
          {onDelete && (
            <button
              onClick={() => onDelete(w)}
              className="text-[10px] font-semibold uppercase tracking-widest text-ink/45 hover:text-accent-700"
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Start flow: pick a kind, then a template of that kind (or blank/custom)
// ---------------------------------------------------------------------------

const KIND_BLURB: Record<WorkoutKind, string> = {
  strength: 'Sets, reps, and RPE with last-time ghosts',
  speed: 'Interval timer for sprint and drill work',
  cardio: 'Interval timer, log the miles afterwards',
}

function StartPicker({
  templates,
  onStrength,
  onTimer,
  onDeleteTemplate,
  onCancel,
}: {
  templates: Template[]
  onStrength: (template?: Template) => void
  onTimer: (kind: WorkoutKind, sections: IntervalSection[], title?: string) => void
  onDeleteTemplate: (t: Template) => void
  onCancel: () => void
}) {
  const [kind, setKind] = useState<WorkoutKind | null>(null)
  const [plan, setPlan] = useState<QuickIntervalPlan>(DEFAULT_PLAN)
  const [showCustom, setShowCustom] = useState(false)

  const matching = templates.filter((t) => t.kind === kind)

  function templateMeta(t: Template): string {
    if (t.kind === 'strength' && t.exercises) {
      const sets = t.exercises.reduce((n, e) => n + e.setCount, 0)
      return `${t.exercises.length} exercises · ${sets} sets`
    }
    if (t.sections) {
      return `${t.sections.length} sections · ${fmtSec(totalSec(t.sections))}`
    }
    return ''
  }

  function startTemplate(t: Template) {
    if (t.kind === 'strength') onStrength(t)
    else if (t.sections) onTimer(t.kind, t.sections, t.name)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">
          {kind === null ? 'Start' : `Start ${kind}`}
        </h1>
        <button
          onClick={() => (kind === null ? onCancel() : setKind(null))}
          className="text-[10px] font-semibold uppercase tracking-widest text-ink/45 hover:text-ink"
        >
          {kind === null ? 'Cancel' : '← Back'}
        </button>
      </div>

      {kind === null &&
        (['strength', 'speed', 'cardio'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className="border border-ink/40 p-4 text-left hover:bg-ink/5"
          >
            <span
              className={`px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${KIND_STYLE[k]}`}
            >
              {k}
            </span>
            <p className="mt-1.5 text-sm text-ink/70">{KIND_BLURB[k]}</p>
          </button>
        ))}

      {kind !== null && (
        <>
          {matching.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-2 border border-ink/40 p-3"
            >
              <button
                onClick={() => startTemplate(t)}
                className="flex-1 text-left"
              >
                <p className="text-base font-extrabold text-ink">{t.name}</p>
                <p className="text-xs text-ink/55">{templateMeta(t)}</p>
              </button>
              <button
                onClick={() => onDeleteTemplate(t)}
                className="px-2 text-ink/35 hover:text-accent-700"
                aria-label={`delete template ${t.name}`}
              >
                ✕
              </button>
            </div>
          ))}
          {matching.length === 0 && (
            <p className="text-sm text-ink/45">
              No {kind} templates yet — build one from the Plan tab.
            </p>
          )}

          {kind === 'strength' ? (
            <button
              onClick={() => onStrength()}
              className={`${buttonClass} w-full justify-between`}
            >
              Blank strength session<span>→</span>
            </button>
          ) : kind === 'cardio' ? (
            <button
              onClick={() => onTimer('cardio', [], undefined)}
              className={`${buttonClass} w-full justify-between`}
            >
              Start timer<span>→</span>
            </button>
          ) : showCustom ? (
            <div className="flex flex-col gap-3 border border-ink/40 p-3">
              <PlanFields plan={plan} onChange={setPlan} />
              <button
                onClick={() => onTimer(kind, buildIntervals(plan))}
                className={`${buttonClass} w-full justify-between`}
              >
                Start timer<span>→</span>
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowCustom(true)}
              className={`${secondaryButton} w-full`}
            >
              Custom timer…
            </button>
          )}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Lists: logged training, separated from WHOOP-captured activity
// ---------------------------------------------------------------------------

function WorkoutCard({
  workout,
  onEdit,
  onRepeat,
}: {
  workout: Workout
  onEdit: () => void
  onRepeat: () => void
}) {
  const { sets, volume } = setVolume(workout)
  const metaParts: string[] = []
  if (workout.kind === 'strength' && sets > 0) {
    metaParts.push(`${workout.exercises.length} exercises · ${sets} sets`)
    if (volume > 0) {
      metaParts.push(`${Math.round(volume).toLocaleString()} ${workout.weightUnit}`)
    }
  }
  if (workout.intervals && workout.intervals.length > 0) {
    metaParts.push(`${workout.intervals.length} intervals`)
  }
  if (workout.durationMin != null) metaParts.push(`${workout.durationMin} min`)
  if (workout.distanceM != null) {
    metaParts.push(`${Math.round((workout.distanceM / MILE) * 100) / 100} mi`)
  }
  if (workout.linkedSessionSk) metaParts.push('WHOOP linked')

  return (
    <div className="border-t-2 border-ink/40 pt-2.5">
      <div className="mb-0.5 flex items-baseline justify-between gap-2">
        <p className="min-w-0 truncate text-lg font-extrabold tracking-tight text-ink">
          {workout.title ??
            `${workout.kind[0].toUpperCase()}${workout.kind.slice(1)} session`}
        </p>
        <KindPill kind={workout.kind} />
      </div>
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink/50">
        {fmtDateTime(workout.start)}
        {metaParts.map((part) => ` · ${part}`).join('')}
      </p>
      <div className="flex flex-col gap-0.5 text-sm text-ink/80">
        {workout.exercises.slice(0, 4).map((e, i) => (
          <p key={i} className="truncate">
            <span className="font-semibold text-ink">{e.name}</span>{' '}
            <span className="text-ink/50">
              {e.sets.map((s) => prevSummary(workout.kind, s) ?? '—').join(', ')}
            </span>
          </p>
        ))}
        {workout.exercises.length > 4 && (
          <p className="text-xs text-ink/45">
            +{workout.exercises.length - 4} more
          </p>
        )}
        {workout.notes && <p className="text-xs text-ink/55">{workout.notes}</p>}
      </div>
      <div className="mt-2 flex gap-4">
        <button
          onClick={onEdit}
          className="text-[10px] font-extrabold uppercase tracking-widest text-accent-700 hover:text-accent-600"
        >
          Edit
        </button>
        {workout.kind === 'strength' && (
          <button
            onClick={onRepeat}
            className="text-[10px] font-extrabold uppercase tracking-widest text-accent-700 hover:text-accent-600"
          >
            Repeat
          </button>
        )}
      </div>
    </div>
  )
}

type Mode =
  | { m: 'list' }
  | { m: 'pick' }
  | { m: 'build'; initial?: Template }
  | { m: 'strength'; workout: Workout; isNew: boolean }
  | { m: 'timer'; draft: TimerDraft }
  | { m: 'slots'; template: Template }
  | { m: 'feedback'; workout: Workout }
  | { m: 'meso-setup' }

/** Which bottom-nav tab this instance is rendering (Recovery lives in its
 * own component). One Workouts instance persists across all four so live
 * sessions, drafts, and caches survive tab hops. */
export type WorkoutsTab = 'today' | 'history' | 'plan' | 'progress'

export function Workouts({ api, tab }: { api: Api; tab: WorkoutsTab }) {
  const [segment, setSegment] = useState<'log' | 'captured'>('log')
  const [workouts, setWorkouts] = useState<Workout[]>(loadWorkoutCache)
  const [sessions, setSessions] = useState<SessionRecord[]>([])
  const [templates, setTemplates] = useState<Template[]>(loadTemplateCache)
  const [mesos, setMesos] = useState<Mesocycle[]>(loadMesoCache)
  const [customs, setCustoms] = useState<CustomExercise[]>(loadCustomExercises)
  const muscleLookup = useMemo(() => makeMuscleLookup(customs), [customs])
  const [pendingCount, setPendingCount] = useState(() => loadPending().length)
  const [whoopWeightLb, setWhoopWeightLb] = useState<number | undefined>(undefined)
  const [weights, setWeights] = useState<WeightEntry[]>(loadWeightCache)
  // A number the lifter typed always outranks the strap's measurement
  const bodyWeightLb = currentBodyWeight(weights, whoopWeightLb)
  const [offline, setOffline] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(PAGE)
  const [mode, setMode] = useState<Mode>(() => {
    const timer = loadTimerDraft()
    if (timer) return { m: 'timer', draft: timer }
    const draft = loadDraft()
    if (draft) return { m: 'strength', workout: draft, isNew: true }
    return { m: 'list' }
  })

  async function refresh() {
    try {
      const [wRes, sRes, tRes, eRes, meRes, mRes, wtRes] = await Promise.all([
        api.get('/api/workouts?days=365'),
        api.get('/api/sessions?days=365'),
        api.get('/api/templates'),
        api.get('/api/exercises'),
        api.get('/api/me'),
        api.get('/api/mesos'),
        api.get('/api/weights'),
      ])
      if (wRes.ok) {
        const body = await wRes.json()
        // Overlay the unsynced queue so a workout mid-flush can never vanish
        // from the timeline when the server list (which lacks it) comes back.
        const pending = loadPending()
        const merged = [
          ...pending,
          ...body.workouts.filter(
            (w: Workout) => !pending.some((p) => p.id === w.id),
          ),
        ].sort((a, b) => b.start.localeCompare(a.start))
        setWorkouts(merged)
        saveWorkoutCache(merged)
      }
      if (sRes.ok) setSessions((await sRes.json()).sessions)
      if (tRes.ok) {
        const body = await tRes.json()
        setTemplates(body.templates)
        saveTemplateCache(body.templates)
      }
      if (eRes.ok) {
        const body = await eRes.json()
        setCustoms(body.exercises)
        saveCustomExercises(body.exercises)
      }
      if (meRes.ok) {
        const body = await meRes.json()
        setWhoopWeightLb(body?.whoop?.bodyWeightLb)
      }
      if (wtRes.ok) {
        const body = await wtRes.json()
        if (Array.isArray(body.weights)) {
          setWeights(body.weights)
          saveWeightCache(body.weights)
        }
      }
      if (mRes.ok) {
        const body = await mRes.json()
        if (Array.isArray(body.mesos)) {
          setMesos(body.mesos)
          saveMesoCache(body.mesos)
        }
      }
      setOffline(false)
    } catch {
      setOffline(true) // cached view stays up
    }
  }

  async function sync() {
    const result = await flushQueue(api)
    setPendingCount(result.remaining)
    await refresh()
  }

  useEffect(() => {
    sync()
    const onOnline = () => sync()
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api])

  useEffect(() => {
    setVisibleCount(PAGE)
  }, [segment, tab])

  // Keep the session bus in sync so the resume bar knows when we're live,
  // and tell the shell to yield the tab bar to full-screen flows.
  useEffect(() => {
    setInSession(mode.m === 'strength' || mode.m === 'timer')
    setOverlay(mode.m !== 'list')
    return () => {
      setInSession(false)
      setOverlay(false)
    }
  }, [mode])

  // Resume from the persistent bar while already mounted: re-enter the
  // draft — unless the user is mid-way through planning a mesocycle,
  // which a mode swap would silently destroy.
  const modeRef = useRef(mode)
  modeRef.current = mode
  useEffect(() => {
    return onResume(() => {
      if (modeRef.current.m === 'meso-setup') return
      const timer = loadTimerDraft()
      if (timer) {
        setMode({ m: 'timer', draft: timer })
        return
      }
      const draft = loadDraft()
      if (draft) setMode({ m: 'strength', workout: draft, isNew: true })
    })
  }, [])

  /**
   * Strength sessions detour through the how-did-it-feel modal before the
   * save lands; timer saves and edits go straight through.
   */
  function finish(raw: Workout, opts?: { isNew?: boolean }) {
    if (
      raw.kind === 'strength' &&
      opts?.isNew &&
      feedbackMuscles(raw, muscleLookup).length > 0
    ) {
      // The draft stays (crash-safety) but the session is over — keep the
      // lock-screen widget from re-advertising it while the modal is up.
      setLockScreenSuppressed(true)
      stopLockScreen()
      setMode({ m: 'feedback', workout: raw })
      return
    }
    commitFinish(raw)
  }

  function commitFinish(raw: Workout) {
    const w = finalizeWorkout(raw)
    enqueue(w)
    setPendingCount(loadPending().length)
    setWorkouts((prev) => {
      const merged = [w, ...prev.filter((x) => x.id !== w.id)].sort((a, b) =>
        b.start.localeCompare(a.start),
      )
      saveWorkoutCache(merged)
      return merged
    })
    saveDraft(null)
    saveTimerDraft(null)
    setLockScreenSuppressed(false) // drafts are gone; nothing to resurrect
    setMode({ m: 'list' })
    void sync()
  }

  async function remove(w: Workout) {
    try {
      const res = await api.send(
        'DELETE',
        `/api/workouts?id=${encodeURIComponent(w.id)}&start=${encodeURIComponent(w.start)}`,
      )
      if (!res.ok) throw new Error(`API responded ${res.status}`)
      setWorkouts((prev) => {
        const next = prev.filter((x) => x.id !== w.id)
        saveWorkoutCache(next)
        return next
      })
      setMode({ m: 'list' })
    } catch {
      setError('Deleting needs a connection — try again when online.')
    }
  }

  function saveCustomExercise(name: string, muscle: string) {
    // Optimistic: usable immediately, server write is fire-and-forget (the
    // exercise also lives inside the workout record either way)
    setCustoms((prev) => {
      const next = [
        ...prev.filter((c) => c.name.toLowerCase() !== name.toLowerCase()),
        { name, muscle },
      ]
      saveCustomExercises(next)
      return next
    })
    void api.send('POST', '/api/exercises', { name, muscle }).catch(() => {})
  }

  async function removeTemplate(t: Template) {
    try {
      const res = await api.send(
        'DELETE',
        `/api/templates?id=${encodeURIComponent(t.id)}`,
      )
      if (!res.ok) throw new Error(`API responded ${res.status}`)
      setTemplates((prev) => {
        const next = prev.filter((x) => x.id !== t.id)
        saveTemplateCache(next)
        return next
      })
    } catch {
      setError('Deleting templates needs a connection.')
    }
  }

  function upsertMeso(meso: Mesocycle) {
    // Optimistic — the card keeps working offline; refresh() reconciles.
    setMesos((prev) => {
      const next = [...prev.filter((m) => m.id !== meso.id), meso]
      saveMesoCache(next)
      return next
    })
    void api
      .send('POST', '/api/mesos', meso)
      .then((res) => {
        if (!res.ok) throw new Error(`API responded ${res.status}`)
      })
      .catch(() => setError('Syncing the mesocycle needs a connection.'))
  }

  /** Start the given microcycle day with this week's prescriptions. */
  function startMesoDay(meso: Mesocycle, dayIndex: number) {
    const day = meso.days[dayIndex]
    if (!day) return
    const now = Date.now()
    // Overdue mesos clamp to the deload week's (gentle) prescriptions
    const week = Math.min(mesoWeek(meso, now), meso.weeks - 1)

    if (dayKind(day) === 'cardio') {
      // Cardio days run the interval timer (or stopwatch), tagged to the
      // meso so day tracking counts them like any other session.
      if (
        (loadDraft() || loadTimerDraft()) &&
        !window.confirm(
          'A session is already live — discard it and start this one?',
        )
      ) {
        return
      }
      saveDraft(null)
      const draft: TimerDraft = {
        kind: 'cardio',
        title: `${day.label} · wk ${week + 1}`,
        sections: day.sections ?? [],
        startEpoch: Date.now(),
        skipOffsetMs: 0,
        paused: false,
        pausedElapsedMs: 0,
        mesoId: meso.id,
        mesoDayIndex: dayIndex,
      }
      saveTimerDraft(draft)
      autoStartLockScreen()
      setMode({ m: 'timer', draft })
      return
    }

    const mesoWorkouts = workouts.filter((w) => w.mesoId === meso.id)
    const planned = plannedSets(meso, day, week, mesoWorkouts, muscleLookup, now)
    const w = newWorkout('strength')
    w.mesoId = meso.id
    w.mesoDayIndex = dayIndex
    w.title = `${day.label} · wk ${week + 1}`
    w.exercises = planned.map((e) => ({
      name: e.name,
      sets: Array.from({ length: e.setCount }, () => ({})),
    }))
    beginStrength(w)
  }

  function beginStrength(w: Workout) {
    // A minimized live session's draft must not be silently clobbered
    if (
      (loadDraft() || loadTimerDraft()) &&
      !window.confirm('A session is already live — discard it and start this one?')
    ) {
      return
    }
    saveTimerDraft(null)
    // Still on a click's call stack — autoplay needs the gesture
    autoStartLockScreen()
    setMode({ m: 'strength', workout: w, isNew: true })
  }

  /** Template entries -> session exercises, with coach set-deltas applied.
   * Recommendations are computed here, at start time, so the 7-day volume
   * window can't go stale in a long-lived tab. */
  function buildExercises(entries: Array<{ name: string; setCount: number }>) {
    const recs = recommendations(workouts, muscleLookup)
    return applyRecommendations(entries, recs, muscleLookup).map((e) => ({
      name: e.name,
      sets: Array.from({ length: e.setCount }, () => ({})),
    }))
  }

  function startStrength(template?: Template) {
    if (template && hasSlots(template)) {
      setMode({ m: 'slots', template })
      return
    }
    const w = newWorkout('strength')
    if (template) {
      w.title = template.name
      w.exercises = buildExercises(
        (template.exercises ?? []).map((e) => ({
          name: e.name,
          setCount: e.setCount,
        })),
      )
    }
    beginStrength(w)
  }

  function startTimer(
    kind: WorkoutKind,
    sections: IntervalSection[],
    title?: string,
  ) {
    const draft: TimerDraft = {
      kind,
      title,
      sections,
      startEpoch: Date.now(),
      skipOffsetMs: 0,
      paused: false,
      pausedElapsedMs: 0,
    }
    saveTimerDraft(draft)
    autoStartLockScreen()
    setMode({ m: 'timer', draft })
  }

  function cancelStrength(w: Workout, isNew: boolean) {
    if (
      isNew &&
      w.exercises.length > 0 &&
      !window.confirm('Discard this workout?')
    ) {
      return
    }
    saveDraft(null)
    setMode({ m: 'list' })
  }

  if (mode.m === 'strength') {
    const originalStart = mode.workout.start
    // Meso sessions carry per-exercise targets anchored to this meso's
    // logged actuals; recomputed here so minimize/resume keeps them.
    const meso = mode.workout.mesoId
      ? mesos.find((x) => x.id === mode.workout.mesoId)
      : undefined
    let prescriptions: Record<string, Prescription> | undefined
    if (meso && mode.isNew) {
      const now = Date.now()
      const week = Math.min(mesoWeek(meso, now), meso.weeks - 1)
      prescriptions = prescribeExercises(
        meso,
        mode.workout.exercises.map((e) => e.name),
        week,
        workouts.filter(
          (w) => w.mesoId === meso.id && w.id !== mode.workout.id,
        ),
        workouts,
        Object.fromEntries(
          mode.workout.exercises.map((e) => [e.name, e.sets.length]),
        ),
        muscleLookup,
        bodyWeightLb,
      )
    }
    return (
      <ActiveWorkout
        initial={mode.workout}
        isNew={mode.isNew}
        history={workouts}
        customs={customs}
        lookup={muscleLookup}
        bodyWeightLb={bodyWeightLb}
        prescriptions={prescriptions}
        onSaveCustom={saveCustomExercise}
        onFinish={(w) =>
          finish(
            // An edited start time is a key move — tell the API which old
            // row to drop so the workout doesn't duplicate.
            !mode.isNew && w.start !== originalStart
              ? { ...w, previousStart: originalStart }
              : w,
            { isNew: mode.isNew },
          )
        }
        onCancel={() => cancelStrength(mode.workout, mode.isNew)}
        onMinimize={() => setMode({ m: 'list' })}
        onDelete={mode.isNew ? undefined : remove}
      />
    )
  }

  if (mode.m === 'timer') {
    return (
      <IntervalSession
        initial={mode.draft}
        sessions={sessions}
        onSave={finish}
        onCancel={() => setMode({ m: 'list' })}
        onMinimize={() => setMode({ m: 'list' })}
      />
    )
  }

  if (mode.m === 'slots') {
    return (
      <SlotFill
        template={mode.template}
        customs={customs}
        lookup={muscleLookup}
        history={workouts}
        onStart={(entries) => {
          // A free-typed pick inherits its slot's muscle group, otherwise
          // feedback and progression would never see the exercise.
          const slotEntries = mode.template.exercises ?? []
          entries.forEach((e, i) => {
            const muscle = slotEntries[i]?.muscle
            if (muscle && muscleLookup(e.name) === undefined) {
              saveCustomExercise(e.name, muscle)
            }
          })
          const w = newWorkout('strength')
          w.title = mode.template.name
          w.exercises = buildExercises(entries)
          beginStrength(w)
        }}
        onCancel={() => setMode({ m: 'pick' })}
      />
    )
  }

  if (mode.m === 'feedback') {
    return (
      <FeedbackModal
        muscles={feedbackMuscles(mode.workout, muscleLookup)}
        onSubmit={(fb) => commitFinish({ ...mode.workout, feedback: fb })}
        onSkip={() => commitFinish(mode.workout)}
      />
    )
  }

  if (mode.m === 'meso-setup') {
    return (
      <MesoSetup
        templates={templates}
        customs={customs}
        lookup={muscleLookup}
        history={workouts}
        onSave={(m) => {
          // Slot-derived rows carry a muscle — register free-typed names
          // so feedback/volume/prescriptions can resolve them (the same
          // convention SlotFill established).
          for (const day of m.days) {
            for (const e of day.exercises) {
              if (e.muscle && muscleLookup(e.name) === undefined) {
                saveCustomExercise(e.name, e.muscle)
              }
            }
          }
          upsertMeso(m)
          setMode({ m: 'list' })
        }}
        onCancel={() => setMode({ m: 'list' })}
      />
    )
  }

  if (mode.m === 'pick') {
    return (
      <StartPicker
        templates={templates}
        onStrength={startStrength}
        onTimer={startTimer}
        onDeleteTemplate={removeTemplate}
        onCancel={() => setMode({ m: 'list' })}
      />
    )
  }

  if (mode.m === 'build') {
    return (
      <TemplateBuilder
        api={api}
        customs={customs}
        initial={mode.initial}
        onSaveCustom={saveCustomExercise}
        onSaved={(t) => {
          setTemplates((prev) => {
            const next = [...prev.filter((x) => x.id !== t.id), t]
            saveTemplateCache(next)
            return next
          })
          setMode({ m: 'list' })
        }}
        onCancel={() => setMode({ m: 'list' })}
      />
    )
  }

  // ---- tabbed list content (mode 'list') ----

  if (tab === 'today') {
    return (
      <Today
        api={api}
        workouts={workouts}
        meso={activeMeso(mesos)}
        lookup={muscleLookup}
        bodyWeightLb={bodyWeightLb}
        onStartMesoDay={(i) => {
          const m = activeMeso(mesos)
          if (m) startMesoDay(m, i)
        }}
        onStartWorkout={() => setMode({ m: 'pick' })}
        onPlan={() => setMode({ m: 'meso-setup' })}
        onEndMeso={() => {
          const m = activeMeso(mesos)
          if (m) upsertMeso({ ...m, status: 'completed' })
        }}
      />
    )
  }

  if (tab === 'progress') {
    return (
      <Suspense
        fallback={
          <p className="py-12 text-center text-sm text-ink/45">Loading…</p>
        }
      >
        <div className="flex flex-col gap-4">
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">
            Progress
          </h1>
          <Analytics
            api={api}
            workouts={workouts}
            sessions={sessions}
            customs={customs}
          />
        </div>
      </Suspense>
    )
  }

  if (tab === 'plan') {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">
          Plan
        </h1>
        <MesoCard
          meso={activeMeso(mesos)}
          workouts={workouts}
          onStartDay={(i) => {
            const m = activeMeso(mesos)
            if (m) startMesoDay(m, i)
          }}
          onEnd={(status) => {
            const m = activeMeso(mesos)
            if (m) upsertMeso({ ...m, status })
          }}
          onPlan={() => setMode({ m: 'meso-setup' })}
        />
        {error && (
          <p className="text-sm font-semibold text-accent-700">{error}</p>
        )}
        <Manage
          api={api}
          templates={templates}
          customs={customs}
          workouts={workouts}
          onNewTemplate={() => setMode({ m: 'build' })}
          onEditTemplate={(t) => setMode({ m: 'build', initial: t })}
          onDeleteTemplate={removeTemplate}
          onCustomsChange={(next) => {
            setCustoms(next)
            saveCustomExercises(next)
          }}
          onTemplatesChange={(next) => {
            setTemplates(next)
            saveTemplateCache(next)
          }}
          onWorkoutsChange={(next) => {
            setWorkouts(next)
            saveWorkoutCache(next)
          }}
        />
      </div>
    )
  }

  // tab === 'history'
  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">
          History
        </h1>
        <button onClick={() => setMode({ m: 'pick' })} className={buttonClass}>
          Start workout
        </button>
      </div>

      <div className="flex border border-ink/40">
        {(
          [
            ['log', 'Logged'],
            ['captured', 'Captured'],
          ] as const
        ).map(([value, label], i) => (
          <button
            key={value}
            onClick={() => setSegment(value)}
            className={`flex-1 py-1.5 text-[10px] uppercase tracking-wider ${
              i > 0 ? 'border-l border-ink/40' : ''
            } ${
              segment === value
                ? 'bg-accent font-extrabold text-paper'
                : 'font-semibold text-ink/60 hover:bg-ink/5'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {offline && (
        <p className="bg-accent-200 px-2 py-1 text-xs font-semibold text-accent-800">
          Offline — showing cached workouts.
          {pendingCount > 0 && ` ${pendingCount} pending sync.`}
        </p>
      )}
      {!offline && pendingCount > 0 && (
        <p className="bg-accent-200 px-2 py-1 text-xs font-semibold text-accent-800">
          {pendingCount} workout(s) pending sync…
        </p>
      )}
      {error && (
        <p className="text-sm font-semibold text-accent-700">{error}</p>
      )}

      {segment === 'log' && (
        <div className="flex flex-col gap-3">
          {workouts.length === 0 && (
            <p className="py-8 text-center text-sm text-ink/45">
              Nothing logged yet — hit “Start workout” at the gym.
            </p>
          )}
          {workouts.slice(0, visibleCount).map((w) => (
            <WorkoutCard
              key={w.id}
              workout={w}
              onEdit={() => setMode({ m: 'strength', workout: w, isNew: false })}
              onRepeat={() =>
                // Through beginStrength: guards a live draft like every
                // other session start.
                beginStrength({
                  ...w,
                  id: crypto.randomUUID(),
                  start: new Date().toISOString(),
                  end: undefined,
                  updatedAt: undefined,
                  // Ratings and meso membership belong to the session
                  // they came from — a repeat is a plain ad-hoc workout.
                  feedback: undefined,
                  mesoId: undefined,
                  mesoDayIndex: undefined,
                  exercises: w.exercises.map((e) => ({
                    ...e,
                    sets: e.sets.map((s) => ({ ...s, done: false })),
                  })),
                })
              }
            />
          ))}
          {workouts.length > PAGE && (
            <p className="text-xs text-ink/45">
              Showing {Math.min(visibleCount, workouts.length)} of{' '}
              {workouts.length}
            </p>
          )}
          {visibleCount < workouts.length && (
            <button
              onClick={() => setVisibleCount((n) => n + PAGE)}
              className={`${secondaryButton} w-full`}
            >
              Show more
            </button>
          )}
        </div>
      )}

      {segment === 'captured' &&
        (() => {
          const sorted = sessions
            .slice()
            .sort((a, b) => b.start.localeCompare(a.start))
          const visible = sorted.slice(0, visibleCount)
          return (
            <div className="flex flex-col gap-3">
              {sessions.length === 0 && (
                <p className="py-8 text-center text-sm text-ink/45">
                  No captured activity yet — data from connected wearables lands
                  here automatically.
                </p>
              )}
              {visible.map((s) => (
                <Card
                  key={s.sk}
                  title={s.sport ?? 'Activity'}
                  subtitle={fmtDateTime(s.start)}
                >
                  <p className="text-sm text-ink/70">
                    {s.strain != null && `strain ${Math.round(s.strain * 10) / 10}`}
                    {s.avgHr != null && ` · ${Math.round(s.avgHr)} bpm avg`}
                    {s.maxHr != null && ` · ${Math.round(s.maxHr)} max`}
                    {s.distanceM != null &&
                      ` · ${Math.round((s.distanceM / MILE) * 100) / 100} mi`}
                  </p>
                </Card>
              ))}
              {sorted.length > 0 && (
                <p className="text-xs text-ink/45">
                  Showing {visible.length} of {sorted.length}
                </p>
              )}
              {visibleCount < sorted.length && (
                <button
                  onClick={() => setVisibleCount((n) => n + PAGE)}
                  className={`${secondaryButton} w-full`}
                >
                  Show more
                </button>
              )}
            </div>
          )
        })()}
    </>
  )
}
