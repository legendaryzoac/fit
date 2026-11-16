import { useEffect, useState } from 'react'
import type { RangeStatus } from '../../lib/vitals'

// A reading as a gauge: an open ring that fills toward better, with the
// ideal range tinted at its far end. The arc reaches into the tint when
// the reading is in range, and wears the status colour: brand in range,
// amber fading, rose out.
//
// Every ring has the same outline whatever it shows, so a row of them
// sits evenly. Amber and rose sit close for some colour-blind readers,
// so the status is always spelled out beside the ring as well.

const PX = 96
const STROKE = 9
const R = 43
/** Three quarters of a turn, open at the bottom. */
const SWEEP = 0.75

const TONE: Record<RangeStatus, string> = {
  good: 'var(--brand)',
  fading: 'var(--amber)',
  bad: 'var(--rose)',
}

/** The ideal range: the track, leaning toward the brand colour. */
const IDEAL = 'color-mix(in srgb, var(--brand) 32%, var(--surface-3))'

export function RangeRing({
  label,
  value,
  unit,
  caption,
  status,
  at,
  idealFrom,
}: {
  label: string
  /** The reading as it should be read: "83", "6:01". */
  value: string
  unit: string
  /** The status in words: "In range", "Fading", "Low". */
  caption: string
  /** null while there is no baseline to judge against. */
  status: RangeStatus | null
  /** How far round the gauge the reading reaches, 0 to 1. */
  at: number
  /** Where the ideal range begins; it runs on to the end of the gauge. */
  idealFrom: number | null
}) {
  const [drawn, setDrawn] = useState(false)
  useEffect(() => {
    // Commit the empty ring first, then let the transition carry it up
    const raf = requestAnimationFrame(() => setDrawn(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  const c = 2 * Math.PI * R
  const arc = c * SWEEP
  // A sliver at the very least, so a reading at the low end still shows
  const filled = drawn ? arc * Math.max(0.03, Math.min(1, at)) : 0
  // Round caps reach half a stroke past each end of a dash, so the tint
  // starts that much later to begin where the range does
  const idealStart = idealFrom != null ? arc * idealFrom + STROKE / 2 : arc

  const circle = {
    cx: PX / 2,
    cy: PX / 2,
    r: R,
    fill: 'none',
    strokeWidth: STROKE,
    strokeLinecap: 'round' as const,
  }

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
          <circle {...circle} stroke="var(--surface-3)" strokeDasharray={`${arc} ${c}`} />
          {idealStart < arc && (
            <circle
              {...circle}
              stroke={IDEAL}
              strokeDasharray={`${arc - idealStart} ${c}`}
              strokeDashoffset={-idealStart}
            />
          )}
          <circle
            {...circle}
            stroke={status ? TONE[status] : 'var(--ink-3)'}
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
      <p className="mt-1.5 text-eyebrow text-ink-2">{label}</p>
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
