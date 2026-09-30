import { useId, useState } from 'react'
import type { Api } from '../lib/api'
import {
  EQUIPMENT,
  EXERCISES,
  MUSCLE_GROUPS,
  SPEED_DRILLS,
  equipmentLabel,
  inferEquipment,
  type CustomExercise,
  type Equipment,
} from '../lib/exercises'
import type { Template } from '../lib/templates'
import type { Workout } from '../lib/workouts'
import { Banner } from './cadence/Banner'
import { Button } from './cadence/Button'
import { Card } from './cadence/Card'
import { EmptyState } from './cadence/EmptyState'
import { Field, SELECT_WELL, TextInput } from './cadence/Field'
import { IconButton } from './cadence/IconButton'
import { List, ListItem } from './cadence/ListItem'
import { IconX } from './shell/icons'
import { KIND_LEAD, templateMeta } from './TemplateBuilder'

const BUILTIN_BY_NAME = new Map(
  [...EXERCISES, ...SPEED_DRILLS].map((e) => [e.name.toLowerCase(), e]),
)

/**
 * The Plan tab's library: the templates (edited in the builder sheet) and
 * the custom exercises, with one form that adds a new one or renames an
 * existing one — a rename propagates through logged history so ghosts,
 * PRs and e1RM trends stay on one line.
 */
