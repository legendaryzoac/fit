import type { ReactNode } from 'react'

export type CardTone = 'surface' | 'brand'

const TONE: Record<CardTone, string> = {
  surface: 'bg-surface',
  brand: 'bg-brand-soft text-brand-strong',
}

/** A surface card; hero lifts it with a larger radius and a shadow.
 * Brand tints it for a coach note or a highlight. */
export function Card({
  hero = false,
  tone = 'surface',
  className = '',
  children,
}: {
  hero?: boolean
  tone?: CardTone
  className?: string
  children: ReactNode
}) {
  return (
    <section
      className={`p-5 ${TONE[tone]} ${hero ? 'rounded-xl shadow-lift' : 'rounded-lg'} ${className}`}
    >
      {children}
    </section>
  )
}

/** A card's head row: title on the left, an optional action on the right. */
export function CardHead({
  title,
  action,
}: {
  title: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-title text-ink">{title}</h2>
      {action}
    </div>
  )
}
