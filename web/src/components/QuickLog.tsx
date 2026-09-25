import { useState } from 'react'
import type { Modality, Workout } from '../lib/workouts'
import { ScaleRow, Segmented } from './Feedback'
import { buttonClass, inputClass, NumberField } from './ui'

/**
 * Five-second recovery log for the sessions that don't need a timer
 * (a cold shower, a sauna, a walk) and the edit form for any recovery
 * session. Fields pre-fill from the last entry of the same modality —
 * the single most requested feature in sauna/plunge logging apps.
 */

const MODALITIES: Array<{ value: Modality; label: string; timed: boolean }> = [
  { value: 'cold', label: 'Cold shower / plunge', timed: false },
  { value: 'sauna', label: 'Sauna', timed: false },
  { value: 'contrast', label: 'Contrast (hot / cold)', timed: false },
  { value: 'walk', label: 'Walk', timed: false },
  { value: 'massage', label: 'Massage', timed: false },
  { value: 'foamroll', label: 'Foam rolling', timed: false },
  { value: 'breath', label: 'Breathwork', timed: false },
  { value: 'stretch', label: 'Stretching', timed: true },
  { value: 'mobility', label: 'Mobility', timed: true },
  { value: 'other', label: 'Other', timed: false },
]

const TEMP_MODALITIES: Modality[] = ['cold', 'sauna', 'contrast']
const ROUND_MODALITIES: Modality[] = ['sauna', 'contrast']

const FEEL: Array<{ value: '1' | '2' | '3' | '4' | '5'; label: string }> = [
  { value: '1', label: '1' },
  { value: '2', label: '2' },
  { value: '3', label: '3' },
  { value: '4', label: '4' },
  { value: '5', label: '5' },
]

const cToF = (c: number) => Math.round((c * 9) / 5 + 32)
const fToC = (f: number) => Math.round((((f - 32) * 5) / 9) * 10) / 10

function toLocalInput(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function modalityLabel(m: Modality): string {
  return MODALITIES.find((x) => x.value === m)?.label ?? m
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
  onDelete?: (w: Workout) => void
}) {
  const editing = initial !== undefined
  const seedFrom = (m: Modality, prev?: Workout) => ({
    minutes: prev?.durationMin ?? (m === 'cold' ? 3 : m === 'sauna' ? 15 : 20),
    tempF: prev?.dose?.tempC != null ? cToF(prev.dose.tempC) : undefined,
    rounds: prev?.dose?.rounds,
  })

  const [modality, setModality] = useState<Modality>(
    initial?.modality ?? 'sauna',
  )
  const [seed, setSeed] = useState(() =>
    seedFrom(initial?.modality ?? 'sauna', initial ?? lastOf('sauna')),
  )
  const [title, setTitle] = useState(initial?.title ?? '')
  const [start, setStart] = useState(() =>
    toLocalInput(
      initial?.start ??
        new Date(Date.now() - seed.minutes * 60_000).toISOString(),
    ),
  )
  const [feel, setFeel] = useState<number | undefined>(initial?.rating?.post)
  const [rpe, setRpe] = useState<number | undefined>(initial?.sessionRpe)
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [error, setError] = useState<string | null>(null)

  const info = MODALITIES.find((m) => m.value === modality)!
  // Guided sessions being edited keep their holds; only the metadata moves
  const guided = editing && (initial.exercises.length > 0 || info.timed)

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
    if (seed.minutes < 1) {
      setError('Minutes must be at least 1.')
      return
    }
    const tempC = seed.tempF != null ? fToC(seed.tempF) : undefined
    const dose =
      tempC !== undefined || seed.rounds
        ? {
            ...(tempC !== undefined && { tempC }),
            ...(seed.rounds && { rounds: seed.rounds }),
          }
        : undefined
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
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">
          {editing ? 'Edit recovery' : 'Log recovery'}
        </h1>
        <button
          onClick={onCancel}
          className="text-[10px] font-semibold uppercase tracking-widest text-ink/45 hover:text-ink"
        >
          Cancel
        </button>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink/55">
          What
        </span>
        <select
          className={inputClass}
          value={modality}
          onChange={(e) => pickModality(e.target.value as Modality)}
        >
          {MODALITIES.filter((m) => !m.timed || guided).map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink/55">
            Minutes
          </span>
          <NumberField
            aria-label="minutes"
            min={1}
            max={600}
            value={seed.minutes}
            onCommit={(n) => setSeed({ ...seed, minutes: n })}
          />
        </label>
        {TEMP_MODALITIES.includes(modality) && (
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-ink/55">
              Temp (°F)
            </span>
            <NumberField
              aria-label="temperature in fahrenheit"
              min={-20}
              max={250}
              value={seed.tempF ?? (modality === 'sauna' ? 170 : 55)}
              onCommit={(n) => setSeed({ ...seed, tempF: n })}
            />
          </label>
        )}
        {ROUND_MODALITIES.includes(modality) && (
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-ink/55">
              Rounds
            </span>
            <NumberField
              aria-label="rounds"
              min={0}
              max={20}
              value={seed.rounds ?? 0}
              onCommit={(n) => setSeed({ ...seed, rounds: n || undefined })}
            />
          </label>
        )}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          className={inputClass}
          placeholder={modalityLabel(modality)}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <input
          className={inputClass}
          type="datetime-local"
          aria-label="start date and time"
          value={start}
          onChange={(e) => setStart(e.target.value)}
        />
      </div>

      {guided && initial && (
        <p className="text-xs text-ink/55">
          {initial.exercises.length} stretches kept
        </p>
      )}

      <div className="flex flex-col gap-2">
        <p className="text-xs text-ink/55">Feel, stiff to loose</p>
        <Segmented
          options={FEEL}
          value={
            feel === undefined
              ? undefined
              : (String(feel) as (typeof FEEL)[number]['value'])
          }
          onChange={(v) => setFeel(Number(v))}
        />
      </div>

      <ScaleRow
        label="Effort"
        low="rest"
        high="max"
        value={rpe}
        onChange={setRpe}
      />

      <textarea
        className={`${inputClass} min-h-16`}
        placeholder="notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />

      {error && <p className="text-sm font-semibold text-accent-700">{error}</p>}

      <div className="flex items-center gap-3">
        <button onClick={save} className={`${buttonClass} flex-1`}>
          {editing ? 'Save changes' : 'Save'}
        </button>
        {editing && onDelete && initial && (
          <button
            onClick={() => {
              if (window.confirm('Delete this recovery session?')) onDelete(initial)
            }}
            className="text-[10px] font-semibold uppercase tracking-widest text-ink/45 hover:text-accent-700"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  )
}
