import { useState } from 'react'
import type {
  DifficultyRating,
  MuscleFeedback,
  VolumeRating,
  WorkoutFeedback,
} from '../lib/workouts'
import { buttonClass } from './ui'

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

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-neutral-900/50 sm:items-center">
      <div className="max-h-[88dvh] w-full max-w-md overflow-y-auto border-2 border-ink bg-paper p-5">
        <h2 className="text-xl font-extrabold tracking-tight text-ink">
          How did it go?
        </h2>
        <p className="mb-4 mt-1 text-xs text-ink/55">
          30 seconds of honesty — this steers your next session’s sets and
          weights.
        </p>

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

        <div className="mt-5 flex items-center gap-3">
          <button
            disabled={!complete}
            onClick={() =>
              onSubmit({
                overall,
                muscles: Object.fromEntries(
                  muscles.map((m) => [m, ratings[m] as MuscleFeedback]),
                ),
              })
            }
            className={`${buttonClass} flex-1`}
          >
            Save
          </button>
          <button
            onClick={onSkip}
            className="text-[10px] font-semibold uppercase tracking-widest text-ink/45 hover:text-ink"
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  )
}
