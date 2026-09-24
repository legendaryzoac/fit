import { useEffect, useState } from 'react'

export type RingSize = 'lg' | 'sm' | 'xl'

const GEOMETRY: Record<RingSize, { px: number; stroke: number; r: number }> =
  {
    sm: { px: 44, stroke: 5, r: 19.5 },
    lg: { px: 120, stroke: 10, r: 55 },
    xl: { px: 160, stroke: 8, r: 76 },
  }

function toneVar(score: number): string {
  if (score >= 67) return 'var(--brand)'
  if (score >= 34) return 'var(--amber)'
  return 'var(--rose)'
}

/**
 * A recovery score as a ring. The value arc draws in from empty over
 * 600ms on first mount; index.css zeroes transition durations under
 * prefers-reduced-motion, so the arc simply appears there.
 */
export function RecoveryRing({
  score,
  size = 'lg',
}: {
  score: number
  size?: RingSize
}) {
  const { px, stroke, r } = GEOMETRY[size]
  const c = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(100, score))
  const [drawn, setDrawn] = useState(false)
  useEffect(() => {
    // Commit the empty ring first, then let the transition carry it up.
    const raf = requestAnimationFrame(() => setDrawn(true))
    return () => cancelAnimationFrame(raf)
  }, [])
  const offset = drawn ? c * (1 - clamped / 100) : c
  const rounded = Math.round(clamped)

  return (
    <div
      role="img"
      aria-label={`Recovery ${rounded} percent`}
      className="relative shrink-0"
      style={{ width: px, height: px }}
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
          stroke={toneVar(clamped)}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{
            transition: 'stroke-dashoffset 600ms var(--ease-out)',
          }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        {size === 'sm' ? (
          <span className="text-body font-semibold text-ink">{rounded}</span>
        ) : (
          <span className="flex items-baseline gap-0.5">
            <span className="text-display-lg text-ink">{rounded}</span>
            <span className="text-title-sm text-ink-2">%</span>
          </span>
        )}
      </div>
    </div>
  )
}
