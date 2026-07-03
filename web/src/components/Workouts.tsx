import { useEffect, useMemo, useState } from 'react'
import type { Api } from '../lib/api'
import { EXERCISES, SPEED_DRILLS, muscleFor } from '../lib/exercises'
import {
  enqueue,
  finalizeWorkout,
  flushQueue,
  loadDraft,
  loadPending,
  loadWorkoutCache,
  newWorkout,
  saveDraft,
  saveWorkoutCache,
  type SessionRecord,
  type Workout,
  type WorkoutKind,
  type WorkoutSet,
} from '../lib/workouts'
import { buttonClass, Card, inputClass } from './ui'

// 16px font so iOS doesn't zoom on focus; big touch targets for gym thumbs
const setInput =
  'w-full rounded-lg border border-neutral-800 bg-neutral-900 px-1 py-2.5 ' +
  'text-center text-base text-neutral-100 placeholder-neutral-600 outline-none ' +
  'focus:border-teal-500'

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
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
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
// Active workout session (RP-style: check off sets as you go)
// ---------------------------------------------------------------------------

function ActiveWorkout({
  initial,
  isNew,
  history,
  sessions,
  onFinish,
  onCancel,
  onDelete,
}: {
  initial: Workout
  isNew: boolean
  history: Workout[]
  sessions: SessionRecord[]
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
          : {
              ...e,
              sets: [...e.sets, { ...e.sets.at(-1), done: false }],
            },
      ),
    })
  }

  function removeExercise(ei: number) {
    setW({ ...w, exercises: w.exercises.filter((_, i) => i !== ei) })
  }

  const numeric = (raw: string) => (raw === '' ? undefined : Number(raw))

  const linkSuggestions = useMemo(() => {
    if (w.kind !== 'cardio') return []
    const start = new Date(w.start).getTime()
    return sessions.filter(
      (s) => Math.abs(new Date(s.start).getTime() - start) < 4 * 3_600_000,
    )
  }, [w.kind, w.start, sessions])

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

      <div className="flex gap-2">
        {(['strength', 'speed', 'cardio'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setW({ ...w, kind: k })}
            className={`rounded-full px-3 py-1.5 text-sm capitalize ${
              w.kind === k
                ? KIND_STYLE[k]
                : 'text-neutral-500 hover:text-neutral-300'
            }`}
          >
            {k}
          </button>
        ))}
      </div>

      <input
        className={inputClass}
        placeholder={`${w.kind} session title (optional)`}
        value={w.title ?? ''}
        onChange={(e) => setW({ ...w, title: e.target.value || undefined })}
      />

      {w.kind !== 'cardio' &&
        w.exercises.map((e, ei) => {
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
                {w.kind === 'strength' ? (
                  <>
                    <span className="text-center">{w.weightUnit}</span>
                    <span className="text-center">reps</span>
                    <span className="text-center">rpe</span>
                  </>
                ) : (
                  <>
                    <span className="text-center">yd</span>
                    <span className="text-center">sec</span>
                    <span />
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
                    {w.kind === 'strength' ? (
                      <>
                        <input
                          className={setInput}
                          type="number"
                          inputMode="decimal"
                          placeholder={ghost?.weight != null ? String(ghost.weight) : ''}
                          value={s.weight ?? ''}
                          onChange={(ev) =>
                            patchSet(ei, si, { weight: numeric(ev.target.value) })
                          }
                        />
                        <input
                          className={setInput}
                          type="number"
                          inputMode="numeric"
                          placeholder={ghost?.reps != null ? String(ghost.reps) : ''}
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
                    ) : (
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
                            s.distanceM != null
                              ? Math.round(s.distanceM / YD)
                              : ''
                          }
                          onChange={(ev) =>
                            patchSet(ei, si, {
                              distanceM:
                                ev.target.value === ''
                                  ? undefined
                                  : Math.round(Number(ev.target.value) * YD * 100) / 100,
                            })
                          }
                        />
                        <input
                          className={setInput}
                          type="number"
                          inputMode="decimal"
                          placeholder={
                            ghost?.durationSec != null ? String(ghost.durationSec) : ''
                          }
                          value={s.durationSec ?? ''}
                          onChange={(ev) =>
                            patchSet(ei, si, { durationSec: numeric(ev.target.value) })
                          }
                        />
                        <span />
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
          <button
            onClick={addExercise}
            className={`${buttonClass} w-auto shrink-0 px-4`}
          >
            Add
          </button>
        </div>
      )}

      {w.kind === 'cardio' && (
        <>
          <div className="flex gap-2">
            <input
              className={inputClass}
              type="number"
              inputMode="numeric"
              placeholder="duration (min)"
              value={w.durationMin ?? ''}
              onChange={(e) =>
                setW({ ...w, durationMin: numeric(e.target.value) })
              }
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
          {linkSuggestions.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs text-neutral-500">
                Attach WHOOP heart-rate data:
              </p>
              {linkSuggestions.map((s) => (
                <button
                  key={s.sk}
                  onClick={() =>
                    setW({
                      ...w,
                      linkedSessionSk:
                        w.linkedSessionSk === s.sk ? undefined : s.sk,
                    })
                  }
                  className={`rounded-lg border px-3 py-2.5 text-left text-xs ${
                    w.linkedSessionSk === s.sk
                      ? 'border-teal-500/60 bg-teal-500/10 text-teal-200'
                      : 'border-neutral-800 text-neutral-400 hover:border-neutral-600'
                  }`}
                >
                  {s.sport ?? 'activity'} · {fmtDateTime(s.start)}
                  {s.strain != null && ` · strain ${Math.round(s.strain * 10) / 10}`}
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
        value={w.notes ?? ''}
        onChange={(e) => setW({ ...w, notes: e.target.value || undefined })}
      />

      <div className="fixed inset-x-0 bottom-0 border-t border-neutral-800/80 bg-neutral-950/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <button
            onClick={() =>
              onFinish({
                ...w,
                end: isNew ? new Date().toISOString() : w.end,
              })
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
        {workout.kind === 'strength' &&
          sets > 0 &&
          ` · ${workout.exercises.length} exercises · ${sets} sets` +
            (volume > 0 ? ` · ${Math.round(volume).toLocaleString()} ${workout.weightUnit}` : '')}
        {workout.kind === 'cardio' &&
          [
            workout.durationMin != null && `${workout.durationMin} min`,
            workout.distanceM != null &&
              `${Math.round((workout.distanceM / MILE) * 100) / 100} mi`,
            workout.linkedSessionSk && 'WHOOP linked',
          ]
            .filter(Boolean)
            .map((part) => ` · ${part}`)
            .join('')}
      </p>
      <div className="flex flex-col gap-0.5 text-sm text-neutral-400">
        {workout.exercises.slice(0, 4).map((e, i) => (
          <p key={i} className="truncate">
            <span className="text-neutral-200">{e.name}</span>{' '}
            <span className="text-neutral-500">
              {e.sets
                .map((s) => prevSummary(workout.kind, s) ?? '—')
                .join(', ')}
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
        <button onClick={onRepeat} className="text-teal-400 hover:text-teal-300">
          Repeat
        </button>
      </div>
    </div>
  )
}

export function Workouts({ api }: { api: Api }) {
  const [segment, setSegment] = useState<'training' | 'whoop'>('training')
  const [workouts, setWorkouts] = useState<Workout[]>(loadWorkoutCache)
  const [sessions, setSessions] = useState<SessionRecord[]>([])
  const [active, setActive] = useState<Workout | null>(loadDraft)
  const [isNew, setIsNew] = useState(() => loadDraft() !== null)
  const [pendingCount, setPendingCount] = useState(() => loadPending().length)
  const [offline, setOffline] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    try {
      const [wRes, sRes] = await Promise.all([
        api.get('/api/workouts?days=180'),
        api.get('/api/sessions?days=180'),
      ])
      if (wRes.ok) {
        const body = await wRes.json()
        setWorkouts(body.workouts)
        saveWorkoutCache(body.workouts)
      }
      if (sRes.ok) setSessions((await sRes.json()).sessions)
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
    setActive(null)
    void sync()
  }

  function cancelActive() {
    if (
      isNew &&
      active &&
      active.exercises.length > 0 &&
      !window.confirm('Discard this workout?')
    ) {
      return
    }
    saveDraft(null)
    setActive(null)
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
      setActive(null)
    } catch {
      setError('Deleting needs a connection — try again when online.')
    }
  }

  if (active) {
    return (
      <ActiveWorkout
        initial={active}
        isNew={isNew}
        history={workouts}
        sessions={sessions}
        onFinish={finish}
        onCancel={cancelActive}
        onDelete={isNew ? undefined : remove}
      />
    )
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-base font-medium text-neutral-300">Workouts</h1>
        <button
          onClick={() => {
            setActive(newWorkout('strength'))
            setIsNew(true)
          }}
          className={`${buttonClass} w-auto px-4`}
        >
          Start workout
        </button>
      </div>

      <div className="flex w-full rounded-full border border-neutral-800 p-0.5 text-sm">
        {(['training', 'whoop'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSegment(s)}
            className={`flex-1 rounded-full py-1.5 ${
              segment === s
                ? 'bg-neutral-800 text-neutral-100'
                : 'text-neutral-500 hover:text-neutral-300'
            }`}
          >
            {s === 'training' ? 'My training' : 'WHOOP activity'}
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

      {segment === 'training' && (
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
              onEdit={() => {
                setActive(w)
                setIsNew(false)
              }}
              onRepeat={() => {
                setActive({
                  ...w,
                  id: crypto.randomUUID(),
                  start: new Date().toISOString(),
                  end: undefined,
                  updatedAt: undefined,
                  exercises: w.exercises.map((e) => ({
                    ...e,
                    sets: e.sets.map((s) => ({ ...s, done: false })),
                  })),
                })
                setIsNew(true)
              }}
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
