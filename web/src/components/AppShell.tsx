import { Suspense, lazy, useEffect, useState } from 'react'
import type { Api } from '../lib/api'
import { maybeResumeLockScreen } from '../lib/lockScreen'
import {
  isInSession,
  requestResume,
  subscribeInSession,
} from '../lib/sessionBus'
import { storageKey } from '../lib/storage'
import { fmtSec } from '../lib/templates'
import { loadDraft, loadTimerDraft, timerSnapshot } from '../lib/workouts'
import { Workouts } from './Workouts'
import { PulseMark } from './ui'

// Recharts only loads when someone opens a chart view — keeps the login
// and logger critical path light for first-time (and demo) visitors.
const Recovery = lazy(() =>
  import('./Recovery').then((m) => ({ default: m.Recovery })),
)

const TABS = ['recovery', 'training'] as const
type Tab = (typeof TABS)[number]
const LAND_KEY = 'fit.landTraining'

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
  const [tabChoice, setTabChoice] = useState<Tab | null>(null)
  const [connected, setConnected] = useState<boolean | null>(null)
  const [inSession, setInSession] = useState(false)
  const [liveKind, setLiveKind] = useState<'strength' | 'timer' | null>(null)

  // The resume bar shows whenever a draft is parked but no session is on screen.
  // Bus subscription flips the moment a session opens/closes; the poll catches
  // draft changes (finish/discard) that happen inside the Workouts subtree.
  useEffect(() => subscribeInSession(() => setInSession(isInSession())), [])

  useEffect(() => {
    const check = () => {
      const kind = loadTimerDraft() ? 'timer' : loadDraft() ? 'strength' : null
      setLiveKind(kind)
      // A reload mid-session lands here with a live draft but no gesture —
      // let the lock-screen widget try to come back up if it was on.
      if (kind) maybeResumeLockScreen()
    }
    check()
    const t = setInterval(check, 1000)
    return () => clearInterval(t)
  }, [])

  // Land device-less users on the tab that actually has content for them
  useEffect(() => {
    api
      .get('/api/me')
      .then(async (res) => {
        if (!res.ok) return
        const me = await res.json()
        const isConnected = Boolean(me?.whoop?.connected)
        setConnected(isConnected)
        localStorage.setItem(storageKey(LAND_KEY), isConnected ? '0' : '1')
      })
      .catch(() => {})
  }, [api])

  const tab: Tab =
    tabChoice ??
    ((connected ?? localStorage.getItem(storageKey(LAND_KEY)) !== '1')
      ? 'recovery'
      : 'training')
  const setTab = setTabChoice

  return (
    <div className="min-h-dvh bg-neutral-950 text-neutral-100">
      {/* Sticky so the tab nav stays reachable mid-workout — sessions render
          their own sticky sub-header just below (top-16 offsets). */}
      <header className="sticky top-0 z-40 border-b border-neutral-800/60 bg-neutral-950/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
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
            <button onClick={onSignOut} className="hover:text-neutral-300">
              {demo ? 'Exit demo' : 'Sign out'}
            </button>
          </div>
        </div>
      </header>

      {demo && (
        <p className="mx-auto max-w-3xl px-4 pb-3 text-xs text-amber-300/80">
          Demo mode — everything below is synthetic data, and changes stay in
          this browser only.
        </p>
      )}

      {/* pt-4 keeps page content off the sticky header's border; session
          screens pull their full-bleed timer bars back up with -mt-4 */}
      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 pb-16 pt-4">
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
            className="hover:text-neutral-400"
          >
            source
          </a>
        </p>
      </main>

      {liveKind && !inSession && (
        <ResumeBar
          kind={liveKind}
          onResume={() => {
            setTab('training')
            requestResume()
          }}
        />
      )}
    </div>
  )
}

/**
 * Bottom bar for a session that's live but off-screen. Owns its own
 * once-a-second tick so the timer readout doesn't force the whole shell
 * (and whichever tab is open) to re-render every second.
 */
function ResumeBar({
  kind,
  onResume,
}: {
  kind: 'strength' | 'timer'
  onResume: () => void
}) {
  const [label, setLabel] = useState('')

  useEffect(() => {
    const update = () => {
      if (kind === 'timer') {
        const d = loadTimerDraft()
        if (!d) return
        const snap = timerSnapshot(d, Date.now())
        if (snap.finished) {
          setLabel('Timer done — save your session')
        } else if (snap.stopwatch) {
          setLabel(
            `Live ${d.kind} timer · ${fmtSec(snap.elapsedMs / 1000)}` +
              (d.paused ? ' · paused' : ''),
          )
        } else {
          setLabel(
            `${snap.section?.label ?? 'Work'} ${snap.index + 1}/${d.sections.length}` +
              ` · ${fmtSec(Math.ceil(snap.remainingSec))} left` +
              (d.paused ? ' · paused' : ''),
          )
        }
      } else {
        const d = loadDraft()
        if (!d) return
        const elapsed = (Date.now() - new Date(d.start).getTime()) / 1000
        setLabel(`Live strength · ${fmtSec(elapsed)}`)
      }
    }
    update()
    const t = setInterval(update, 1000)
    return () => clearInterval(t)
  }, [kind])

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-neutral-800/80 bg-neutral-950/95 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-2.5">
        <span className="min-w-0 truncate text-sm tabular-nums text-neutral-200">
          <span className="animate-pulse text-teal-400">● </span>
          {label}
        </span>
        <button
          onClick={onResume}
          className="shrink-0 rounded-lg bg-teal-500 px-4 py-1.5 text-sm font-medium text-neutral-950 hover:bg-teal-400"
        >
          Resume
        </button>
      </div>
    </div>
  )
}
