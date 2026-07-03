import { useMemo, useState } from 'react'
import type { CognitoUserSession } from 'amazon-cognito-identity-js'
import { makeApi } from '../lib/api'
import { Recovery } from './Recovery'
import { Workouts } from './Workouts'
import { PulseMark } from './ui'

const TABS = ['recovery', 'training'] as const

export function AppShell({
  session,
  onSignOut,
}: {
  session: CognitoUserSession
  onSignOut: () => void
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]>('recovery')
  const api = useMemo(
    () => makeApi(session.getAccessToken().getJwtToken()),
    [session],
  )
  const email = session.getIdToken().payload.email as string

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
          <span className="hidden sm:inline">{email}</span>
          <button
            onClick={onSignOut}
            className="underline-offset-4 hover:text-neutral-300 hover:underline"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 pb-16">
        {tab === 'recovery' ? <Recovery api={api} /> : <Workouts api={api} />}
        <p className="pt-4 text-center text-xs text-neutral-700">
          M5 · training analytics
        </p>
      </main>
    </div>
  )
}
