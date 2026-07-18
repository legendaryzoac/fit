import { useState } from 'react'

export function PulseMark({ className = 'h-14 w-14' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect width="64" height="64" rx="14" className="fill-neutral-900" />
      <polyline
        points="8,34 20,34 26,20 34,46 40,28 44,34 56,34"
        fill="none"
        stroke="#2dd4bf"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-neutral-950 px-6 text-neutral-100">
      <PulseMark />
      <h1 className="text-5xl font-semibold tracking-tight">fit</h1>
      {children}
      <footer className="fixed bottom-6 text-xs text-neutral-600">
        a zackwithers.com project
      </footer>
    </main>
  )
}

export const inputClass =
  'w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm ' +
  'text-neutral-100 placeholder-neutral-500 outline-none focus:border-teal-500'

// Width intentionally unset — callers add w-full/flex-1 where needed
// (mixing w-full here with a w-auto override loses to stylesheet order)
export const buttonClass =
  'rounded-lg bg-teal-500 px-4 py-2 text-sm font-medium text-neutral-950 ' +
  'hover:bg-teal-400 disabled:opacity-50'

/**
 * Number input that's pleasant to edit on a phone: while focused it holds
 * whatever string the user has typed (including empty), committing only
 * values that parse; on exit an empty/invalid field falls back to the last
 * committed value instead of snapping to 0/1 mid-edit.
 */
export function NumberField({
  value,
  onCommit,
  min,
  max,
  className = inputClass,
  'aria-label': ariaLabel,
}: {
  value: number
  onCommit: (n: number) => void
  min?: number
  max?: number
  className?: string
  'aria-label'?: string
}) {
  const [draft, setDraft] = useState<string | null>(null)

  return (
    <input
      className={className}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      aria-label={ariaLabel}
      value={draft ?? value}
      onChange={(e) => {
        const raw = e.target.value
        setDraft(raw)
        const n = Math.round(Number(raw))
        if (raw.trim() === '' || !Number.isFinite(n)) return
        onCommit(
          Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n)),
        )
      }}
      onBlur={() => setDraft(null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
    />
  )
}

// Compact bordered control for header actions — a visible button, not a
// bare glyph (gym thumbs need an obvious target). Horizontal padding
// intentionally unset — callers add px-3 (labeled) or sizing (icon-only);
// baking in px-3 here would win or lose against overrides by stylesheet
// order, not by intent.
export const iconButtonClass =
  'flex items-center gap-1.5 rounded-lg border border-neutral-700 py-1.5 ' +
  'text-sm text-neutral-300 hover:border-neutral-500 hover:text-neutral-100'

const iconStroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

export function ChevronDownIcon({ className = 'h-3.5 w-3.5' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <polyline points="5,9 12,16 19,9" {...iconStroke} />
    </svg>
  )
}

export function ChevronLeftIcon({ className = 'h-3.5 w-3.5' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <polyline points="15,5 8,12 15,19" {...iconStroke} />
    </svg>
  )
}

export function XIcon({ className = 'h-3.5 w-3.5' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M6 6 L18 18 M18 6 L6 18" {...iconStroke} />
    </svg>
  )
}

export function Card({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-neutral-800/60 bg-neutral-900/60 p-4">
      <div className="mb-3">
        <h2 className="text-sm font-medium text-neutral-200">{title}</h2>
        {subtitle && <p className="text-xs text-neutral-500">{subtitle}</p>}
      </div>
      {children}
    </section>
  )
}
