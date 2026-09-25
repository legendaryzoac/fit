import { useId, useState } from 'react'
import { confirm } from '../lib/confirm'
import type { Modality, Workout } from '../lib/workouts'
import { Button } from './cadence/Button'
import { Field, SELECT_WELL, TextArea, TextInput } from './cadence/Field'
import { ScaleRow } from './cadence/ScaleRow'
import { Stepper } from './cadence/Stepper'
import { Segment } from './shell/Segment'
import { Sheet } from './shell/Sheet'
import { useSheetDismiss } from './shell/useSheetDismiss'

/**
 * Five-second recovery log for the sessions that don't need a timer
 * (a cold shower, a sauna, a walk) and the edit form for any recovery
 * session. Fields pre-fill from the last entry of the same modality —
 * the single most requested feature in sauna/plunge logging apps.
 */

export const MODALITIES: Array<{
  value: Modality
  label: string
  timed: boolean
}> = [
  { value: 'cold', label: 'Cold', timed: false },
  { value: 'sauna', label: 'Sauna', timed: false },
  { value: 'contrast', label: 'Contrast', timed: false },
  { value: 'walk', label: 'Walk', timed: false },
  { value: 'massage', label: 'Massage', timed: false },
  { value: 'foamroll', label: 'Foam roll', timed: false },
  { value: 'breath', label: 'Breathwork', timed: false },
  { value: 'stretch', label: 'Stretch', timed: true },
  { value: 'mobility', label: 'Mobility', timed: true },
  { value: 'other', label: 'Other', timed: false },
]

const TEMP_MODALITIES: Modality[] = ['cold', 'sauna', 'contrast']
const ROUND_MODALITIES: Modality[] = ['sauna', 'contrast']
const FEEL_OPTIONS = ['1', '2', '3', '4', '5'].map((v) => ({ value: v, label: v }))

export function modalityLabel(m: Modality): string {
  return MODALITIES.find((x) => x.value === m)?.label ?? m
}

export function cToF(c: number): number {
  return Math.round((c * 9) / 5 + 32)
}

function fToC(f: number): number {
  return Math.round((((f - 32) * 5) / 9) * 10) / 10
}

