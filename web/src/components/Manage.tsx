import { useId, useState } from 'react'
import type { Api } from '../lib/api'
import {
  EQUIPMENT,
  EXERCISES,
  MUSCLE_GROUPS,
  SPEED_DRILLS,
  builtinExercise,
  equipmentLabel,
  exerciseCatalog,
  inferEquipment,
  overrideFor,
  type CustomExercise,
  type Equipment,
} from '../lib/exercises'
import { effectiveRoutines, routineMinutes, type Routine } from '../lib/routines'
import type { Template } from '../lib/templates'
import type { Workout } from '../lib/workouts'
import { Banner } from './cadence/Banner'
import { Button } from './cadence/Button'
import { Card } from './cadence/Card'
import { EmptyState } from './cadence/EmptyState'
import { Field, SELECT_WELL, TextInput } from './cadence/Field'
import { IconButton } from './cadence/IconButton'
import { List, ListItem } from './cadence/ListItem'
import {
  IconChevronDown,
  IconChevronRight,
  IconRecover,
  IconX,
} from './shell/icons'
import { KIND_LEAD, templateMeta } from './TemplateBuilder'

/** Every built-in lift and drill, A to Z. */
const BUILTINS = [...EXERCISES, ...SPEED_DRILLS].sort((a, b) =>
  a.name.localeCompare(b.name),
)

/** A section head that folds its list away: the built-ins sit behind one
 * so the user's own things come first. */
function Disclosure({
  title,
  count,
  open,
  onToggle,
}: {
  title: string
  count: number
  open: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className="pressable flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-1 text-left hover:bg-surface-2"
    >
      <span className="text-title-sm text-ink">{title}</span>
      <span className="flex items-center gap-1 text-caption text-ink-3">
        {count}
        {open ? (
          <IconChevronDown className="h-5 w-5 text-ink-4" />
        ) : (
          <IconChevronRight className="h-5 w-5 text-ink-4" />
        )}
      </span>
    </button>
  )
}

/**
 * The Plan tab's library: the templates (edited in the builder sheet) and
 * the exercises, with one form that adds a new one or renames an existing
 * one — a rename propagates through logged history so ghosts, PRs and
 * e1RM trends stay on one line.
 *
 * Built-ins live behind their own folds. Editing one saves a copy that
 * replaces it for this user alone: an exercise edit is a custom entry
 * carrying the built-in's name in `builtin`, a routine edit a recovery
 * template carrying the routine's id. Deleting the copy brings the
 * built-in back.
 */
