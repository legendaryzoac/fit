import type { ReactNode } from 'react'

export type StatusTone = 'good' | 'mid' | 'low' | 'effort' | 'rest' | 'neutral'

const TONE: Record<StatusTone, string> = {
  good: 'bg-brand-soft text-brand-strong',
  mid: 'bg-amber-soft text-amber-strong',
  low: 'bg-rose-soft text-rose-strong',
  effort: 'bg-ember-soft text-ember-strong',
  rest: 'bg-sky-soft text-sky-strong',
  neutral: 'bg-surface-2 text-ink-2',
}

/** A small tinted pill; dot adds an 8px marker in the tone's ink. */
export function StatusPill({
  tone = 'neutral',
  dot = false,
  children,
}: {
  tone?: StatusTone
  dot?: boolean
  children: ReactNode
}) {
  return (
    <span
      className={`inline-flex h-7 items-center gap-1.5 rounded-pill px-2.5 text-caption font-semibold ${TONE[tone]}`}
    >
      {dot && (
        <span
          aria-hidden="true"
          className="h-2 w-2 shrink-0 rounded-pill bg-current"
        />
      )}
      {children}
    </span>
  )
}
