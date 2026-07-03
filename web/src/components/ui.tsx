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
