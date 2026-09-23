import { useRef, useState } from 'react'
import type {
  DifficultyRating,
  MuscleFeedback,
  VolumeRating,
  WorkoutFeedback,
} from '../lib/workouts'
import { Sheet } from './shell/Sheet'

const DIFFICULTY: Array<{ value: DifficultyRating; label: string }> = [
  { value: 'easy', label: 'Too easy' },
  { value: 'right', label: 'Just right' },
  { value: 'hard', label: 'Too hard' },
]

const VOLUME: Array<{ value: VolumeRating; label: string }> = [
  { value: 'low', label: 'Too little' },
  { value: 'right', label: 'Just enough' },
  { value: 'high', label: 'Too much' },
]

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>
  value: T | undefined
  onChange: (v: T) => void
}) {
  return (
    <div className="flex w-full border border-ink/40">
      {options.map((o, i) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`flex-1 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider ${
            i > 0 ? 'border-l border-ink/40 ' : ''
          }${
            value === o.value
              ? 'bg-accent font-extrabold text-paper'
              : 'text-ink/60 hover:bg-ink/5'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/**
 * End-of-session autoregulation check-in, RP style: for every muscle group
 * trained, how hard it felt and how the volume sat — these drive the next
 * session's set and load recommendations.
 */
export function FeedbackModal({
  muscles,
  onSubmit,
  onSkip,
}: {
  muscles: string[]
  onSubmit: (feedback: WorkoutFeedback) => void
  onSkip: () => void
}) {
  const [ratings, setRatings] = useState<
    Record<string, Partial<MuscleFeedback>>
  >({})
  const [overall, setOverall] = useState<DifficultyRating | undefined>()

  const patch = (muscle: string, part: Partial<MuscleFeedback>) =>
    setRatings((prev) => ({
      ...prev,
      [muscle]: { ...prev[muscle], ...part },
    }))

  const complete = muscles.every(
    (m) => ratings[m]?.difficulty && ratings[m]?.volume,
  )

  // Save and Skip both unmount this screen in the parent, so the sheet
  // is dropped first and the real callback waits for the exit to finish.
  const [open, setOpen] = useState(true)
  const pending = useRef<(() => void) | null>(null)
  const dismiss = (then: () => void) => {
    if (pending.current) return
    pending.current = then
    setOpen(false)
  }

  return (
    <Sheet
      open={open}
      onClose={() => dismiss(onSkip)}
      onExited={() => pending.current?.()}
      title="How did it go?"
    >
      <div className="flex flex-col gap-5">
        {muscles.map((muscle) => (
          <section key={muscle} className="flex flex-col gap-2">
            <h3 className="kicker">{muscle}</h3>
            <Segmented
              options={DIFFICULTY}
              value={ratings[muscle]?.difficulty}
              onChange={(v) => patch(muscle, { difficulty: v })}
            />
            <Segmented
              options={VOLUME}
              value={ratings[muscle]?.volume}
              onChange={(v) => patch(muscle, { volume: v })}
            />
          </section>
        ))}

        <section className="flex flex-col gap-2 border-t-2 border-ink/40 pt-2.5">
          <h3 className="kicker-muted">whole workout</h3>
          <Segmented
            options={DIFFICULTY}
            value={overall}
            onChange={setOverall}
          />
        </section>
      </div>

      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          disabled={!complete}
          onClick={() =>
            dismiss(() =>
              onSubmit({
                overall,
                muscles: Object.fromEntries(
                  muscles.map((m) => [m, ratings[m] as MuscleFeedback]),
                ),
              }),
            )
          }
          className="pressable flex h-touch flex-1 items-center justify-center rounded-pill bg-brand px-5 text-body font-semibold text-on-brand disabled:opacity-45"
        >
          Save
        </button>
        <button
          type="button"
          onClick={() => dismiss(onSkip)}
          className="pressable flex h-touch items-center justify-center rounded-pill px-4 text-body font-semibold text-ink-2 hover:bg-surface-2"
        >
          Skip
        </button>
      </div>
    </Sheet>
  )
}
