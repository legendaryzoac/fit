import { useEffect, useMemo, useState } from 'react'
import type { Api } from '../lib/api'
import { EXERCISES } from '../lib/exercises'
import {
  enqueue,
  flushQueue,
  loadPending,
  loadWorkoutCache,
  newWorkout,
  saveWorkoutCache,
  type SessionRecord,
  type Workout,
  type WorkoutSet,
} from '../lib/workouts'
import { buttonClass, Card, inputClass } from './ui'

const smallInput = `${inputClass} px-2 py-1 text-center`

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function setSummary(sets: WorkoutSet[]): string {
  return sets
    .map((s) =>
      s.weight != null && s.reps != null
        ? `${s.weight}×${s.reps}`
        : s.reps != null
          ? `×${s.reps}`
          : '—',
    )
    .join(', ')
}

function toLocalInput(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function Editor({
  initial,
  sessions,
  history,
  onSave,
  onCancel,
  onDelete,
}: {
  initial: Workout
  sessions: SessionRecord[]
  history: Workout[]
  onSave: (w: Workout) => void
  onCancel: () => void
  onDelete?: (w: Workout) => void
}) {
  const [w, setW] = useState<Workout>(initial)
  const [exerciseName, setExerciseName] = useState('')

  const knownNames = useMemo(() => {
    const names = new Set(EXERCISES.map((e) => e.name))
    for (const past of history) {
      for (const e of past.exercises) names.add(e.name)
    }
    return [...names].sort()
  }, [history])

  // Prefill new exercises from the most recent workout containing them
  function autofillSets(name: string): WorkoutSet[] {
    for (const past of history) {
      const match = past.exercises.find(
        (e) => e.name.toLowerCase() === name.toLowerCase(),
      )
      if (match && match.sets.length > 0) {
        return match.sets.map((s) => ({ weight: s.weight, reps: s.reps }))
      }
    }
    return [{}]
  }

  function addExercise() {
    const name = exerciseName.trim()
    if (!name) return
    setW({
      ...w,
      exercises: [...w.exercises, { name, sets: autofillSets(name) }],
    })
    setExerciseName('')
  }

  function patchSet(
    ei: number,
    si: number,
    field: keyof WorkoutSet,
    raw: string,
  ) {
    const value = raw === '' ? undefined : Number(raw)
    setW({
      ...w,
      exercises: w.exercises.map((e, i) =>
        i !== ei
          ? e
          : {
              ...e,
              sets: e.sets.map((s, j) =>
                j !== si ? s : { ...s, [field]: value },
              ),
            },
      ),
    })
  }

  function addSet(ei: number) {
    setW({
      ...w,
      exercises: w.exercises.map((e, i) =>
        i !== ei ? e : { ...e, sets: [...e.sets, { ...e.sets.at(-1) }] },
      ),
    })
  }

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

  const suggestions = useMemo(() => {
    if (w.kind !== 'cardio') return []
    const start = new Date(w.start).getTime()
    return sessions.filter((s) => {
      const t = new Date(s.start).getTime()
      return Math.abs(t - start) < 4 * 3_600_000
    })
  }, [w.kind, w.start, sessions])

  return (
    <Card title={onDelete ? 'Edit workout' : 'Log workout'}>
      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          {(['strength', 'cardio'] as const).map((k) => (
            <button
              key={k}
              onClick={() => setW({ ...w, kind: k })}
              className={`rounded-full px-3 py-1 text-xs ${
                w.kind === k
                  ? 'bg-teal-500/15 text-teal-300'
                  : 'text-neutral-500 hover:text-neutral-300'
              }`}
            >
              {k}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            className={inputClass}
            placeholder="title (optional)"
            value={w.title ?? ''}
            onChange={(e) =>
              setW({ ...w, title: e.target.value || undefined })
            }
          />
          <input
            className={inputClass}
            type="datetime-local"
            value={toLocalInput(w.start)}
            onChange={(e) =>
              e.target.value &&
              setW({ ...w, start: new Date(e.target.value).toISOString() })
            }
          />
        </div>

        {w.kind === 'strength' && (
          <>
            {w.exercises.map((e, ei) => (
              <div
                key={ei}
                className="rounded-lg border border-neutral-800 p-3"
              >
                <p className="mb-2 text-sm font-medium text-neutral-200">
                  {e.name}
                </p>
                <div className="mb-1 grid grid-cols-[1fr_1fr_1fr_2rem] gap-2 text-xs text-neutral-500">
                  <span>{w.weightUnit}</span>
                  <span>reps</span>
                  <span>RPE</span>
                  <span />
                </div>
                {e.sets.map((s, si) => (
                  <div
                    key={si}
                    className="mb-1 grid grid-cols-[1fr_1fr_1fr_2rem] gap-2"
                  >
                    <input
                      className={smallInput}
                      type="number"
                      inputMode="decimal"
                      value={s.weight ?? ''}
                      onChange={(ev) => patchSet(ei, si, 'weight', ev.target.value)}
                    />
                    <input
                      className={smallInput}
                      type="number"
                      inputMode="numeric"
                      value={s.reps ?? ''}
                      onChange={(ev) => patchSet(ei, si, 'reps', ev.target.value)}
                    />
                    <input
                      className={smallInput}
                      type="number"
                      inputMode="decimal"
                      value={s.rpe ?? ''}
                      onChange={(ev) => patchSet(ei, si, 'rpe', ev.target.value)}
                    />
                    <button
                      onClick={() => removeSet(ei, si)}
                      className="text-neutral-600 hover:text-red-400"
                      aria-label="remove set"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => addSet(ei)}
                  className="mt-1 text-xs text-teal-400 hover:text-teal-300"
                >
                  + add set
                </button>
              </div>
            ))}
            <div className="flex gap-2">
              <input
                className={inputClass}
                list="exercise-names"
                placeholder="add exercise…"
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
          </>
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
                  setW({
                    ...w,
                    durationMin: e.target.value ? Number(e.target.value) : undefined,
                  })
                }
              />
              <input
                className={inputClass}
                type="number"
                inputMode="decimal"
                placeholder="distance (miles)"
                value={
                  w.distanceM != null
                    ? Math.round((w.distanceM / 1609.34) * 100) / 100
                    : ''
                }
                onChange={(e) =>
                  setW({
                    ...w,
                    distanceM: e.target.value
                      ? Math.round(Number(e.target.value) * 1609.34)
                      : undefined,
                  })
                }
              />
            </div>
            {suggestions.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-xs text-neutral-500">
                  Link a WHOOP-detected session:
                </p>
                {suggestions.map((s) => (
                  <button
                    key={s.sk}
                    onClick={() =>
                      setW({
                        ...w,
                        linkedSessionSk:
                          w.linkedSessionSk === s.sk ? undefined : s.sk,
                      })
                    }
                    className={`rounded-lg border px-3 py-2 text-left text-xs ${
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

        <div className="flex items-center gap-3">
          <button onClick={() => onSave(w)} className={`${buttonClass} w-auto px-6`}>
            Save
          </button>
          <button
            onClick={onCancel}
            className="text-sm text-neutral-500 hover:text-neutral-300"
          >
            Cancel
          </button>
          {onDelete && (
            <button
              onClick={() => onDelete(w)}
              className="ml-auto text-sm text-red-400/80 hover:text-red-400"
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </Card>
  )
}

type TimelineEntry =
  | { at: string; kind: 'logged'; workout: Workout }
  | { at: string; kind: 'auto'; session: SessionRecord }

export function Workouts({ api }: { api: Api }) {
  const [workouts, setWorkouts] = useState<Workout[]>(loadWorkoutCache)
  const [sessions, setSessions] = useState<SessionRecord[]>([])
  const [editing, setEditing] = useState<Workout | null>(null)
  const [isNew, setIsNew] = useState(false)
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

  function save(w: Workout) {
    // Local-first: queue + optimistic render, then try the network
    enqueue(w)
    setPendingCount(loadPending().length)
    setWorkouts((prev) => {
      const merged = [w, ...prev.filter((x) => x.id !== w.id)].sort((a, b) =>
        b.start.localeCompare(a.start),
      )
      saveWorkoutCache(merged)
      return merged
    })
    setEditing(null)
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
      setEditing(null)
    } catch {
      setError('Deleting needs a connection — try again when online.')
    }
  }

  function repeat(w: Workout) {
    setEditing({
      ...w,
      id: crypto.randomUUID(),
      start: new Date().toISOString(),
      updatedAt: undefined,
    })
    setIsNew(true)
  }

  const timeline: TimelineEntry[] = useMemo(() => {
    const linked = new Set(
      workouts.flatMap((w) => (w.linkedSessionSk ? [w.linkedSessionSk] : [])),
    )
    const entries: TimelineEntry[] = [
      ...workouts.map((w) => ({ at: w.start, kind: 'logged' as const, workout: w })),
      ...sessions
        .filter((s) => !linked.has(s.sk))
        .map((s) => ({ at: s.start, kind: 'auto' as const, session: s })),
    ]
    return entries.sort((a, b) => b.at.localeCompare(a.at))
  }, [workouts, sessions])

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-base font-medium text-neutral-300">Workouts</h1>
        {!editing && (
          <button
            onClick={() => {
              setEditing(newWorkout('strength'))
              setIsNew(true)
            }}
            className={`${buttonClass} w-auto px-4`}
          >
            Log workout
          </button>
        )}
      </div>

      {offline && (
        <p className="text-sm text-amber-400/90">
          Offline — showing cached workouts.
          {pendingCount > 0 && ` ${pendingCount} pending sync.`}
        </p>
      )}
      {!offline && pendingCount > 0 && (
        <p className="text-sm text-amber-400/90">{pendingCount} workout(s) pending sync…</p>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {editing && (
        <Editor
          initial={editing}
          sessions={sessions}
          history={workouts}
          onSave={save}
          onCancel={() => setEditing(null)}
          onDelete={isNew ? undefined : remove}
        />
      )}

      {timeline.length === 0 && !editing && (
        <p className="py-8 text-center text-sm text-neutral-600">
          Nothing logged yet — hit “Log workout” at the gym.
        </p>
      )}

      <div className="flex flex-col gap-3">
        {timeline.slice(0, 60).map((entry) =>
          entry.kind === 'logged' ? (
            <Card
              key={entry.workout.id}
              title={
                entry.workout.title ??
                (entry.workout.kind === 'strength' ? 'Strength' : 'Cardio')
              }
              subtitle={fmtDateTime(entry.workout.start)}
            >
              <div className="flex flex-col gap-1 text-sm text-neutral-400">
                {entry.workout.exercises.map((e, i) => (
                  <p key={i}>
                    <span className="text-neutral-200">{e.name}</span>{' '}
                    {setSummary(e.sets)}
                  </p>
                ))}
                {entry.workout.kind === 'cardio' && (
                  <p>
                    {entry.workout.durationMin != null &&
                      `${entry.workout.durationMin} min`}
                    {entry.workout.distanceM != null &&
                      ` · ${Math.round((entry.workout.distanceM / 1609.34) * 100) / 100} mi`}
                    {entry.workout.linkedSessionSk && ' · linked to WHOOP'}
                  </p>
                )}
                {entry.workout.notes && (
                  <p className="text-xs text-neutral-500">{entry.workout.notes}</p>
                )}
                <div className="mt-1 flex gap-3 text-xs">
                  <button
                    onClick={() => {
                      setEditing(entry.workout)
                      setIsNew(false)
                    }}
                    className="text-teal-400 hover:text-teal-300"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => repeat(entry.workout)}
                    className="text-teal-400 hover:text-teal-300"
                  >
                    Repeat
                  </button>
                </div>
              </div>
            </Card>
          ) : (
            <Card
              key={entry.session.sk}
              title={`${entry.session.sport ?? 'Activity'} · WHOOP`}
              subtitle={fmtDateTime(entry.session.start)}
            >
              <p className="text-sm text-neutral-400">
                {entry.session.strain != null &&
                  `strain ${Math.round(entry.session.strain * 10) / 10}`}
                {entry.session.avgHr != null &&
                  ` · ${Math.round(entry.session.avgHr)} bpm avg`}
                {entry.session.maxHr != null &&
                  ` · ${Math.round(entry.session.maxHr)} max`}
                {entry.session.distanceM != null &&
                  ` · ${Math.round((entry.session.distanceM / 1609.34) * 100) / 100} mi`}
              </p>
            </Card>
          ),
        )}
      </div>
    </>
  )
}
