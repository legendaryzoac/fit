import { useState } from 'react'
import type {
  DifficultyRating,
  MuscleFeedback,
  VolumeRating,
  WorkoutFeedback,
} from '../lib/workouts'
import { Button } from './cadence/Button'
import { Segment } from './shell/Segment'
import { Sheet } from './shell/Sheet'
import { useSheetDismiss } from './shell/useSheetDismiss'

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

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

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
  const { open, dismiss, onExited } = useSheetDismiss()

  return (
    <Sheet
      open={open}
      onClose={() => dismiss(onSkip)}
      onExited={onExited}
      title="How did it go?"
    >
      <div className="flex flex-col gap-4">
        {muscles.map((muscle) => (
          <section key={muscle} className="flex flex-col gap-2">
            <h3 className="text-caption font-semibold text-ink-2">
              {capitalise(muscle)}
            </h3>
            <Segment
              block
              options={DIFFICULTY}
              value={ratings[muscle]?.difficulty}
              onChange={(v) => patch(muscle, { difficulty: v })}
              ariaLabel={`${capitalise(muscle)} difficulty`}
            />
            <Segment
              block
              options={VOLUME}
              value={ratings[muscle]?.volume}
              onChange={(v) => patch(muscle, { volume: v })}
              ariaLabel={`${capitalise(muscle)} volume`}
            />
          </section>
        ))}

        <section className="flex flex-col gap-2">
          <h3 className="text-caption font-semibold text-ink-2">
            Whole workout
          </h3>
          <Segment
            block
            options={DIFFICULTY}
            value={overall}
            onChange={setOverall}
            ariaLabel="Whole workout"
          />
        </section>
      </div>

      <div className="mt-6 flex items-center gap-3">
        <Button
          variant="primary"
          className="flex-1"
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
        >
          Save
        </Button>
        <Button variant="ghost" onClick={() => dismiss(onSkip)}>
          Skip
        </Button>
      </div>
    </Sheet>
  )
}
