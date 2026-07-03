import { Suspense, lazy, useState } from 'react'
import type { Api } from '../lib/api'
import { Workouts } from './Workouts'
import { PulseMark } from './ui'

// Recharts only loads when someone opens a chart view — keeps the login
// and logger critical path light for first-time (and demo) visitors.
const Recovery = lazy(() =>
  import('./Recovery').then((m) => ({ default: m.Recovery })),
)

const TABS = ['recovery', 'training'] as const

export function AppShell({
  api,
  email,
  demo = false,
  onSignOut,
}: {
  api: Api
  email: string
  demo?: boolean
  onSignOut: () => void
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]>('recovery')

  return (
    <div className="min-h-dvh bg-neutral-950 text-neutral-100">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
        <div className="flex items-center gap-3">
          <PulseMark className="h-8 w-8" />
          <nav className="flex gap-1">
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded-full px-3 py-1 text-sm capitalize ${
                  tab === t
                    ? 'bg-neutral-800 text-neutral-100'
                    : 'text-neutral-500 hover:text-neutral-300'
                }`}
              >
                {t}
              </button>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3 text-xs text-neutral-500">
          {demo ? (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-medium text-amber-300">
              demo
            </span>
          ) : (
            <span className="hidden sm:inline">{email}</span>
          )}
          <button
            onClick={onSignOut}
            className="underline-offset-4 hover:text-neutral-300 hover:underline"
          >
            {demo ? 'Exit demo' : 'Sign out'}
          </button>
        </div>
      </header>

      {demo && (
        <p className="mx-auto max-w-3xl px-4 pb-3 text-xs text-amber-300/80">
          Demo mode — everything below is synthetic data, and changes stay in
          this browser only.
        </p>
      )}

      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 pb-16">
        <Suspense
          fallback={
            <p className="py-12 text-center text-sm text-neutral-600">
              Loading…
            </p>
          }
        >
          {tab === 'recovery' ? <Recovery api={api} /> : <Workouts api={api} />}
        </Suspense>
        <p className="pt-4 text-center text-xs text-neutral-700">
          fit — a zackwithers.com project ·{' '}
          <a
            href="https://github.com/legendaryzoac/fit"
            className="underline-offset-4 hover:text-neutral-400 hover:underline"
          >
            source
          </a>
        </p>
      </main>
    </div>
  )
}
