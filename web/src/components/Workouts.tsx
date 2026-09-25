import {
  Suspense,
  lazy,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { ComponentProps } from 'react'
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
  workoutVolume,
  type IntervalSection,
  type SessionRecord,
  type TimerDraft,
  type Workout,
  type WorkoutKind,
  type WorkoutSet,
} from '../lib/workouts'
import {
  autoStartLockScreen,
  lockScreenSupported,
  setLockScreenSuppressed,
  stopLockScreen,
} from '../lib/lockScreen'
import {
  activeMeso,
  dayKind,
  loadMesoCache,
  mesoWeek,
  plannedSets,
  plannedSetsForExercise,
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
import { onResume, setInSession } from '../lib/sessionBus'
import { currentBodyWeight, loadWeightCache, saveWeightCache, type WeightEntry } from '../lib/weights'
import { Banner } from './cadence/Banner'
import { Button } from './cadence/Button'
import { Card } from './cadence/Card'
import { Field, SELECT_WELL, TextArea, TextInput } from './cadence/Field'
import { IconButton } from './cadence/IconButton'
import { List, ListItem } from './cadence/ListItem'
import { Progress, SessionBar } from './cadence/SessionBar'
import { AddSetButton, SetHeader, SetRow, type SetField } from './cadence/SetRow'
import { StatusPill } from './cadence/StatusPill'
import { FeedbackModal } from './Feedback'
import { IntervalSession } from './IntervalTimer'
import { LockScreenSwitch } from './LockScreenSwitch'
import { Manage } from './Manage'
import { Chips } from './shell/Chips'
import {
  IconChevronDown,
  IconChevronLeft,
  IconGrip,
  IconPlus,
  IconRun,
  IconSpeed,
  IconStrength,
  IconX,
} from './shell/icons'
import { Sheet } from './shell/Sheet'
import { useSheetDismiss } from './shell/useSheetDismiss'
import { SlotFill } from './SlotFill'
import { KIND_LEAD, PlanFields, TemplateBuilder, templateMeta } from './TemplateBuilder'
import { Today } from './Today'
import { WorkoutDetail } from './WorkoutDetail'

// Trends carries the recharts dependency — split it out of the logger path
const Trends = lazy(() =>
  import('./Trends').then((m) => ({ default: m.Trends })),
)

const YD = 0.9144
const MILE = 1609.34

/** Long histories render in pages — keeps the list DOM small offline too. */
const PAGE = 20

/** The Log chips: every kind, one kind, or the strap's captured sessions. */
type LogFilter = 'all' | WorkoutKind | 'captured'

const LOG_CHIPS: Array<{ value: LogFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'strength', label: 'Strength' },
  { value: 'speed', label: 'Speed' },
  { value: 'cardio', label: 'Cardio' },
  { value: 'captured', label: 'Captured' },
]