function toLocalInput(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function seedFrom(m: Modality, prev?: Workout) {
  return {
    minutes: prev?.durationMin ?? (m === 'cold' ? 3 : m === 'sauna' ? 15 : 20),
    tempF: prev?.dose?.tempC != null ? cToF(prev.dose.tempC) : m === 'cold' ? 55 : 170,
    rounds: prev?.dose?.rounds ?? 0,
  }
}

export function QuickLog({
  initial,
  lastOf,
  onSave,
  onCancel,
  onDelete,
}: {
  /** Editing an existing recovery session; absent = new quick log. */
  initial?: Workout
  /** Most recent saved session of a modality, for pre-filling. */
  lastOf: (m: Modality) => Workout | undefined
  onSave: (w: Workout) => void
  onCancel: () => void
  /** Resolves true once the session is gone; the sheet then drops. */
  onDelete?: (w: Workout) => Promise<boolean>
}) {
  const editing = initial !== undefined
  const [modality, setModality] = useState<Modality>(initial?.modality ?? 'sauna')
  const [seed, setSeed] = useState(() =>
    seedFrom(initial?.modality ?? 'sauna', initial ?? lastOf('sauna')),
  )
  const [title, setTitle] = useState(initial?.title ?? '')
  const [start, setStart] = useState(() =>
    toLocalInput(
      initial?.start ?? new Date(Date.now() - seed.minutes * 60_000).toISOString(),
    ),
  )
  const [feel, setFeel] = useState<number | undefined>(initial?.rating?.post)
  const [rpe, setRpe] = useState<number | undefined>(initial?.sessionRpe)
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [error, setError] = useState<string | null>(null)
  const modalityId = useId()
  const minutesId = useId()
  const tempId = useId()
  const roundsId = useId()
  const titleId = useId()
  const startId = useId()
  const notesId = useId()

  // Every way out unmounts this screen in the parent, so the sheet drops
  // first and the real callback waits for the exit to finish.
  const { open, dismiss, onExited } = useSheetDismiss()

  const timed = MODALITIES.find((m) => m.value === modality)?.timed ?? false
  // Guided sessions being edited keep their holds; only the metadata moves
  const guided = editing && (initial.exercises.length > 0 || timed)

  function pickModality(m: Modality) {
    setModality(m)
    if (!editing) {
      const next = seedFrom(m, lastOf(m))
      setSeed(next)
      setStart(toLocalInput(new Date(Date.now() - next.minutes * 60_000).toISOString()))
    }
  }

  function save() {
    const startMs = new Date(start).getTime()
    if (!Number.isFinite(startMs)) {
      setError('Pick a valid start time.')
      return
    }
    const tempC = TEMP_MODALITIES.includes(modality) ? fToC(seed.tempF) : undefined
    const rounds =
      ROUND_MODALITIES.includes(modality) && seed.rounds > 0 ? seed.rounds : undefined
    const dose =
      tempC !== undefined || rounds !== undefined
        ? { ...(tempC !== undefined && { tempC }), ...(rounds !== undefined && { rounds }) }
        : undefined
    dismiss(() =>
      onSave({
        id: initial?.id ?? crypto.randomUUID(),
        start: new Date(startMs).toISOString(),
        end: new Date(startMs + seed.minutes * 60_000).toISOString(),
        kind: 'recovery',
        modality,
        title: title.trim() || (guided ? initial?.title : modalityLabel(modality)),
        weightUnit: 'lb',
        exercises: initial?.exercises ?? [],
        intervals: initial?.intervals,
        durationMin: Math.round(seed.minutes),
        dose,
        rating: feel !== undefined ? { post: feel } : initial?.rating,
        sessionRpe: rpe,
        notes: notes.trim() || undefined,
        mesoId: initial?.mesoId,
        mesoDayIndex: initial?.mesoDayIndex,
      }),
    )
  }

  async function removeSaved() {
    if (!initial || !onDelete) return
    if (!(await confirm({ title: 'Delete this session?', action: 'Delete' }))) {
      return
    }
    void onDelete(initial).then((ok) => {
      if (ok) dismiss(onCancel)
    })
  }

  return (
    <Sheet
      open={open}
      onClose={() => dismiss(onCancel)}
      onExited={onExited}
      title={editing ? 'Edit recovery' : 'Log recovery'}
    >
      <div className="flex flex-col gap-4">
        <Field label="What" htmlFor={modalityId}>
          <select
            id={modalityId}
            className={SELECT_WELL}
            value={modality}
            onChange={(e) => pickModality(e.target.value as Modality)}
          >
            {MODALITIES.filter((m) => !m.timed || guided).map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Minutes" htmlFor={minutesId}>
          <Stepper
            id={minutesId}
            ariaLabel="Minutes"
            min={1}
            max={600}
            value={seed.minutes}
            onChange={(n) => setSeed({ ...seed, minutes: n })}
          />
        </Field>

        {(TEMP_MODALITIES.includes(modality) || ROUND_MODALITIES.includes(modality)) && (
          <div className="grid grid-cols-2 gap-3">
            {TEMP_MODALITIES.includes(modality) && (
              <Field label="Temp °F" htmlFor={tempId}>
                <Stepper
                  id={tempId}
                  ariaLabel="Temperature in Fahrenheit"
                  min={-20}
                  max={250}
                  value={seed.tempF}
                  onChange={(n) => setSeed({ ...seed, tempF: n })}
                />
              </Field>
            )}
            {ROUND_MODALITIES.includes(modality) && (
              <Field label="Rounds" htmlFor={roundsId}>
                <Stepper
                  id={roundsId}
                  ariaLabel="Rounds"
                  min={0}
                  max={20}
                  value={seed.rounds}
                  onChange={(n) => setSeed({ ...seed, rounds: n })}
                />
              </Field>
            )}
          </div>
        )}

        <Field label="Title" htmlFor={titleId}>
          <TextInput
            id={titleId}
            placeholder={modalityLabel(modality)}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <Field label="Start" htmlFor={startId}>
          <TextInput
            id={startId}
            type="datetime-local"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </Field>

        {guided && initial && (
          <p className="text-caption text-ink-3">
            {initial.exercises.length} stretches kept
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between">
            <span className="text-caption font-semibold text-ink-2">Feel</span>
            <span className="text-caption text-ink-3">Stiff to loose</span>
          </div>
          <Segment
            block
            options={FEEL_OPTIONS}
            value={feel === undefined ? undefined : String(feel)}
            onChange={(v) => setFeel(Number(v))}
            ariaLabel="Feel"
          />
        </div>

        <ScaleRow label="Effort" low="Rest" high="Max" value={rpe} onChange={setRpe} />

        <Field label="Notes" htmlFor={notesId}>
          <TextArea
            id={notesId}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>

        {error && <p className="text-caption text-rose-strong">{error}</p>}

        <Button variant="primary" block onClick={save}>
          Save
        </Button>
        {editing && onDelete && (
          <Button variant="ghost-danger" block onClick={removeSaved}>
            Delete
          </Button>
        )}
      </div>
    </Sheet>
  )
}
