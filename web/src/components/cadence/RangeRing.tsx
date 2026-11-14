import { useEffect, useState } from 'react'
import type { RangeStatus } from '../../lib/vitals'

// A reading as a gauge: an open ring whose arc runs from the low end of
// the scale to the value, with a thin outer bracket marking the ideal
// range. The arc ends inside the bracket when the reading is in range,
// and wears the status colour: brand in range, amber fading, rose out.
//
// Amber and rose sit close for some colour-blind readers, so the status
// is always spelled out beside the ring as well.

const PX = 96
const STROKE = 8
const R = 36
/** The ideal-range bracket, just outside the ring. */
const BRACKET_STROKE = 3
const BRACKET_R = 45
/** Three quarters of a turn, open at the bottom. */
const SWEEP = 0.75

const TONE: Record<RangeStatus, string> = {
  good: 'var(--brand)',
  fading: 'var(--amber)',
  bad: 'var(--rose)',
}

export function RangeRing({
  label,
  value,
  unit,
  caption,
  status,
  at,
  ideal,
}: {
  label: string
  /** The reading as it should be read: "83", "6:01". */
  value: string
  unit: string
  /** The status in words: "In range", "Fading", "Low". */
  caption: string
  /** null while there is no baseline to judge against. */
  status: RangeStatus | null
  /** Where the value sits along the gauge, 0 to 1. */
  at: number
  /** The ideal range along the gauge, 0 to 1 at each end. */
  ideal: [number, number] | null
}) {
  const [drawn, setDrawn] = useState(false)
  useEffect(() => {
    // Commit the empty ring first, then let the transition carry it up
    const raf = requestAnimationFrame(() => setDrawn(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  const c = 2 * Math.PI * R
  const arc = c * SWEEP
  const bracketC = 2 * Math.PI * BRACKET_R
  const bracketArc = bracketC * SWEEP
  // A sliver at the very least, so a reading at the low end still shows
  const filled = drawn ? arc * Math.max(0.03, Math.min(1, at)) : 0

  return (
    <div className="flex min-w-0 flex-col items-center text-center">
      <div
        role="img"
        aria-label={`${label} ${value} ${unit}, ${caption}`}
        // Full size where there is room; three abreast on a narrow phone
        // they shrink with their column rather than overlap
        className="relative aspect-square w-full"
        style={{ maxWidth: PX }}
      >
        <svg
          viewBox={`0 0 ${PX} ${PX}`}
          width="100%"
          height="100%"
          aria-hidden="true"
          // A circle's stroke starts at three o'clock; turned to start at
          // the lower left, three quarters of it ends at the lower right
          style={{ transform: 'rotate(135deg)' }}
        >
          <circle
            cx={PX / 2}
            cy={PX / 2}
            r={R}
            fill="none"
            stroke="var(--surface-3)"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${arc} ${c}`}
          />
          {ideal && (
            <circle
              cx={PX / 2}
              cy={PX / 2}
              r={BRACKET_R}
              fill="none"
              stroke="var(--brand)"
              strokeWidth={BRACKET_STROKE}
              strokeLinecap="round"
              strokeDasharray={`${bracketArc * (ideal[1] - ideal[0])} ${bracketC}`}
              strokeDashoffset={-bracketArc * ideal[0]}
            />
          )}
          <circle
            cx={PX / 2}
            cy={PX / 2}
            r={R}
            fill="none"
            stroke={status ? TONE[status] : 'var(--ink-3)'}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${filled} ${c}`}
            style={{ transition: 'stroke-dasharray 600ms var(--ease-out)' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {/* Eases down on a narrow phone so "6:01" clears the arc */}
          <span
            className="text-numeric-lg text-ink"
            style={{ fontSize: 'clamp(16px, 5.4vw, 22px)' }}
          >
            {value}
          </span>
          <span className="-mt-0.5 text-caption font-semibold text-ink-2">{unit}</span>
        </div>
      </div>
      <p className="mt-1 text-eyebrow text-ink-2">{label}</p>
      <p className="flex items-center gap-1 text-caption text-ink-3">
        {status && (
          <span
            aria-hidden="true"
            className="inline-block size-1.5 rounded-full"
            style={{ background: TONE[status] }}
          />
        )}
        {caption}
      </p>
    </div>
  )
}
