import { useMemo, useState } from 'react'
import type { Api } from '../lib/api'
import {
  EXERCISES,
  MUSCLE_GROUPS,
  SPEED_DRILLS,
  makeMuscleLookup,
  type CustomExercise,
} from '../lib/exercises'
import {
  buildIntervals,
  DEFAULT_PLAN,
  fmtSec,
  planFromSections,
  totalSec,
  type QuickIntervalPlan,
  type Template,
} from '../lib/templates'
import type { WorkoutKind } from '../lib/workouts'
import { buttonClass, inputClass } from './ui'

export const KIND_STYLE: Record<WorkoutKind, string> = {
  strength: 'bg-teal-500/15 text-teal-300',
  speed: 'bg-violet-500/15 text-violet-300',
  cardio: 'bg-sky-500/15 text-sky-300',
}

const PLAN_FIELDS: Array<{
  key: keyof QuickIntervalPlan
  label: string
}> = [
  { key: 'warmupSec', label: 'Warm up (sec)' },
  { key: 'workSec', label: 'Work (sec)' },
  { key: 'restSec', label: 'Rest (sec)' },
  { key: 'sets', label: 'Sets' },
  { key: 'cooldownSec', label: 'Cool down (sec)' },
]

export function PlanFields({
  plan,
  onChange,
}: {
  plan: QuickIntervalPlan
  onChange: (plan: QuickIntervalPlan) => void
}) {
  const sections = useMemo(() => buildIntervals(plan), [plan])
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {PLAN_FIELDS.map(({ key, label }) => (
          <label key={key} className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-wide text-neutral-600">
              {label}
            </span>
            <input
              className={inputClass}
              type="number"
              inputMode="numeric"
              min={0}
              value={plan[key]}
              onChange={(e) =>
                onChange({ ...plan, [key]: Math.max(0, Number(e.target.value)) })
              }
            />
          </label>
        ))}
      </div>
      <p className="text-xs text-neutral-500">
        {sections.length} sections · {fmtSec(totalSec(sections))} total ·{' '}
        {sections.map((s) => s.label[0]).join('·')}
      </p>
    </div>
  )
}

export function TemplateBuilder({
  api,
  customs,
  initial,
  onSaveCustom,
  onSaved,
  onCancel,
}: {
  api: Api
  customs: CustomExercise[]
  initial?: Template
  onSaveCustom: (name: string, muscle: string) => void
  onSaved: (t: Template) => void
  onCancel: () => void
}) {
  const [kind, setKind] = useState<WorkoutKind>(initial?.kind ?? 'strength')
  const [name, setName] = useState(initial?.name ?? '')
  const [exercises, setExercises] = useState<
    Array<{ name: string; setCount: number }>
  >(initial?.exercises ?? [])
  const [exName, setExName] = useState('')
  const [newMuscle, setNewMuscle] = useState<string>('other')
  const [plan, setPlan] = useState<QuickIntervalPlan>(
    initial?.sections ? planFromSections(initial.sections) : DEFAULT_PLAN,
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const lookup = useMemo(() => makeMuscleLookup(customs), [customs])

  const names = useMemo(() => {
    const base = (kind === 'speed' ? SPEED_DRILLS : EXERCISES).map(
      (e) => e.name,
    )
    return [...new Set([...base, ...customs.map((c) => c.name)])].sort()
  }, [kind, customs])

  const typedUnknown =
    exName.trim().length > 0 && lookup(exName) === undefined

  function addExercise() {
    const trimmed = exName.trim()
    if (!trimmed) return
    if (lookup(trimmed) === undefined) onSaveCustom(trimmed, newMuscle)
    setExercises([...exercises, { name: trimmed, setCount: 3 }])
    setExName('')
    setNewMuscle('other')
  }

  async function save() {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Give the template a name.')
      return
    }
    if (kind === 'strength' && exercises.length === 0) {
      setError('Add at least one exercise.')
      return
    }
    setBusy(true)
    setError(null)
    const template: Template =
      kind === 'strength'
        ? { id: initial?.id ?? crypto.randomUUID(), name: trimmed, kind, exercises }
        : {
            id: initial?.id ?? crypto.randomUUID(),
            name: trimmed,
            kind,
            sections: buildIntervals(plan),
          }
    try {
      const res = await api.send('POST', '/api/templates', template)
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `API responded ${res.status}`)
      onSaved(template)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not save the template',
      )
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-base font-medium text-neutral-300">
          {initial ? 'Edit template' : 'New template'}
        </h1>
        <button
          onClick={onCancel}
          className="text-sm text-neutral-500 hover:text-neutral-300"
        >
          Cancel
        </button>
      </div>

      <div className="flex gap-2">
        {(['strength', 'speed', 'cardio'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={`rounded-full px-3 py-1.5 text-sm capitalize ${
              kind === k
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
        placeholder="template name (e.g. Upper A, Track Tuesday)"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      {kind === 'strength' ? (
        <>
          {exercises.map((e, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="flex-1 truncate text-sm text-neutral-200">
                {e.name}
              </span>
              <label className="flex items-center gap-1.5 text-xs text-neutral-500">
                sets
                <input
                  className={`${inputClass} w-16 text-center`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={30}
                  value={e.setCount}
                  onChange={(ev) =>
                    setExercises(
                      exercises.map((x, j) =>
                        j === i
                          ? {
                              ...x,
                              setCount: Math.max(
                                1,
                                Math.min(30, Math.round(Number(ev.target.value)) || 1),
                              ),
                            }
                          : x,
                      ),
                    )
                  }
                />
              </label>
              <button
                onClick={() => setExercises(exercises.filter((_, j) => j !== i))}
                className="text-neutral-600 hover:text-red-400"
                aria-label="remove exercise"
              >
                ✕
              </button>
            </div>
          ))}
          <div className="flex gap-2">
            <input
              className={inputClass}
              list="template-exercise-names"
              placeholder="add exercise…"
              value={exName}
              onChange={(e) => setExName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addExercise()}
            />
            <datalist id="template-exercise-names">
              {names.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
            <button onClick={addExercise} className={`${buttonClass} shrink-0`}>
              Add
            </button>
          </div>
          {typedUnknown && (
            <label className="flex items-center gap-2 text-xs text-neutral-500">
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
        </>
      ) : (
        <PlanFields plan={plan} onChange={setPlan} />
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      <button onClick={save} disabled={busy} className={`${buttonClass} w-full`}>
        {busy ? 'Saving…' : 'Save template'}
      </button>
    </div>
  )
}
