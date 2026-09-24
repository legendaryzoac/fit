import type { ReactNode } from 'react'

export type BannerTone = 'info' | 'caution' | 'error'

const TONE: Record<BannerTone, string> = {
  info: 'bg-surface-2 text-ink-2 [&_b]:font-semibold [&_b]:text-ink',
  caution: 'bg-amber-soft text-amber-strong',
  error: 'bg-rose-soft text-rose-strong',
}

/** A tinted notice row. Info keeps a <b> inside in primary ink. */
export function Banner({
  tone = 'info',
  children,
}: {
  tone?: BannerTone
  children: ReactNode
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : undefined}
      className={`flex items-start gap-3 rounded-md px-4 py-3 text-[14px] leading-5 ${TONE[tone]}`}
    >
      {children}
    </div>
  )
}
