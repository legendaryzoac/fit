import { useEffect, useMemo, useState } from 'react'
import type { Api } from '../lib/api'
import { EXERCISES, SPEED_DRILLS, muscleFor } from '../lib/exercises'
import {
  buildIntervals,
  DEFAULT_PLAN,
  fmtSec,
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
import { Analytics } from './Analytics'
import { IntervalSession } from './IntervalTimer'
import { PlanFields, TemplateBuilder } from './TemplateBuilder'
import { buttonClass, Card, inputClass } from './ui'

// 16px font so iOS doesn't zoom on focus; big touch targets for gym thumbs
const setInput =
  'w-full rounded-lg border border-neutral-800 bg-neutral-900 px-1 py-2.5 ' +
  'text-center text-base text-neutral-100 placeholder-neutral-600 outline-none ' +
  'focus:border-teal-500'

const secondaryButton =
  'rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-300 ' +
  'hover:border-neutral-500'

const YD = 0.9144
const MILE = 1609.34

const KIND_STYLE: Record<WorkoutKind, string> = {
  strength: 'bg-teal-500/15 text-teal-300',
  speed: 'bg-violet-500/15 text-violet-300',
  cardio: 'bg-sky-500/15 text-sky-300',
}

function KindPill({ kind }: { kind: WorkoutKind }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${KIND_STYLE[kind]}`}
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
  onFinish,
  onCancel,
  onDelete,
}: {
  initial: Workout
  isNew: boolean
  history: Workout[]
  onFinish: (w: Workout) => void
  onCancel: () => void
  onDelete?: (w: Workout) => void
}) {
  const [w, setW] = useState<Workout>(initial)
  const [exerciseName, setExerciseName] = useState('')
  const [now, setNow] = useState(Date.now())

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
    for (const past of history) {
      if (past.kind !== w.kind) continue
      for (const e of past.exercises) names.add(e.name)
    }
    return [...names].sort()
  }, [history, w.kind])

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
    // Checking an empty row adopts last time's numbers — RP-style "same again"
    patchSet(ei, si, {
      done: true,
      weight: current.weight ?? prev?.weight,
      reps: current.reps ?? prev?.reps,
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

  const numeric = (raw: string) => (raw === '' ? undefined : Number(raw))

  const doneCount = w.exercises.reduce(
    (n, e) => n + e.sets.filter((s) => s.done).length,
    0,
  )
  const totalCount = w.exercises.reduce((n, e) => n + e.sets.length, 0)

  return (
    <div className="flex flex-col gap-4 pb-24">
      <div className="flex items-center justify-between">
        <button
          onClick={onCancel}
          className="text-sm text-neutral-500 hover:text-neutral-300"
        >
          ← Back
        </button>
        {isNew && (
          <span className="font-mono text-sm tabular-nums text-teal-300">
            {fmtElapsed(now - new Date(w.start).getTime())}
          </span>
        )}
        {totalCount > 0 && (
          <span className="text-xs text-neutral-500">
            {doneCount}/{totalCount} sets
          </span>
        )}
      </div>

      <input
        className={inputClass}
        placeholder="session title (optional)"
        value={w.title ?? ''}
        onChange={(e) => setW({ ...w, title: e.target.value || undefined })}
      />

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
        const muscle = muscleFor(e.name)
        return (
          <div
            key={ei}
            className="rounded-xl border border-neutral-800/60 bg-neutral-900/60 p-3"
          >
            <div className="mb-2 flex items-baseline justify-between">
              <p className="text-sm font-semibold text-neutral-100">
                {e.name}
                {muscle && (
                  <span className="ml-2 text-[11px] font-normal uppercase tracking-wide text-neutral-600">
                    {muscle}
                  </span>
                )}
              </p>
              <button
                onClick={() => removeExercise(ei)}
                className="text-xs text-neutral-600 hover:text-red-400"
              >
                remove
              </button>
            </div>

            <div className="mb-1 grid grid-cols-[1.5rem_3.2rem_1fr_1fr_2.6rem_2.4rem] items-center gap-1.5 text-[11px] uppercase tracking-wide text-neutral-600">
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
            </div>

            {e.sets.map((s, si) => {
              const ghost = prev[si] ?? prev.at(-1)
              return (
                <div
                  key={si}
                  className="mb-1.5 grid grid-cols-[1.5rem_3.2rem_1fr_1fr_2.6rem_2.4rem] items-center gap-1.5"
                >
                  <span className="text-sm text-neutral-500">{si + 1}</span>
                  <span className="truncate text-[11px] text-neutral-600">
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
                          ghost?.weight != null ? String(ghost.weight) : ''
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
                          ghost?.reps != null ? String(ghost.reps) : ''
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
                        placeholder="rpe"
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
                    className={`flex h-10 items-center justify-center rounded-lg border text-sm font-bold ${
                      s.done
                        ? 'border-teal-500 bg-teal-500 text-neutral-950'
                        : 'border-neutral-700 text-neutral-600 hover:border-teal-500/60'
                    }`}
                  >
                    ✓
                  </button>
                </div>
              )
            })}

            <button
              onClick={() => addSet(ei)}
              className="mt-1 text-xs font-medium text-teal-400 hover:text-teal-300"
            >
              + add set
            </button>
          </div>
        )
      })}

      {w.kind !== 'cardio' && (
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
      )}

      <textarea
        className={`${inputClass} min-h-16`}
        placeholder="notes (optional)"
        value={w.notes ?? ''}
        onChange={(e) => setW({ ...w, notes: e.target.value || undefined })}
      />

      <div className="fixed inset-x-0 bottom-0 border-t border-neutral-800/80 bg-neutral-950/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <button
            onClick={() =>
              onFinish({ ...w, end: isNew ? new Date().toISOString() : w.end })
            }
            className={`${buttonClass} flex-1`}
          >
            {isNew ? 'Finish workout' : 'Save changes'}
          </button>
          {onDelete && (
            <button
              onClick={() => onDelete(w)}
              className="text-sm text-red-400/80 hover:text-red-400"
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
        <h1 className="text-base font-medium text-neutral-300">
          {kind === null ? 'What are you training?' : `Start ${kind}`}
        </h1>
        <button
          onClick={() => (kind === null ? onCancel() : setKind(null))}
          className="text-sm text-neutral-500 hover:text-neutral-300"
        >
          {kind === null ? 'Cancel' : '← Back'}
        </button>
      </div>

      {kind === null &&
        (['strength', 'speed', 'cardio'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className="rounded-xl border border-neutral-800/60 bg-neutral-900/60 p-4 text-left hover:border-neutral-600"
          >
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${KIND_STYLE[k]}`}
            >
              {k}
            </span>
            <p className="mt-1.5 text-sm text-neutral-400">{KIND_BLURB[k]}</p>
          </button>
        ))}

      {kind !== null && (
        <>
          {matching.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-2 rounded-xl border border-neutral-800/60 bg-neutral-900/60 p-3"
            >
              <button
                onClick={() => startTemplate(t)}
                className="flex-1 text-left"
              >
                <p className="text-sm font-semibold text-neutral-100">
                  {t.name}
                </p>
                <p className="text-xs text-neutral-500">{templateMeta(t)}</p>
              </button>
              <button
                onClick={() => onDeleteTemplate(t)}
                className="px-2 text-neutral-600 hover:text-red-400"
                aria-label={`delete template ${t.name}`}
              >
                ✕
              </button>
            </div>
          ))}
          {matching.length === 0 && (
            <p className="text-sm text-neutral-600">
              No {kind} templates yet — “Create workout” builds one.
            </p>
          )}

          {kind === 'strength' ? (
            <button onClick={() => onStrength()} className={`${buttonClass} w-full`}>
              Blank strength session
            </button>
          ) : showCustom ? (
            <div className="flex flex-col gap-3 rounded-xl border border-neutral-800/60 bg-neutral-900/60 p-3">
              <PlanFields plan={plan} onChange={setPlan} />
              <button
                onClick={() => onTimer(kind, buildIntervals(plan))}
                className={`${buttonClass} w-full`}
              >
                Start timer
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
    <div className="rounded-xl border border-neutral-800/60 bg-neutral-900/60 p-4">
      <div className="mb-1 flex items-center gap-2">
        <KindPill kind={workout.kind} />
        <p className="text-sm font-semibold text-neutral-100">
          {workout.title ??
            `${workout.kind[0].toUpperCase()}${workout.kind.slice(1)} session`}
        </p>
      </div>
      <p className="mb-2 text-xs text-neutral-500">
        {fmtDateTime(workout.start)}
        {metaParts.map((part) => ` · ${part}`).join('')}
      </p>
      <div className="flex flex-col gap-0.5 text-sm text-neutral-400">
        {workout.exercises.slice(0, 4).map((e, i) => (
          <p key={i} className="truncate">
            <span className="text-neutral-200">{e.name}</span>{' '}
            <span className="text-neutral-500">
              {e.sets.map((s) => prevSummary(workout.kind, s) ?? '—').join(', ')}
            </span>
          </p>
        ))}
        {workout.exercises.length > 4 && (
          <p className="text-xs text-neutral-600">
            +{workout.exercises.length - 4} more
          </p>
        )}
        {workout.notes && (
          <p className="text-xs text-neutral-500">{workout.notes}</p>
        )}
      </div>
      <div className="mt-2 flex gap-4 text-xs font-medium">
        <button onClick={onEdit} className="text-teal-400 hover:text-teal-300">
          Edit
        </button>
        {workout.kind === 'strength' && (
          <button
            onClick={onRepeat}
            className="text-teal-400 hover:text-teal-300"
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
  | { m: 'build' }
  | { m: 'strength'; workout: Workout; isNew: boolean }
  | { m: 'timer'; draft: TimerDraft }

export function Workouts({ api }: { api: Api }) {
  const [segment, setSegment] = useState<'workouts' | 'analytics' | 'whoop'>(
    'workouts',
  )
  const [workouts, setWorkouts] = useState<Workout[]>(loadWorkoutCache)
  const [sessions, setSessions] = useState<SessionRecord[]>([])
  const [templates, setTemplates] = useState<Template[]>(loadTemplateCache)
  const [pendingCount, setPendingCount] = useState(() => loadPending().length)
  const [offline, setOffline] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>(() => {
    const timer = loadTimerDraft()
    if (timer) return { m: 'timer', draft: timer }
    const draft = loadDraft()
    if (draft) return { m: 'strength', workout: draft, isNew: true }
    return { m: 'list' }
  })

  async function refresh() {
    try {
      const [wRes, sRes, tRes] = await Promise.all([
        api.get('/api/workouts?days=365'),
        api.get('/api/sessions?days=365'),
        api.get('/api/templates'),
      ])
      if (wRes.ok) {
        const body = await wRes.json()
        setWorkouts(body.workouts)
        saveWorkoutCache(body.workouts)
      }
      if (sRes.ok) setSessions((await sRes.json()).sessions)
      if (tRes.ok) {
        const body = await tRes.json()
        setTemplates(body.templates)
        saveTemplateCache(body.templates)
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

  function finish(raw: Workout) {
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

  function startStrength(template?: Template) {
    const w = newWorkout('strength')
    if (template) {
      w.title = template.name
      w.exercises = (template.exercises ?? []).map((e) => ({
        name: e.name,
        sets: Array.from({ length: e.setCount }, () => ({})),
      }))
    }
    setMode({ m: 'strength', workout: w, isNew: true })
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
    return (
      <ActiveWorkout
        initial={mode.workout}
        isNew={mode.isNew}
        history={workouts}
        onFinish={finish}
        onCancel={() => cancelStrength(mode.workout, mode.isNew)}
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
        onSaved={(t) => {
          setTemplates((prev) => {
            const next = [...prev.filter((x) => x.id !== t.id), t]
            saveTemplateCache(next)
            return next
          })
          setMode({ m: 'pick' })
        }}
        onCancel={() => setMode({ m: 'list' })}
      />
    )
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-base font-medium text-neutral-300">Training</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setMode({ m: 'build' })}
            className={secondaryButton}
          >
            Create workout
          </button>
          <button onClick={() => setMode({ m: 'pick' })} className={buttonClass}>
            Start workout
          </button>
        </div>
      </div>

      <div className="flex w-full rounded-full border border-neutral-800 p-0.5 text-sm">
        {(
          [
            ['workouts', 'Workouts'],
            ['analytics', 'Analytics'],
            ['whoop', 'WHOOP'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setSegment(value)}
            className={`flex-1 rounded-full py-1.5 ${
              segment === value
                ? 'bg-neutral-800 text-neutral-100'
                : 'text-neutral-500 hover:text-neutral-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {offline && (
        <p className="text-sm text-amber-400/90">
          Offline — showing cached workouts.
          {pendingCount > 0 && ` ${pendingCount} pending sync.`}
        </p>
      )}
      {!offline && pendingCount > 0 && (
        <p className="text-sm text-amber-400/90">
          {pendingCount} workout(s) pending sync…
        </p>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {segment === 'analytics' && (
        <Analytics api={api} workouts={workouts} sessions={sessions} />
      )}

      {segment === 'workouts' && (
        <div className="flex flex-col gap-3">
          {workouts.length === 0 && (
            <p className="py-8 text-center text-sm text-neutral-600">
              Nothing logged yet — hit “Start workout” at the gym.
            </p>
          )}
          {workouts.map((w) => (
            <WorkoutCard
              key={w.id}
              workout={w}
              onEdit={() => setMode({ m: 'strength', workout: w, isNew: false })}
              onRepeat={() =>
                setMode({
                  m: 'strength',
                  isNew: true,
                  workout: {
                    ...w,
                    id: crypto.randomUUID(),
                    start: new Date().toISOString(),
                    end: undefined,
                    updatedAt: undefined,
                    exercises: w.exercises.map((e) => ({
                      ...e,
                      sets: e.sets.map((s) => ({ ...s, done: false })),
                    })),
                  },
                })
              }
            />
          ))}
        </div>
      )}

      {segment === 'whoop' && (
        <div className="flex flex-col gap-3">
          {sessions.length === 0 && (
            <p className="py-8 text-center text-sm text-neutral-600">
              No WHOOP-detected activity in the last 180 days.
            </p>
          )}
          {sessions
            .slice()
            .sort((a, b) => b.start.localeCompare(a.start))
            .slice(0, 60)
            .map((s) => (
              <Card
                key={s.sk}
                title={s.sport ?? 'Activity'}
                subtitle={fmtDateTime(s.start)}
              >
                <p className="text-sm text-neutral-400">
                  {s.strain != null && `strain ${Math.round(s.strain * 10) / 10}`}
                  {s.avgHr != null && ` · ${Math.round(s.avgHr)} bpm avg`}
                  {s.maxHr != null && ` · ${Math.round(s.maxHr)} max`}
                  {s.distanceM != null &&
                    ` · ${Math.round((s.distanceM / MILE) * 100) / 100} mi`}
                </p>
              </Card>
            ))}
        </div>
      )}
    </>
  )
}
