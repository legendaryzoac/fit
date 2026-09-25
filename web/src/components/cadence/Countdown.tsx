import type { ReactNode } from 'react'
import { Button } from './Button'
import { Card } from './Card'
import { RING_GEOMETRY } from './RecoveryRing'
import { StatusPill, type StatusTone } from './StatusPill'

export type CountdownTone = 'effort' | 'rest' | 'caution' | 'neutral' | 'calm'

const PILL: Record<CountdownTone, StatusTone> = {
  effort: 'effort',
  rest: 'rest',
  caution: 'mid',
  neutral: 'neutral',
  calm: 'mid',
}

const ARC: Record<CountdownTone, string> = {
  effort: 'var(--ember)',
  rest: 'var(--sky)',
  caution: 'var(--amber)',
  neutral: 'var(--ink-3)',
  calm: 'var(--amber)',
}

/**
 * The running section: its pill, a ring that empties as the section
 * runs down (full and brand for a stopwatch), the time, what comes next
 * and the controls. The ring uses the xl RecoveryRing geometry; its arc
 * follows the clock with a short linear transition rather than the
 * first-mount draw.
 */
export function Countdown({
  label,
  tone,
  time,
  note,
  next,
  remaining = 1,
  paused,
  onPause,
  onResume,
  onSkip,
  onEnd,
  stopwatch = false,
}: {
  label: string
  tone: CountdownTone
  time: string
  /** Side label and cue lines, centred between the time and the next line. */
  note?: ReactNode
  next?: string
  /** Fraction of the section still to run, 0–1. */
  remaining?: number
  paused: boolean
  onPause: () => void
  onResume: () => void
  onSkip?: () => void
  onEnd?: () => void
  stopwatch?: boolean
}) {
  const { px, stroke, r } = RING_GEOMETRY.xl
  const c = 2 * Math.PI * r
  const fraction = stopwatch ? 1 : Math.max(0, Math.min(1, remaining))
  const offset = c * (1 - fraction)

  return (
    <Card>
      <div className="flex flex-col items-center gap-4">
        {paused ? (
          <StatusPill tone="neutral" dot>
            Paused
          </StatusPill>
        ) : (
          <StatusPill tone={stopwatch ? 'good' : PILL[tone]} dot>
            {label}
          </StatusPill>
        )}

        <div
          className="relative shrink-0"
          style={{ width: px, height: px }}
          role="timer"
          aria-label={`${label} ${time}`}
        >
          <svg
            viewBox={`0 0 ${px} ${px}`}
            width={px}
            height={px}
            className="-rotate-90"
            aria-hidden="true"
          >
            <circle
              cx={px / 2}
              cy={px / 2}
              r={r}
              fill="none"
              stroke="var(--surface-3)"
              strokeWidth={stroke}
            />
            <circle
              cx={px / 2}
              cy={px / 2}
              r={r}
              fill="none"
              stroke={stopwatch ? 'var(--brand)' : ARC[tone]}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={c}
              strokeDashoffset={offset}
              style={{ transition: 'stroke-dashoffset 250ms linear' }}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[44px] leading-[48px] font-semibold tracking-[-0.02em] text-ink tabular-nums">
              {time}
            </span>
          </div>
        </div>

        {note && <div className="max-w-sm px-2 text-center">{note}</div>}

        {!stopwatch && (
          <p className="text-body text-ink-2">{next ?? 'Last section'}</p>
        )}

        <div className="flex w-full max-w-[360px] items-center gap-2">
          <Button
            variant="primary"
            className="flex-1"
            onClick={paused ? onResume : onPause}
          >
            {paused ? 'Resume' : 'Pause'}
          </Button>
          {onSkip && (
            <Button variant="quiet" onClick={onSkip}>
              Skip
            </Button>
          )}
          {onEnd && (
            <Button variant="ghost" onClick={onEnd}>
              End
            </Button>
          )}
        </div>
      </div>
    </Card>
  )
}
