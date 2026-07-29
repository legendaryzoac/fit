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
    <div className="flex w-full rounded-full border border-neutral-800 p-0.5 text-sm">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-full py-1.5 ${
            value === o.value
              ? 'bg-teal-500/20 font-medium text-teal-200'
              : 'text-neutral-500 hover:text-neutral-300'
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-neutral-950/80 backdrop-blur-sm sm:items-center">
      <div className="max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-neutral-800 bg-neutral-900 p-5 sm:rounded-2xl">
        <h2 className="text-base font-semibold text-neutral-100">
          How did it go?
        </h2>
        <p className="mb-4 mt-1 text-xs text-neutral-500">
          30 seconds of honesty — this steers your next session’s sets and
          weights.
        </p>

        <div className="flex flex-col gap-5">
          {muscles.map((muscle) => (
            <section key={muscle} className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-teal-300">
                {muscle}
              </h3>
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

          <section className="flex flex-col gap-2 border-t border-neutral-800 pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
              whole workout
            </h3>
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
            className="text-sm text-neutral-500 hover:text-neutral-300"
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  )
}
