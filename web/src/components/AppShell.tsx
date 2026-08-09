import { Suspense, lazy, useEffect, useState } from 'react'
import type { Api } from '../lib/api'
import { maybeResumeLockScreen } from '../lib/lockScreen'
import {
  isInSession,
  isOverlay,
  requestResume,
  subscribeInSession,
  subscribeOverlay,
} from '../lib/sessionBus'
import { fmtSec } from '../lib/templates'
import { loadDraft, loadTimerDraft, timerSnapshot } from '../lib/workouts'
import { Workouts, type WorkoutsTab } from './Workouts'

// Recharts only loads when someone opens a chart view — keeps the login
// and logger critical path light for first-time (and demo) visitors.
const Recovery = lazy(() =>
  import('./Recovery').then((m) => ({ default: m.Recovery })),
)

const TABS = ['today', 'history', 'plan', 'progress', 'recovery'] as const
type Tab = (typeof TABS)[number]

function headerDate(): string {
  const d = new Date()
  const wd = d.toLocaleDateString(undefined, { weekday: 'short' })
  const md = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return `${wd} · ${md}`.toUpperCase()
}

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
  // The WHOOP OAuth redirect (?whoop=connected|error) must land where its
  // result banner lives — Recovery — instead of the usual Today landing.
  const [tab, setTab] = useState<Tab>(() =>
    new URLSearchParams(window.location.search).has('whoop')
      ? 'recovery'
      : 'today',
  )
  const [inSession, setInSession] = useState(false)
  const [overlay, setOverlay] = useState(false)
  const [liveKind, setLiveKind] = useState<'strength' | 'timer' | null>(null)

  // The resume bar shows whenever a draft is parked but no session is on
  // screen. Bus subscriptions flip the moment a flow opens/closes; the
  // poll catches draft changes that happen inside the Workouts subtree.
  // Seed AFTER subscribing: on a reload with a live draft, Workouts'
  // child effect sets the bus before these parent effects run, so the
  // initial useState(false) is already stale by the time we get here.
  useEffect(() => {
    const un = subscribeInSession(() => setInSession(isInSession()))
    setInSession(isInSession())
    return un
  }, [])
  useEffect(() => {
    const un = subscribeOverlay(() => setOverlay(isOverlay()))
    setOverlay(isOverlay())
    return un
  }, [])

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

  return (
    <div className="min-h-dvh bg-paper text-ink">
      {/* Sticky brand bar; session sub-headers tuck under it at
          top-[58px] = h-14 content + the 2px rule. */}
      <header className="sticky top-0 z-40 border-b-2 border-ink/40 bg-paper">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="h-2.5 w-2.5 bg-accent" />
            <span className="text-base font-extrabold tracking-wide">FIT</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-semibold tracking-widest text-ink/55">
              {headerDate()}
            </span>
            {demo && (
              <span className="bg-accent-200 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-accent-800">
                demo
              </span>
            )}
            <button
              onClick={onSignOut}
              title={demo ? 'Exit demo' : `Sign out ${email}`}
              className="text-[10px] font-semibold uppercase tracking-widest text-ink/45 hover:text-ink"
            >
              {demo ? 'Exit' : 'Sign out'}
            </button>
          </div>
        </div>
      </header>

      {demo && (
        <p className="mx-auto max-w-3xl px-4 pb-1 pt-2 text-xs text-ink/55">
          Demo mode — everything below is synthetic data, and changes stay in
          this browser only.
        </p>
      )}

      {/* pt-4 keeps page content off the header rule; session screens pull
          their full-bleed bars back up with -mt-4. pb clears the tab bar. */}
      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 pb-28 pt-4">
        <Suspense
          fallback={
            <p className="py-12 text-center text-sm text-ink/45">Loading…</p>
          }
        >
          {tab === 'recovery' ? (
            <Recovery api={api} />
          ) : (
            <Workouts api={api} tab={tab as WorkoutsTab} />
          )}
        </Suspense>
        <p className="pt-4 text-center text-[10px] font-semibold uppercase tracking-widest text-ink/35">
          fit — a zackwithers.com project ·{' '}
          <a
            href="https://github.com/legendaryzoac/fit"
            className="hover:text-ink/60"
          >
            source
          </a>
        </p>
      </main>

      {liveKind && !inSession && (
        <ResumeBar
          kind={liveKind}
          navVisible={!overlay}
          onResume={() => {
            setTab('today')
            requestResume()
          }}
        />
      )}

      {/* Full-screen flows (live session, wizards) own the whole viewport —
          the tab bar yields to their action bars. */}
      {!overlay && (
        <nav className="fixed inset-x-0 bottom-0 z-30 border-t-2 border-ink/40 bg-paper pb-[env(safe-area-inset-bottom)]">
          {/* fixed h-12 so the resume bar can sit flush at bottom-12 */}
          <div className="mx-auto grid h-12 max-w-3xl grid-cols-5">
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex items-center justify-center text-[9.5px] uppercase tracking-wider ${
                  tab === t
                    ? 'font-extrabold text-accent-700 shadow-[inset_0_3px_0_#ec3013]'
                    : 'font-semibold text-ink/50 hover:text-ink'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </nav>
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
  navVisible,
  onResume,
}: {
  kind: 'strength' | 'timer'
  navVisible: boolean
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
    <div
      className={`fixed inset-x-0 z-30 border-t-2 border-ink/40 bg-paper ${
        navVisible
          ? 'bottom-[calc(3rem+env(safe-area-inset-bottom))]'
          : 'bottom-0 pb-[env(safe-area-inset-bottom)]'
      }`}
    >
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-2">
        <span className="min-w-0 truncate text-sm font-semibold tabular-nums text-ink">
          <span className="mr-1.5 inline-block h-2 w-2 animate-pulse bg-accent" />
          {label}
        </span>
        <button
          onClick={onResume}
          className="shrink-0 bg-accent px-4 py-1.5 text-sm font-extrabold text-paper hover:bg-accent-600"
        >
          Resume
        </button>
      </div>
    </div>
  )
}