const KIND_LABEL: Record<WorkoutKind, string> = {
  strength: 'Strength',
  speed: 'Speed',
  cardio: 'Cardio',
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

function fmtElapsed(ms: number): string {
  return fmtSec(ms / 1000)
}

function toLocalInput(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Local calendar day as YYYY-MM-DD. */
function localDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Monday of the local week holding an instant, as a local day. */
function mondayOf(ms: number): string {
  const d = new Date(ms)
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return localDay(d)
}

/** A local day moved by whole days, safe across DST. */
function shiftDay(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00`)
  d.setDate(d.getDate() + days)
  return localDay(d)
}

/** "Sep 8" for a section heading. */
function fmtDay(day: string): string {
  return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

/** Minutes a workout took: the logged figure, else its clock span. */
function workoutMinutes(w: Workout): number | null {
  if (w.durationMin != null) return w.durationMin
  if (!w.end) return null
  const ms = new Date(w.end).getTime() - new Date(w.start).getTime()
  return ms > 0 ? Math.round(ms / 60_000) : null
}

/** The ghost line under a set row: what this set was last time. */
function ghostLine(kind: WorkoutKind, s: WorkoutSet | undefined): string | undefined {
  if (!s) return undefined
  if (kind === 'speed') {
    if (s.distanceM == null && s.durationSec == null) return undefined
    const parts: string[] = []
    if (s.distanceM != null) parts.push(`${Math.round(s.distanceM / YD)} yd`)
    if (s.durationSec != null) parts.push(`${s.durationSec} s`)
    return `Last time ${parts.join(' · ')}`
  }
  if (s.weight == null && s.reps == null) return undefined
  const line = `Last time ${s.weight ?? '—'} × ${s.reps ?? '—'}`
  return s.rpe != null ? `${line} @ ${s.rpe}` : line
}

/** Rep target a row is showing: the block's per-set plan (a 12/10 session
 * progresses to 13/11, not 13/13), then its headline, then last time's. */
function ghostReps(
  presc: Prescription | undefined,
  prev: WorkoutSet | undefined,
  si: number,
): number | undefined {
  return presc?.targetRepsBySet?.[si] ?? presc?.targetReps ?? prev?.reps
}

/** Effort a row is showing: inside a block the week's target (RPE ≈ 10 −
 * RIR), otherwise last time's rating. A deload deliberately has none —
 * "stop far from failure" is not a number to prefill. */
function ghostRpe(
  presc: Prescription | undefined,
  prev: WorkoutSet | undefined,
): number | undefined {
  if (presc) return presc.rir != null ? 10 - presc.rir : undefined
  return prev?.rpe
}

// ---------------------------------------------------------------------------
// Strength session (RP-style: check off sets as you go)
// ---------------------------------------------------------------------------

function SessionEditor({
  initial,
  isNew,
  history,
  customs,
  lookup,
  bodyWeightLb,
  prescribe,
  mesoSetCount,
  onSaveCustom,
  onFinish,
  onClose,
  onDiscard,
  onDelete,
}: {
  initial: Workout
  isNew: boolean
  history: Workout[]
  customs: CustomExercise[]
  lookup: (name: string) => string | undefined
  bodyWeightLb?: number
  /** Meso targets for a set of exercises — ghosts and check-offs adopt
   * these. A function, not a snapshot: the list changes mid-session. */
  prescribe?: (
    names: string[],
    setsByName: Record<string, number>,
  ) => Record<string, Prescription>
  /** How many sets a lift added mid-block should start with. */
  mesoSetCount?: (name: string, usedByMuscle: number) => number
  onSaveCustom: (name: string, muscle: string) => void
  /** Finish (live) or Save (editing); runs once the sheet has dropped. */
  onFinish: (w: Workout) => void
  /** Minimise (live) or Back (editing); runs once the sheet has dropped. */
  onClose: () => void
  /** A live session thrown away; the draft is already cleared. */
  onDiscard: () => void
  /** Resolves true once the saved workout is gone. */
  onDelete?: (w: Workout) => Promise<boolean>
}) {
  const [w, setW] = useState<Workout>(initial)
  const [exerciseName, setExerciseName] = useState('')
  const [newMuscle, setNewMuscle] = useState<string>('other')
  const [now, setNow] = useState(Date.now())
  const [coachHidden, setCoachHidden] = useState(false)
  const exerciseId = useId()
  const muscleId = useId()
  const titleId = useId()
  const startId = useId()
  const notesId = useId()
  const durationId = useId()
  const distanceId = useId()

  // Every way out unmounts this screen in the parent, so the sheet drops
  // first and the real callback waits for the exit to finish.
  const { open, dismiss, onExited } = useSheetDismiss()

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

  // Targets follow the exercise list: swap a lift or add one mid-session
  // and it gets ghosts and a target like any lift the block planned.
  // Keyed on the list's shape so typing in a set field can't re-run it.
  const exerciseShape = w.exercises
    .map((e) => `${e.name}:${e.sets.length}`)
    .join('|')
  const prescriptions = useMemo(
    () =>
      prescribe?.(
        w.exercises.map((e) => e.name),
        Object.fromEntries(w.exercises.map((e) => [e.name, e.sets.length])),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prescribe, exerciseShape],
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

  /** Last time's sets, for ghost placeholders per set index. Inside a
   * mesocycle the same lift on two different days is two separate slots,
   * so pass 0 looks for the same meso day and only pass 1 widens to any
   * session. */
  function prevSetsFor(name: string): WorkoutSet[] {
    const sameSlot = (past: Workout) =>
      w.mesoId != null &&
      past.mesoId === w.mesoId &&
      past.mesoDayIndex === w.mesoDayIndex
    for (const pass of [0, 1]) {
      for (const past of history) {
        if (past.id === w.id) continue
        if (pass === 0 && !sameSlot(past)) continue
        const match = past.exercises.find(
          (e) => e.name.toLowerCase() === name.toLowerCase(),
        )
        if (match && match.sets.length > 0) return match.sets
      }
    }
    return []
  }

  function addExercise() {
    const name = exerciseName.trim()
    if (!name) return
    // First time we see this name: remember it (and its muscle) per-user
    if (lookup(name) === undefined) onSaveCustom(name, newMuscle)
    const prev = prevSetsFor(name)
    // Inside a block the block sizes the lift: a swap onto a focus muscle
    // picks up this week's ramp, everything else repeats what it did last
    // time — and the per-muscle session cap still applies.
    const muscle = lookup(name)
    const used =
      muscle === undefined
        ? 0
        : w.exercises.reduce(
            (n, e) => (lookup(e.name) === muscle ? n + e.sets.length : n),
            0,
          )
    const rows = mesoSetCount?.(name, used) ?? Math.max(prev.length, 1)
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
    // Checking an empty row adopts exactly what the row was SHOWING —
    // the meso prescription when there is one, else last time's (RP-style
    // "same again"). Effort included: an unrated set is a set the engine
    // has to guess the effort of later. Bodyweight moves track TODAY's
    // measured mass. A typed value always wins, and whatever lands here
    // anchors the next meso prescription — enter 355 where the plan said
    // 335 and next session builds on 355.
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
      reps: current.reps ?? ghostReps(presc, prev, si),
      rpe: current.rpe ?? ghostRpe(presc, prev),
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

  function finish() {
    const done = { ...w, end: isNew ? new Date().toISOString() : w.end }
    dismiss(() => onFinish(done))
  }

  function discard() {
    if (w.exercises.length > 0 && !window.confirm('Discard this workout?')) {
      return
    }
    saveDraft(null)
    dismiss(onDiscard)
  }

  function deleteSaved() {
    if (!onDelete) return
    void onDelete(w).then((ok) => {
      if (ok) dismiss(onClose)
    })
  }

  const heading = w.title || KIND_LABEL[w.kind]
  const headerLabels =
    w.kind === 'speed' ? ['yd', 's'] : [w.weightUnit, 'reps', 'rpe']

  return (
    <Sheet
      open={open}
      onClose={() => dismiss(onClose)}
      onExited={onExited}
      ariaLabel={isNew ? 'Live session' : 'Edit workout'}
    >
      <SessionBar
        left={
          <IconButton
            label={isNew ? 'Minimise' : 'Back'}
            onClick={() => dismiss(onClose)}
          >
            {isNew ? <IconChevronDown /> : <IconChevronLeft />}
          </IconButton>
        }
        center={
          <div className="flex min-w-0 items-baseline gap-2">
            {isNew ? (
              <span className="text-numeric-lg text-ink">
                {fmtElapsed(now - new Date(w.start).getTime())}
              </span>
            ) : (
              <span className="truncate text-body font-medium text-ink">
                {fmtDate(w.start)}
              </span>
            )}
            {totalCount > 0 && (
              <span className="shrink-0 text-caption text-ink-2">
                {doneCount} of {totalCount} sets
              </span>
            )}
          </div>
        }
        right={
          <Button variant="tonal" size="sm" onClick={finish}>
            {isNew ? 'Finish' : 'Save'}
          </Button>
        }
        progress={
          isNew ? (
            <Progress
              value={totalCount > 0 ? doneCount / totalCount : 0}
              label="Sets done"
            />
          ) : undefined
        }
      />

      <div className="mt-3 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="min-w-0 truncate text-title text-ink">{heading}</h2>
          {isNew && (
            <StatusPill tone="effort" dot>
              Live
            </StatusPill>
          )}
        </div>

        {isNew && lockScreenSupported() && (
          <Card>
            <LockScreenSwitch />
          </Card>
        )}

        {coach.length > 0 && !coachHidden && (
          <Card tone="brand">
            <div className="flex items-start justify-between gap-3">
              <p className="text-eyebrow">Coach</p>
              <IconButton
                size="sm"
                inherit
                label="Dismiss"
                onClick={() => setCoachHidden(true)}
              >
                <IconX className="h-4 w-4" />
              </IconButton>
            </div>
            <div className="mt-1 flex flex-col gap-2">
              {coach.map((r) => (
                <p key={r.muscle} className="text-body">
                  <span className="font-semibold capitalize">{r.muscle}</span>
                  {' · '}
                  {r.summary}
                  <span className="block text-caption opacity-80">
                    {r.reason}
                  </span>
                </p>
              ))}
            </div>
          </Card>
        )}

        {w.kind === 'cardio' && (
          <Card>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Duration (min)" htmlFor={durationId}>
                <TextInput
                  id={durationId}
                  type="number"
                  inputMode="numeric"
                  value={w.durationMin ?? ''}
                  onChange={(e) =>
                    setW({ ...w, durationMin: numeric(e.target.value) })
                  }
                />
              </Field>
              <Field label="Distance (mi)" htmlFor={distanceId}>
                <TextInput
                  id={distanceId}
                  type="number"
                  inputMode="decimal"
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
              </Field>
            </div>
          </Card>
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
              className={dragIndex === ei ? 'rounded-lg shadow-float' : ''}
            >
              <Card>
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-title-sm text-ink">{e.name}</p>
                    {(muscle || bw) && (
                      <div className="mt-0.5 flex items-center gap-2">
                        {muscle && (
                          <span className="text-caption text-ink-2">
                            {muscle}
                          </span>
                        )}
                        {bw && <StatusPill>Bodyweight</StatusPill>}
                      </div>
                    )}
                  </div>
                  <IconButton
                    size="sm"
                    label="Reorder"
                    onPointerDown={(ev) => onHandlePointerDown(ei, ev)}
                    onPointerMove={onHandlePointerMove}
                    onPointerUp={onHandlePointerUp}
                    onPointerCancel={onHandlePointerUp}
                    className="touch-none cursor-grab select-none"
                  >
                    <IconGrip />
                  </IconButton>
                  <IconButton
                    size="sm"
                    label="Remove exercise"
                    onClick={() => removeExercise(ei)}
                  >
                    <IconX className="h-4 w-4" />
                  </IconButton>
                </div>

                {presc && (
                  <p className="mt-2 text-caption text-brand-strong">
                    {presc.note}
                  </p>
                )}

                <div className="mt-3 flex flex-col">
                  <SetHeader labels={headerLabels} />
                  {e.sets.map((s, si) => {
                    const ghost = prev[si] ?? prev.at(-1)
                    const fields: SetField[] =
                      w.kind === 'speed'
                        ? [
                            {
                              key: 'yd',
                              value:
                                s.distanceM != null
                                  ? Math.round(s.distanceM / YD)
                                  : undefined,
                              placeholder:
                                ghost?.distanceM != null
                                  ? String(Math.round(ghost.distanceM / YD))
                                  : '',
                              ariaLabel: `Set ${si + 1} yards`,
                              inputMode: 'numeric',
                              onChange: (v) =>
                                patchSet(ei, si, {
                                  distanceM:
                                    v === undefined
                                      ? undefined
                                      : Math.round(v * YD * 100) / 100,
                                }),
                            },
                            {
                              key: 's',
                              value: s.durationSec,
                              placeholder:
                                ghost?.durationSec != null
                                  ? String(ghost.durationSec)
                                  : '',
                              ariaLabel: `Set ${si + 1} seconds`,
                              inputMode: 'decimal',
                              onChange: (v) =>
                                patchSet(ei, si, { durationSec: v }),
                            },
                          ]
                        : [
                            {
                              key: 'weight',
                              value: s.weight,
                              // today's body weight rules BW moves (even in
                              // a meso), then the meso target, then history
                              placeholder:
                                bw && roundedBodyWeight !== undefined
                                  ? String(roundedBodyWeight)
                                  : presc?.weight != null
                                    ? String(presc.weight)
                                    : ghost?.weight != null
                                      ? String(ghost.weight)
                                      : '',
                              ariaLabel: `Set ${si + 1} ${w.weightUnit}`,
                              inputMode: 'decimal',
                              onChange: (v) => patchSet(ei, si, { weight: v }),
                            },
                            {
                              key: 'reps',
                              value: s.reps,
                              placeholder:
                                ghostReps(presc, ghost, si)?.toString() ?? '',
                              ariaLabel: `Set ${si + 1} reps`,
                              inputMode: 'numeric',
                              onChange: (v) => patchSet(ei, si, { reps: v }),
                            },
                            {
                              key: 'rpe',
                              value: s.rpe,
                              // RIR n ≈ RPE 10−n
                              placeholder:
                                ghostRpe(presc, ghost)?.toString() ?? '',
                              ariaLabel: `Set ${si + 1} RPE`,
                              inputMode: 'decimal',
                              onChange: (v) => patchSet(ei, si, { rpe: v }),
                            },
                          ]
                    return (
                      <SetRow
                        key={si}
                        index={si + 1}
                        fields={fields}
                        done={Boolean(s.done)}
                        onToggleDone={() => toggleDone(ei, si, ghost)}
                        onRemove={() => removeSet(ei, si)}
                        ghost={ghostLine(w.kind, ghost)}
                      />
                    )
                  })}
                  <AddSetButton onClick={() => addSet(ei)} />
                </div>
              </Card>
            </div>
          )
        })}

        {w.kind !== 'cardio' && (
          <Card>
            <div className="flex flex-col gap-3">
              <Field
                label={w.kind === 'speed' ? 'Drill' : 'Exercise'}
                htmlFor={exerciseId}
              >
                <TextInput
                  id={exerciseId}
                  list="exercise-names"
                  value={exerciseName}
                  onChange={(e) => setExerciseName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addExercise()}
                />
                <datalist id="exercise-names">
                  {knownNames.map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
              </Field>
              {typedUnknown && (
                <Field label="Muscle group" htmlFor={muscleId}>
                  <select
                    id={muscleId}
                    className={SELECT_WELL}
                    value={newMuscle}
                    onChange={(e) => setNewMuscle(e.target.value)}
                  >
                    {MUSCLE_GROUPS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Button variant="quiet" block onClick={addExercise}>
                {w.kind === 'speed' ? 'Add drill' : 'Add exercise'}
              </Button>
            </div>
          </Card>
        )}

        <Card>
          <div className="flex flex-col gap-3">
            <Field label="Title" htmlFor={titleId}>
              <TextInput
                id={titleId}
                value={w.title ?? ''}
                onChange={(e) =>
                  setW({ ...w, title: e.target.value || undefined })
                }
              />
            </Field>
            <Field label="Start" htmlFor={startId}>
              <TextInput
                id={startId}
                type="datetime-local"
                value={toLocalInput(w.start)}
                onChange={(e) =>
                  e.target.value &&
                  setW({ ...w, start: new Date(e.target.value).toISOString() })
                }
              />
            </Field>
            <Field label="Notes" htmlFor={notesId}>
              <TextArea
                id={notesId}
                value={w.notes ?? ''}
                onChange={(e) =>
                  setW({ ...w, notes: e.target.value || undefined })
                }
              />
            </Field>
          </div>
        </Card>

        {isNew ? (
          <Button variant="ghost-danger" block onClick={discard}>
            Discard
          </Button>
        ) : (
          onDelete && (
            <Button variant="ghost-danger" block onClick={deleteSaved}>
              Delete
            </Button>
          )
        )}
      </div>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// Start flow: templates, an open workout, a stopwatch, or quick intervals
// ---------------------------------------------------------------------------

function StartPicker({
  templates,
  onStrength,
  onTimer,
  confirmStart,
  onEnter,
  onDeleteTemplate,
  onCancel,
}: {
  templates: Template[]
  /** Set up the session on the click (drafts, lock screen) and hand back
   * the mode that shows it; the mode flips once the sheet has dropped. */
  onStrength: (template?: Template) => Mode
  onTimer: (kind: WorkoutKind, sections: IntervalSection[], title?: string) => Mode
  /** False when a live draft exists and the lifter keeps it. */
  confirmStart: () => boolean
  onEnter: (m: Mode) => void
  onDeleteTemplate: (t: Template) => void
  onCancel: () => void
}) {
  const [plan, setPlan] = useState<QuickIntervalPlan>(DEFAULT_PLAN)
  const [intervalsOpen, setIntervalsOpen] = useState(false)
  const { open, dismiss, onExited } = useSheetDismiss()

  const planSections = useMemo(() => buildIntervals(plan), [plan])

  function start(next: () => Mode, guard = true) {
    if (guard && !confirmStart()) return
    const m = next()
    dismiss(() => onEnter(m))
  }

  function startTemplate(t: Template) {
    if (t.kind === 'strength') {
      // A slot template picks its lifts first; that flow guards the draft.
      start(() => onStrength(t), !hasSlots(t))
    } else if (t.sections) {
      start(() => onTimer(t.kind, t.sections ?? [], t.name), false)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={() => dismiss(onCancel)}
      onExited={onExited}
      title="Start a session"
    >
      <List>
        {templates.map((t) => (
          <ListItem
            key={t.id}
            lead={KIND_LEAD[t.kind].icon}
            leadTone={KIND_LEAD[t.kind].tone}
            title={t.name}
            sub={templateMeta(t)}
            onClick={() => startTemplate(t)}
            action={
              <IconButton
                size="sm"
                label={`Delete template ${t.name}`}
                onClick={() => onDeleteTemplate(t)}
              >
                <IconX className="h-4 w-4" />
              </IconButton>
            }
          />
        ))}
        <ListItem
          key="open"
          lead={<IconPlus />}
          title="Open workout"
          sub="Add exercises as you go"
          onClick={() => start(() => onStrength())}
        />
        <ListItem
          key="stopwatch"
          lead={<IconRun />}
          leadTone="rest"
          title="Stopwatch"
          sub="Log the miles after"
          onClick={() => start(() => onTimer('cardio', []), false)}
        />
        <div key="intervals">
          <ListItem
            lead={<IconSpeed />}
            leadTone="effort"
            title="Intervals"
            sub={`${planSections.length} sections · ${fmtSec(totalSec(planSections))}`}
            chevron={!intervalsOpen}
            onClick={() => setIntervalsOpen((v) => !v)}
          />
          {intervalsOpen && (
            <div className="mx-1 mb-1 flex flex-col gap-3 rounded-md bg-surface-2 p-4">
              <PlanFields plan={plan} onChange={setPlan} summary={false} />
              <Button
                variant="primary"
                block
                onClick={() =>
                  start(() => onTimer('speed', buildIntervals(plan)), false)
                }
              >
                Start
              </Button>
            </div>
          )}
        </div>
      </List>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// Lists: logged training, separated from WHOOP-captured activity
// ---------------------------------------------------------------------------

/** The sub line of a Log row: what the workout held, without the weekday. */
function workoutMeta(w: Workout): string[] {
  const { sets, volume } = workoutVolume(w)
  const parts: string[] = []
  if (w.kind === 'strength' && sets > 0) {
    parts.push(`${w.exercises.length} exercises · ${sets} sets`)
    // Tonnage shows in the row's trail instead
  }
  if (w.intervals && w.intervals.length > 0) {
    parts.push(`${w.intervals.length} intervals`)
  }
  if (w.durationMin != null) parts.push(`${w.durationMin} min`)
  // Distance shows in the trail when there is no tonnage
  if (w.distanceM != null && volume > 0) {
    parts.push(`${Math.round((w.distanceM / MILE) * 100) / 100} mi`)
  }
  return parts
}

/** The trail of a Log row: tonnage, else distance. */
function workoutTrail(w: Workout): string | undefined {
  const { volume } = workoutVolume(w)
  if (volume > 0) return `${Math.round(volume).toLocaleString()} ${w.weightUnit}`
  if (w.distanceM != null) {
    return `${Math.round((w.distanceM / MILE) * 100) / 100} mi`
  }
  return undefined
}

type Mode =
  | { m: 'list' }
  | { m: 'pick' }
  | { m: 'build'; initial?: Template }
  | { m: 'strength'; workout: Workout; isNew: boolean }
  | { m: 'timer'; draft: TimerDraft }
  | { m: 'slots'; template: Template }
  | { m: 'feedback'; workout: Workout }
  | { m: 'meso-setup'; initial?: Mesocycle }

/** Which bottom-nav tab this instance is rendering (Recovery lives in its
 * own component). One Workouts instance persists across all four so live
 * sessions, drafts, and caches survive tab hops. */
export type WorkoutsTab = 'today' | 'history' | 'plan' | 'progress'

export function Workouts({ api, tab }: { api: Api; tab: WorkoutsTab }) {
  const [logFilter, setLogFilter] = useState<LogFilter>('all')
  /** The workout open in the Log's detail sheet. */
  const [detail, setDetail] = useState<Workout | null>(null)
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
  }, [logFilter, tab])

  // Keep the session bus in sync so the dock knows when we're live. Every
  // flow here is a sheet over the tab, so the dock stays (under the scrim)
  // and takes over the moment a session is minimised.
  useEffect(() => {
    setInSession(mode.m === 'strength' || mode.m === 'timer')
    return () => setInSession(false)
  }, [mode])

  // Resume from the dock while already mounted: re-enter the draft —
  // unless the user is mid-way through planning a mesocycle, which a
  // mode swap would silently destroy.
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
   * Strength sessions detour through the how-did-it-feel sheet before the
   * save lands; timer saves and edits go straight through.
   */
  function finish(raw: Workout, opts?: { isNew?: boolean }) {
    if (
      raw.kind === 'strength' &&
      opts?.isNew &&
      feedbackMuscles(raw, muscleLookup).length > 0
    ) {
      // The draft stays (crash-safety) but the session is over — keep the
      // lock-screen widget from re-advertising it while the sheet is up.
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

  /** Delete a saved workout; the editor's sheet closes itself on true. */
  async function remove(w: Workout): Promise<boolean> {
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
      return true
    } catch {
      setError('Deleting needs a connection — try again when online.')
      return false
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

  /** Delete a template; resolves true once it is gone. */
  async function removeTemplate(t: Template): Promise<boolean> {
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
      return true
    } catch {
      setError('Deleting templates needs a connection.')
      return false
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

  /** A minimised live session's draft must not be silently clobbered. */
  function confirmReplaceLive(): boolean {
    return (
      !(loadDraft() || loadTimerDraft()) ||
      window.confirm('A session is already live — discard it and start this one?')
    )
  }

  /** Start the given microcycle day with this week's prescriptions. */
  function startMesoDay(meso: Mesocycle, dayIndex: number) {
    const day = meso.days[dayIndex]
    if (!day) return
    if (!confirmReplaceLive()) return
    const now = Date.now()
    // Overdue mesos clamp to the deload week's (gentle) prescriptions
    const week = Math.min(mesoWeek(meso, now), meso.weeks - 1)

    if (dayKind(day) === 'cardio') {
      // Cardio days run the interval timer (or stopwatch), tagged to the
      // meso so day tracking counts them like any other session.
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
    setMode(beginStrength(w))
  }

  /**
   * Set up a fresh live strength session and hand back the mode that
   * shows it. The draft swap and the lock-screen autoplay run here, on
   * the click's call stack (autoplay needs the gesture); the caller flips
   * the mode — at once, or after a sheet has dropped. The caller has
   * already cleared any live draft with confirmReplaceLive.
   */
  function beginStrength(w: Workout): Mode {
    saveTimerDraft(null)
    autoStartLockScreen()
    return { m: 'strength', workout: w, isNew: true }
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

  function startStrength(template?: Template): Mode {
    if (template && hasSlots(template)) return { m: 'slots', template }
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
    return beginStrength(w)
  }

  function startTimer(
    kind: WorkoutKind,
    sections: IntervalSection[],
    title?: string,
  ): Mode {
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
    return { m: 'timer', draft }
  }

  const toList = () => setMode({ m: 'list' })

  function sessionSheet(m: Extract<Mode, { m: 'strength' }>) {
    const originalStart = m.workout.start
    // Meso sessions carry per-exercise targets anchored to this meso's
    // logged actuals. The session re-runs this as its exercise list
    // changes, so a lift swapped in mid-session is prescribed for too.
    const meso = m.workout.mesoId
      ? mesos.find((x) => x.id === m.workout.mesoId)
      : undefined
    let prescribe: ComponentProps<typeof SessionEditor>['prescribe']
    let mesoSetCount: ComponentProps<typeof SessionEditor>['mesoSetCount']
    if (meso && m.isNew) {
      const week = Math.min(mesoWeek(meso, Date.now()), meso.weeks - 1)
      const dayIdx = m.workout.mesoDayIndex
      const mesoWorkouts = workouts.filter(
        (w) => w.mesoId === meso.id && w.id !== m.workout.id,
      )
      prescribe = (names, setsByName) =>
        prescribeExercises(
          meso,
          names,
          week,
          mesoWorkouts,
          workouts,
          setsByName,
          muscleLookup,
          bodyWeightLb,
          dayIdx,
        )
      mesoSetCount = (name, usedByMuscle) =>
        plannedSetsForExercise(
          meso,
          name,
          week,
          mesoWorkouts,
          workouts,
          muscleLookup(name),
          muscleLookup,
          usedByMuscle,
        )
    }
    return (
      <SessionEditor
        key={m.workout.id}
        initial={m.workout}
        isNew={m.isNew}
        history={workouts}
        customs={customs}
        lookup={muscleLookup}
        bodyWeightLb={bodyWeightLb}
        prescribe={prescribe}
        mesoSetCount={mesoSetCount}
        onSaveCustom={saveCustomExercise}
        onFinish={(w) =>
          finish(
            // An edited start time is a key move — tell the API which old
            // row to drop so the workout doesn't duplicate.
            !m.isNew && w.start !== originalStart
              ? { ...w, previousStart: originalStart }
              : w,
            { isNew: m.isNew },
          )
        }
        onClose={toList}
        onDiscard={toList}
        onDelete={m.isNew ? undefined : remove}
      />
    )
  }

  // ---- tabbed content, with the session sheets over it ----

  let content: ReactNode
  if (tab === 'today') {
    content = (
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
  } else if (tab === 'progress') {
    content = (
      <Suspense
        fallback={
          <p className="py-12 text-center text-body text-ink-3">Loading</p>
        }
      >
        <Trends
          api={api}
          workouts={workouts}
          sessions={sessions}
          lookup={muscleLookup}
          weights={weights}
          onWeightsChange={(next) => {
            setWeights(next)
            saveWeightCache(next)
          }}
        />
      </Suspense>
    )
  } else if (tab === 'plan') {
    content = (
      <div className="flex flex-col gap-3">
        <h1 className="text-title-lg text-ink">Plan</h1>
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
          onEdit={() => {
            const m = activeMeso(mesos)
            if (m) setMode({ m: 'meso-setup', initial: m })
          }}
          onPlan={() => setMode({ m: 'meso-setup' })}
        />
        {error && <Banner tone="error">{error}</Banner>}
        <Manage
          api={api}
          templates={templates}
          customs={customs}
          workouts={workouts}
          onNewTemplate={() => setMode({ m: 'build' })}
          onEditTemplate={(t) => setMode({ m: 'build', initial: t })}
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
  } else {
    // tab === 'history'
    const captured = logFilter === 'captured'
    const shown =
      logFilter === 'all' || captured
        ? workouts
        : workouts.filter((w) => w.kind === logFilter)
    const visible = shown.slice(0, visibleCount)

    // Calendar weeks, Monday first, newest week on top.
    const thisMonday = mondayOf(Date.now())
    const lastMonday = shiftDay(thisMonday, -7)
    const sections: Array<{ monday: string; items: Workout[] }> = []
    for (const w of visible) {
      const monday = mondayOf(new Date(w.start).getTime())
      const last = sections.at(-1)
      if (last && last.monday === monday) last.items.push(w)
      else sections.push({ monday, items: [w] })
    }

    const sortedSessions = captured
      ? sessions.slice().sort((a, b) => b.start.localeCompare(a.start))
      : []
    const visibleSessions = sortedSessions.slice(0, visibleCount)

    content = (
      <div className="flex flex-col gap-3">
        <h1 className="text-title-lg text-ink">Log</h1>
        <Chips
          options={LOG_CHIPS}
          value={logFilter}
          onChange={setLogFilter}
          ariaLabel="Log"
        />

        {offline && (
          <Banner tone="info">
            {pendingCount > 0
              ? `Offline. ${pendingCount} workouts will sync.`
              : 'Offline.'}
          </Banner>
        )}
        {!offline && pendingCount > 0 && (
          <Banner tone="info">{pendingCount} workouts will sync.</Banner>
        )}
        {error && <Banner tone="error">{error}</Banner>}

        {!captured && workouts.length === 0 && (
          <Card>
            <p className="text-title-sm text-ink">No workouts yet</p>
            <p className="mt-1 text-body text-ink-2">Start one from Today.</p>
          </Card>
        )}
        {!captured && workouts.length > 0 && shown.length === 0 && (
          <Card>
            <p className="text-body text-ink-2">Nothing logged.</p>
          </Card>
        )}

        {!captured &&
          sections.map(({ monday, items }) => {
            const minutes = items
              .map(workoutMinutes)
              .filter((m): m is number => m != null)
            const total = minutes.reduce((a, b) => a + b, 0)
            return (
              <section key={monday} className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-3 px-1">
                  <h2 className="text-title-sm text-ink">
                    {monday === thisMonday
                      ? 'This week'
                      : monday === lastMonday
                        ? 'Last week'
                        : fmtDay(monday)}
                  </h2>
                  <span className="text-caption text-ink-3">
                    {items.length} {items.length === 1 ? 'session' : 'sessions'}
                    {minutes.length > 0 && ` · ${total} min`}
                  </span>
                </div>
                <List>
                  {items.map((w) => (
                    <ListItem
                      key={w.id}
                      lead={KIND_LEAD[w.kind].icon}
                      leadTone={KIND_LEAD[w.kind].tone}
                      title={w.title || KIND_LABEL[w.kind]}
                      sub={[
                        new Date(w.start).toLocaleDateString(undefined, {
                          weekday: 'short',
                        }),
                        ...workoutMeta(w),
                      ].join(' · ')}
                      trail={workoutTrail(w)}
                      chevron
                      onClick={() => setDetail(w)}
                    />
                  ))}
                </List>
              </section>
            )
          })}
        {!captured && shown.length > PAGE && (
          <p className="text-center text-caption text-ink-3">
            Showing {visible.length} of {shown.length}
          </p>
        )}
        {!captured && visibleCount < shown.length && (
          <Button
            variant="quiet"
            block
            onClick={() => setVisibleCount((n) => n + PAGE)}
          >
            Show more
          </Button>
        )}

        {captured && sessions.length === 0 && (
          <p className="text-caption text-ink-3">Nothing captured yet.</p>
        )}
        {captured && visibleSessions.length > 0 && (
          <List>
            {visibleSessions.map((s) => {
              const sport = s.sport ?? 'Activity'
              const lifting = sport === 'weightlifting'
              const parts = [fmtDateTime(s.start)]
              if (s.strain != null) {
                parts.push(`strain ${Math.round(s.strain * 10) / 10}`)
              }
              if (s.avgHr != null) parts.push(`${Math.round(s.avgHr)} bpm avg`)
              if (s.maxHr != null) parts.push(`${Math.round(s.maxHr)} max`)
              if (s.distanceM != null) {
                parts.push(`${Math.round((s.distanceM / MILE) * 100) / 100} mi`)
              }
              return (
                <ListItem
                  key={s.sk}
                  lead={lifting ? <IconStrength /> : <IconRun />}
                  leadTone={lifting ? 'brand' : 'rest'}
                  title={sport.charAt(0).toUpperCase() + sport.slice(1)}
                  sub={parts.join(' · ')}
                />
              )
            })}
          </List>
        )}
        {captured && sortedSessions.length > 0 && (
          <p className="text-center text-caption text-ink-3">
            Showing {visibleSessions.length} of {sortedSessions.length}
          </p>
        )}
        {captured && visibleCount < sortedSessions.length && (
          <Button
            variant="quiet"
            block
            onClick={() => setVisibleCount((n) => n + PAGE)}
          >
            Show more
          </Button>
        )}
      </div>
    )
  }

  return (
    <>
      {content}

      {detail && (
        <WorkoutDetail
          key={detail.id}
          workout={detail}
          history={workouts}
          mesos={mesos}
          onClose={() => setDetail(null)}
          onEdit={() => {
            setDetail(null)
            setMode({ m: 'strength', workout: detail, isNew: false })
          }}
          onRepeat={() => {
            setDetail(null)
            // Through beginStrength: guards a live draft like every
            // other session start.
            if (!confirmReplaceLive()) return
            setMode(
              beginStrength({
                ...detail,
                id: crypto.randomUUID(),
                start: new Date().toISOString(),
                end: undefined,
                updatedAt: undefined,
                // Ratings and meso membership belong to the session
                // they came from — a repeat is a plain ad-hoc workout.
                feedback: undefined,
                mesoId: undefined,
                mesoDayIndex: undefined,
                exercises: detail.exercises.map((e) => ({
                  ...e,
                  sets: e.sets.map((s) => ({ ...s, done: false })),
                })),
              }),
            )
          }}
          onDelete={remove}
        />
      )}

      {mode.m === 'strength' && sessionSheet(mode)}

      {mode.m === 'timer' && (
        <IntervalSession
          key={mode.draft.startEpoch}
          initial={mode.draft}
          sessions={sessions}
          onSave={finish}
          onCancel={toList}
          onMinimize={toList}
        />
      )}

      {mode.m === 'feedback' && (
        <FeedbackModal
          muscles={feedbackMuscles(mode.workout, muscleLookup)}
          onSubmit={(fb) => commitFinish({ ...mode.workout, feedback: fb })}
          onSkip={() => commitFinish(mode.workout)}
        />
      )}

      {mode.m === 'pick' && (
        <StartPicker
          templates={templates}
          onStrength={startStrength}
          onTimer={startTimer}
          confirmStart={confirmReplaceLive}
          onEnter={setMode}
          onDeleteTemplate={removeTemplate}
          onCancel={toList}
        />
      )}

      {mode.m === 'slots' && (
        <SlotFill
          key={mode.template.id}
          template={mode.template}
          customs={customs}
          lookup={muscleLookup}
          history={workouts}
          onStart={(entries) => {
            if (!confirmReplaceLive()) return null
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
            // The draft swap and lock-screen autoplay run on the click;
            // the mode flips once the sheet has dropped.
            const next = beginStrength(w)
            return () => setMode(next)
          }}
          onCancel={() => setMode({ m: 'pick' })}
        />
      )}

      {mode.m === 'meso-setup' && (
        <MesoSetup
          key={mode.initial?.id ?? 'new'}
          templates={templates}
          customs={customs}
          lookup={muscleLookup}
          history={workouts}
          initial={mode.initial}
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
          onCancel={toList}
        />
      )}

      {mode.m === 'build' && (
        <TemplateBuilder
          key={mode.initial?.id ?? 'new'}
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
          onDelete={removeTemplate}
          onCancel={toList}
        />
      )}
    </>
  )
}
