import type { ReactNode } from 'react'

/** A surface card; hero lifts it with a larger radius and a shadow. */
export function Card({
  hero = false,
  className = '',
  children,
}: {
  hero?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <section
      className={`bg-surface p-5 ${hero ? 'rounded-xl shadow-lift' : 'rounded-lg'} ${className}`}
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
