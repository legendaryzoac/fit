import { useState } from 'react'
import type { Api } from '../lib/api'
import { MUSCLE_GROUPS, type CustomExercise } from '../lib/exercises'
import { fmtSec, totalSec, type Template } from '../lib/templates'
import type { Workout, WorkoutKind } from '../lib/workouts'
import { KIND_STYLE } from './TemplateBuilder'
import { buttonClass, inputClass } from './ui'

const secondaryButton =
  'rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-300 ' +
  'hover:border-neutral-500'

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

export function Manage({
  api,
  templates,
  customs,
  workouts,
  onNewTemplate,
  onEditTemplate,
  onDeleteTemplate,
  onCustomsChange,
  onTemplatesChange,
  onWorkoutsChange,
  onClose,
}: {
  api: Api
  templates: Template[]
  customs: CustomExercise[]
  workouts: Workout[]
  onNewTemplate: () => void
  onEditTemplate: (t: Template) => void
  onDeleteTemplate: (t: Template) => void
  onCustomsChange: (next: CustomExercise[]) => void
  onTemplatesChange: (next: Template[]) => void
  onWorkoutsChange: (next: Workout[]) => void
  onClose: () => void
}) {
  const [editing, setEditing] = useState<CustomExercise | null>(null)
  const [editName, setEditName] = useState('')
  const [editMuscle, setEditMuscle] = useState('other')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const matches = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

  const affectedCount =
    editing && editName.trim() && !matches(editName, editing.name)
      ? workouts.filter((w) =>
          w.exercises.some((e) => matches(e.name, editing.name)),
        ).length
      : 0

  function startEdit(exercise: CustomExercise) {
    setEditing(exercise)
    setEditName(exercise.name)
    setEditMuscle(exercise.muscle)
    setError(null)
  }

  async function saveExercise() {
    if (!editing) return
    const nextName = editName.trim()
    if (!nextName) {
      setError('Exercise needs a name.')
      return
    }
    const next: CustomExercise = { name: nextName, muscle: editMuscle }
    setBusy(true)
    setError(null)
    try {
      const res = await api.send('POST', '/api/exercises', next)
      if (!res.ok) throw new Error(`API responded ${res.status}`)

      const renamed = !matches(nextName, editing.name)
      if (renamed) {
        await api.send(
          'DELETE',
          `/api/exercises?name=${encodeURIComponent(editing.name)}`,
        )

        // Propagate the rename through logged history so ghosts, PRs, and
        // e1RM trends stay on one line instead of splitting on the typo.
        // Workout upserts are idempotent (same id + start = same row).
        const renameIn = (w: Workout): Workout => ({
          ...w,
          exercises: w.exercises.map((e) =>
            matches(e.name, editing.name) ? { ...e, name: nextName } : e,
          ),
        })
        const updatedWorkouts: Workout[] = []
        for (const w of workouts) {
          if (w.exercises.some((e) => matches(e.name, editing.name))) {
            const updated = renameIn(w)
            const wRes = await api.send('POST', '/api/workouts', updated)
            if (!wRes.ok) throw new Error(`API responded ${wRes.status}`)
            updatedWorkouts.push(updated)
          } else {
            updatedWorkouts.push(w)
          }
        }
        onWorkoutsChange(updatedWorkouts)

        const updatedTemplates: Template[] = []
        for (const t of templates) {
          if (t.exercises?.some((e) => matches(e.name, editing.name))) {
            const updated: Template = {
              ...t,
              exercises: t.exercises.map((e) =>
                matches(e.name, editing.name) ? { ...e, name: nextName } : e,
              ),
            }
            const tRes = await api.send('POST', '/api/templates', updated)
            if (!tRes.ok) throw new Error(`API responded ${tRes.status}`)
            updatedTemplates.push(updated)
          } else {
            updatedTemplates.push(t)
          }
        }
        onTemplatesChange(updatedTemplates)
      }

      onCustomsChange([
        ...customs.filter((c) => !matches(c.name, editing.name)),
        next,
      ])
      setEditing(null)
    } catch {
      setError('Saving needs a connection — try again when online.')
    } finally {
      setBusy(false)
    }
  }

  async function deleteExercise(exercise: CustomExercise) {
    setError(null)
    try {
      const res = await api.send(
        'DELETE',
        `/api/exercises?name=${encodeURIComponent(exercise.name)}`,
      )
      if (!res.ok) throw new Error(`API responded ${res.status}`)
      onCustomsChange(customs.filter((c) => !matches(c.name, exercise.name)))
    } catch {
      setError('Deleting needs a connection — try again when online.')
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h1 className="text-base font-medium text-neutral-300">Manage</h1>
        <button
          onClick={onClose}
          className="text-sm text-neutral-500 hover:text-neutral-300"
        >
          ← Back
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <section className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-600">
          Templates
        </p>
        {templates.length === 0 && (
          <p className="text-sm text-neutral-600">
            No templates yet — they make starting a workout one tap.
          </p>
        )}
        {templates.map((t) => (
          <div
            key={t.id}
            className="flex items-center gap-3 rounded-xl border border-neutral-800/60 bg-neutral-900/60 p-3"
          >
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${KIND_STYLE[t.kind as WorkoutKind]}`}
            >
              {t.kind}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-neutral-100">
                {t.name}
              </p>
              <p className="text-xs text-neutral-500">{templateMeta(t)}</p>
            </div>
            <button
              onClick={() => onEditTemplate(t)}
              className="text-xs font-medium text-teal-400 hover:text-teal-300"
            >
              Edit
            </button>
            <button
              onClick={() => onDeleteTemplate(t)}
              className="px-1 text-neutral-600 hover:text-red-400"
              aria-label={`delete template ${t.name}`}
            >
              ✕
            </button>
          </div>
        ))}
        <button onClick={onNewTemplate} className={`${secondaryButton} w-full`}>
          + New template
        </button>
      </section>

      <section className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-600">
          Custom exercises
        </p>
        {customs.length === 0 && (
          <p className="text-sm text-neutral-600">
            Exercises you type in during a session are saved here for
            renaming or muscle-group fixes.
          </p>
        )}
        {customs
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((c) =>
            editing && matches(editing.name, c.name) ? (
              <div
                key={c.name}
                className="flex flex-col gap-2 rounded-xl border border-teal-500/40 bg-neutral-900/60 p-3"
              >
                <div className="flex gap-2">
                  <input
                    className={inputClass}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                  />
                  <select
                    className={`${inputClass} w-auto`}
                    value={editMuscle}
                    onChange={(e) => setEditMuscle(e.target.value)}
                  >
                    {[...MUSCLE_GROUPS.filter((m) => m !== editMuscle), editMuscle]
                      .sort()
                      .map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                  </select>
                </div>
                {affectedCount > 0 && (
                  <p className="text-xs text-amber-400/90">
                    Also renames it in {affectedCount} logged workout
                    {affectedCount === 1 ? '' : 's'}.
                  </p>
                )}
                <div className="flex items-center gap-3">
                  <button
                    onClick={saveExercise}
                    disabled={busy}
                    className={buttonClass}
                  >
                    {busy ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    onClick={() => setEditing(null)}
                    className="text-sm text-neutral-500 hover:text-neutral-300"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div
                key={c.name}
                className="flex items-center gap-3 rounded-xl border border-neutral-800/60 bg-neutral-900/60 p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-neutral-100">{c.name}</p>
                  <p className="text-xs uppercase tracking-wide text-neutral-600">
                    {c.muscle}
                  </p>
                </div>
                <button
                  onClick={() => startEdit(c)}
                  className="text-xs font-medium text-teal-400 hover:text-teal-300"
                >
                  Edit
                </button>
                <button
                  onClick={() => deleteExercise(c)}
                  className="px-1 text-neutral-600 hover:text-red-400"
                  aria-label={`delete exercise ${c.name}`}
                >
                  ✕
                </button>
              </div>
            ),
          )}
      </section>
    </div>
  )
}
