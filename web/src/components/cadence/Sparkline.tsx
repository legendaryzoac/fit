export type SparkTone = 'brand' | 'effort' | 'rest'

const TONE: Record<SparkTone, string> = {
  brand: 'var(--brand)',
  effort: 'var(--ember)',
  rest: 'var(--sky)',
}

const W = 120
const H = 40
const PAD = 3

/** A small trend line with a soft area under it and a dot on the last point. */
export function Sparkline({
  values,
  tone = 'brand',
  height = 40,
}: {
  values: number[]
  tone?: SparkTone
  height?: number
}) {
  if (values.length < 2) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = Math.max(1e-9, max - min)
  const x = (i: number) => PAD + (i / (values.length - 1)) * (W - PAD * 2)
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - PAD * 2)
  const pts = values.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`)
  const area = `M${x(0).toFixed(2)},${H} L${pts.join(' L')} L${x(values.length - 1).toFixed(2)},${H} Z`
  const colour = TONE[tone]
  const last = values[values.length - 1]

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      width="100%"
      height={height}
      aria-hidden="true"
      className="block"
    >
      <path d={area} fill={colour} fillOpacity={0.12} />
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke={colour}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx={x(values.length - 1)}
        cy={y(last)}
        r={3}
        fill={colour}
      />
    </svg>
  )
}