export function Manage({
  api,
  templates,
  customs,
  workouts,
  onNewTemplate,
  onEditTemplate,
  onEditBuiltinRoutine,
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
  /** Opens the builder on a copy of a built-in routine that becomes this
   * user's edit of it once saved. */
  onEditBuiltinRoutine: (r: Routine) => void
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
  const [routinesOpen, setRoutinesOpen] = useState(false)
  const [builtinsOpen, setBuiltinsOpen] = useState(false)
  const [find, setFind] = useState('')
  const nameId = useId()
  const muscleId = useId()
  const equipmentId = useId()
  const libraryId = useId()
  const findId = useId()

  const matches = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

  /** An entry that stands in for a built-in: marked, or saved under its name. */
  const isOverride = (c: CustomExercise) =>
    c.builtin != null || builtinExercise(c.name) != null

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

  /** A built-in as the entry about to replace it; saving creates the copy. */
  function startBuiltin(b: { name: string; muscle: string }) {
    startEdit({ name: b.name, muscle: b.muscle, builtin: b.name })
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
  // saving a built-in's name creates the entry that replaces it.
  function changeName(name: string) {
    setEditName(name)
    if (editing) return
    const typed = name.trim()
    const existing = customs.find((c) => matches(c.name, typed))
    const known = existing ?? builtinExercise(typed)
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
    // The built-in this entry replaces: the one being edited, or the one
    // whose name was typed. A plain custom carries none.
    const builtin = editing?.builtin ?? builtinExercise(nextName)?.name
    const next: CustomExercise = {
      name: nextName,
      muscle: editMuscle,
      equipment: editEquipment,
      ...(builtin !== undefined && { builtin }),
    }
    setBusy(true)
    setError(null)
    try {
      const res = await api.send('POST', '/api/exercises', next)
      if (!res.ok) throw new Error(`API responded ${res.status}`)

      const renamed = editing != null && !matches(nextName, editing.name)
      if (editing && renamed) {
        // The old row goes only if there was one: a built-in being edited
        // for the first time has no row of its own yet.
        if (customs.some((c) => matches(c.name, editing.name))) {
          await api.send(
            'DELETE',
            `/api/exercises?name=${encodeURIComponent(editing.name)}`,
          )
        }

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

  /** Removes an entry; for an edit of a built-in, the built-in comes back. */
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

  // The user's own exercises; edits of built-ins show under the built-ins
  const own = customs
    .filter((c) => !isOverride(c))
    .sort((a, b) => a.name.localeCompare(b.name))

  const ownTemplates = templates.filter((t) => !t.builtin)
  const routines = effectiveRoutines(templates)

  const needle = find.trim().toLowerCase()
  const shownBuiltins = needle
    ? BUILTINS.filter(
        (b) =>
          b.name.toLowerCase().includes(needle) ||
          b.muscle.toLowerCase().includes(needle) ||
          overrideFor(b.name, customs)?.name.toLowerCase().includes(needle),
      )
    : BUILTINS

  // The muscle list always holds the current value, even a legacy one
  const muscleOptions = [
    ...MUSCLE_GROUPS.filter((m) => m !== editMuscle),
    editMuscle,
  ].sort()

  // Every name a picker offers, so a built-in's name can be typed to edit it
  const libraryNames = exerciseCatalog(customs)
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b))

  return (
    <>
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3 px-1">
          <h2 className="text-title-sm text-ink">Templates</h2>
          <Button variant="ghost" size="sm" onClick={onNewTemplate}>
            New
          </Button>
        </div>
        {ownTemplates.length === 0 ? (
          <EmptyState title="No templates yet" />
        ) : (
          <List>
            {ownTemplates.map((t) => (
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
        <Disclosure
          title="Built-in routines"
          count={routines.length}
          open={routinesOpen}
          onToggle={() => setRoutinesOpen((v) => !v)}
        />
        {routinesOpen && (
          <>
            <p className="px-1 text-caption text-ink-3">
              Edits replace the built-in for you only.
            </p>
            <List>
              {routines.map(({ routine: r, override }) => (
                <ListItem
                  key={r.id}
                  lead={<IconRecover />}
                  leadTone="calm"
                  title={r.name}
                  sub={
                    override
                      ? `${templateMeta(override)} · edited`
                      : `${routineMinutes(r)} min · ${r.blurb}`
                  }
                  chevron
                  onClick={() =>
                    override ? onEditTemplate(override) : onEditBuiltinRoutine(r)
                  }
                />
              ))}
            </List>
          </>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3 px-1">
          <h2 className="text-title-sm text-ink">Exercises</h2>
          <Button variant="ghost" size="sm" onClick={cancelEdit}>
            New
          </Button>
        </div>
        {error && <Banner tone="error">{error}</Banner>}
        {own.length > 0 && (
          <List>
            {own.map((c) => (
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
            {editing?.builtin && (
              <Banner tone="info">
                <span>
                  <b>Built-in.</b> Your version replaces {editing.builtin} for
                  you only.
                </span>
              </Banner>
            )}
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

      <section className="flex flex-col gap-2">
        <Disclosure
          title="Built-in exercises"
          count={BUILTINS.length}
          open={builtinsOpen}
          onToggle={() => setBuiltinsOpen((v) => !v)}
        />
        {builtinsOpen && (
          <>
            <p className="px-1 text-caption text-ink-3">
              Tap one to rename it or set its muscle group and equipment.
              Edits replace the built-in for you only; the X resets one.
            </p>
            <TextInput
              id={findId}
              aria-label="Find a built-in exercise"
              placeholder="Find"
              value={find}
              onChange={(e) => setFind(e.target.value)}
            />
            {shownBuiltins.length === 0 ? (
              <p className="px-1 text-caption text-ink-3">Nothing matches.</p>
            ) : (
              <List>
                {shownBuiltins.map((b) => {
                  const edit = overrideFor(b.name, customs)
                  if (edit) {
                    return (
                      <ListItem
                        key={b.name}
                        title={edit.name}
                        sub={`${edit.muscle}${
                          edit.equipment ? ` · ${equipmentLabel(edit.equipment)}` : ''
                        } · edited`}
                        chevron
                        onClick={() => startEdit(edit)}
                        action={
                          <IconButton
                            size="sm"
                            label={`Reset ${b.name}`}
                            onClick={() => deleteExercise(edit)}
                          >
                            <IconX className="h-4 w-4" />
                          </IconButton>
                        }
                      />
                    )
                  }
                  const eq = inferEquipment(b.name)
                  return (
                    <ListItem
                      key={b.name}
                      title={b.name}
                      sub={eq ? `${b.muscle} · ${equipmentLabel(eq)}` : b.muscle}
                      chevron
                      onClick={() => startBuiltin(b)}
                    />
                  )
                })}
              </List>
            )}
          </>
        )}
      </section>
    </>
  )
}
