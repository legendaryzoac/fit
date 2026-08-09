import { useState } from 'react'

/** The Modernist mark: a geometric barbell — red plates on an ink bar.
 * Pairs with the FIT wordmark. */
export function PulseMark({ className = 'h-10 w-10' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect x="4" y="29" width="56" height="6" fill="#201e1d" />
      <rect x="10" y="16" width="9" height="32" fill="#ec3013" />
      <rect x="21" y="22" width="6" height="20" fill="#201e1d" />
      <rect x="45" y="16" width="9" height="32" fill="#ec3013" />
      <rect x="37" y="22" width="6" height="20" fill="#201e1d" />
    </svg>
  )
}

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-paper px-6 text-ink">
      <div className="flex items-center gap-3">
        <PulseMark className="h-12 w-12" />
        <h1 className="text-5xl font-extrabold tracking-tight">FIT</h1>
      </div>
      {children}
      <footer className="fixed bottom-6 text-xs font-semibold uppercase tracking-widest text-ink/40">
        a zackwithers.com project
      </footer>
    </main>
  )
}

export const inputClass =
  'w-full border border-ink/40 bg-surface px-3 py-2 text-sm text-ink ' +
  'placeholder:text-ink/35 outline-none hover:border-ink/60 focus:border-accent'

// Width intentionally unset — callers add w-full/flex-1 where needed
// (mixing w-full here with a w-auto override loses to stylesheet order)
export const buttonClass =
  'inline-flex items-center justify-center gap-1.5 bg-accent px-4 py-2.5 ' +
  'text-sm font-extrabold text-paper hover:bg-accent-600 active:bg-accent-700 ' +
  'disabled:opacity-45'

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
// intentionally unset — callers add px-3 (labeled) or sizing (icon-only).
export const iconButtonClass =
  'flex items-center gap-1.5 border border-ink/40 py-1.5 text-sm ' +
  'font-semibold text-ink hover:bg-ink/5 active:bg-ink/10'

const iconStroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.5,
  strokeLinecap: 'square',
  strokeLinejoin: 'miter',
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

/**
 * Ruled section — the Modernist replacement for the boxed card: a 2px
 * ink rule on top, red uppercase kicker title, content below. Same props
 * API as the old Card so call sites don't change shape.
 */
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
    <section className="border-t-2 border-ink/40 pt-2.5">
      <div className="mb-2.5">
        <h2 className="kicker">{title}</h2>
        {subtitle && (
          <p className="mt-0.5 text-xs font-semibold text-ink/50">
            {subtitle}
          </p>
        )}
      </div>
      {children}
    </section>
  )
}