export function Manage({
  api,
  templates,
  customs,
  workouts,
  onNewTemplate,
  onEditTemplate,
  onCustomsChange,
  onTemplatesChange,
  onWorkoutsChange,
}: {
  api: Api
  templates: Template[]
  customs: CustomExercise[]
  workouts: Workout[]
  onNewTemplate: () => void
  onEditTemplate: (t: Template) => void
  onCustomsChange: (next: CustomExercise[]) => void
  onTemplatesChange: (next: Template[]) => void
  onWorkoutsChange: (next: Workout[]) => void
}) {
  const [editing, setEditing] = useState<CustomExercise | null>(null)
  const [editName, setEditName] = useState('')
  const [editMuscle, setEditMuscle] = useState('other')
  const [editEquipment, setEditEquipment] = useState<Equipment>('other')
  // Once the user picks a value, typing the name stops overwriting it
  const [muscleTouched, setMuscleTouched] = useState(false)
  const [equipmentTouched, setEquipmentTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameId = useId()
  const muscleId = useId()
  const equipmentId = useId()
  const libraryId = useId()

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
    setEditEquipment(
      exercise.equipment ?? inferEquipment(exercise.name) ?? 'other',
    )
    setMuscleTouched(true)
    setEquipmentTouched(true)
    setError(null)
  }

  function cancelEdit() {
    setEditing(null)
    setEditName('')
    setEditMuscle('other')
    setEditEquipment('other')
    setMuscleTouched(false)
    setEquipmentTouched(false)
    setError(null)
  }

  // Adding: a name we already know pre-fills its muscle and equipment, so
  // saving a built-in creates the custom entry that overrides it.
  function changeName(name: string) {
    setEditName(name)
    if (editing) return
    const typed = name.trim()
    const existing = customs.find((c) => matches(c.name, typed))
    const known = existing ?? BUILTIN_BY_NAME.get(typed.toLowerCase())
    if (known && !muscleTouched) setEditMuscle(known.muscle)
    if (!equipmentTouched) {
      setEditEquipment(
        existing?.equipment ?? inferEquipment(typed) ?? 'other',
      )
    }
  }

  async function saveExercise() {
    const nextName = editName.trim()
    if (!nextName) {
      setError('Exercise needs a name.')
      return
    }
    const next: CustomExercise = {
      name: nextName,
      muscle: editMuscle,
      equipment: editEquipment,
    }
    setBusy(true)
    setError(null)
    try {
      const res = await api.send('POST', '/api/exercises', next)
      if (!res.ok) throw new Error(`API responded ${res.status}`)

      const renamed = editing != null && !matches(nextName, editing.name)
      if (editing && renamed) {
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

      // Same name (case aside) replaces in place, whether editing or adding
      const oldName = editing?.name ?? nextName
      onCustomsChange([
        ...customs.filter(
          (c) => !matches(c.name, oldName) && !matches(c.name, nextName),
        ),
        next,
      ])
      cancelEdit()
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
      if (editing && matches(editing.name, exercise.name)) cancelEdit()
    } catch {
      setError('Deleting needs a connection — try again when online.')
    }
  }

  const sortedCustoms = customs
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))

  // The muscle list always holds the current value, even a legacy one
  const muscleOptions = [
    ...MUSCLE_GROUPS.filter((m) => m !== editMuscle),
    editMuscle,
  ].sort()

  // Built-ins and customs together, so a built-in can be given equipment
  const libraryNames = [
    ...new Map(
      [...EXERCISES, ...SPEED_DRILLS, ...customs].map((e) => [
        e.name.toLowerCase(),
        e.name,
      ]),
    ).values(),
  ].sort((a, b) => a.localeCompare(b))

  return (
    <>
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3 px-1">
          <h2 className="text-title-sm text-ink">Templates</h2>
          <Button variant="ghost" size="sm" onClick={onNewTemplate}>
            New
          </Button>
        </div>
        {templates.length === 0 ? (
          <EmptyState title="No templates yet" />
        ) : (
          <List>
            {templates.map((t) => (
              <ListItem
                key={t.id}
                lead={KIND_LEAD[t.kind].icon}
                leadTone={KIND_LEAD[t.kind].tone}
                title={t.name}
                sub={templateMeta(t)}
                chevron
                onClick={() => onEditTemplate(t)}
              />
            ))}
          </List>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3 px-1">
          <h2 className="text-title-sm text-ink">Exercises</h2>
          <Button variant="ghost" size="sm" onClick={cancelEdit}>
            New
          </Button>
        </div>
        <p className="px-1 text-caption text-ink-3">
          Built-in names can be added here to set their equipment.
        </p>
        {error && <Banner tone="error">{error}</Banner>}
        {sortedCustoms.length > 0 && (
          <List>
            {sortedCustoms.map((c) => (
              <ListItem
                key={c.name}
                title={c.name}
                sub={
                  c.equipment
                    ? `${c.muscle} · ${equipmentLabel(c.equipment)}`
                    : c.muscle
                }
                onClick={() => startEdit(c)}
                action={
                  <IconButton
                    size="sm"
                    label={`Delete ${c.name}`}
                    onClick={() => deleteExercise(c)}
                  >
                    <IconX className="h-4 w-4" />
                  </IconButton>
                }
              />
            ))}
          </List>
        )}
        <Card>
          <div className="flex flex-col gap-3">
            <Field label="Name" htmlFor={nameId}>
              <TextInput
                id={nameId}
                list={libraryId}
                value={editName}
                onChange={(e) => changeName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveExercise()}
              />
              <datalist id={libraryId}>
                {libraryNames.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </Field>
            <Field label="Muscle group" htmlFor={muscleId}>
              <select
                id={muscleId}
                className={SELECT_WELL}
                value={editMuscle}
                onChange={(e) => {
                  setEditMuscle(e.target.value)
                  setMuscleTouched(true)
                }}
              >
                {muscleOptions.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Equipment" htmlFor={equipmentId}>
              <select
                id={equipmentId}
                className={SELECT_WELL}
                value={editEquipment}
                onChange={(e) => {
                  setEditEquipment(e.target.value as Equipment)
                  setEquipmentTouched(true)
                }}
              >
                {EQUIPMENT.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
            {affectedCount > 0 && (
              <Banner tone="info">
                Renames it in {affectedCount}{' '}
                {affectedCount === 1 ? 'workout' : 'workouts'}.
              </Banner>
            )}
            <Button
              variant="quiet"
              block
              disabled={busy}
              onClick={saveExercise}
            >
              {editing ? 'Save' : 'Add'}
            </Button>
            {editing && (
              <Button variant="ghost" block onClick={cancelEdit}>
                Cancel
              </Button>
            )}
          </div>
        </Card>
      </section>
    </>
  )
}
