import { Suspense, lazy, useEffect, useRef, useState } from 'react'
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
import {
  loadDraft,
  loadTimerDraft,
  saveTimerDraft,
  skipSection,
  timerSnapshot,
} from '../lib/workouts'
import { Banner } from './cadence/Banner'
import { Chips } from './shell/Chips'
import {
  Dock,
  type DockLive,
  type DockMode,
  type DockTab,
  type DockTimer,
  type TimerTone,
} from './shell/Dock'
import { SettingsSheet } from './shell/SettingsSheet'
import { TopBar } from './shell/TopBar'
import { Workouts, type WorkoutsTab } from './Workouts'

// Recharts only loads when someone opens a chart view — keeps the login
// and logger critical path light for first-time (and demo) visitors.
const Recovery = lazy(() =>
  import('./Recovery').then((m) => ({ default: m.Recovery })),
)

type Tab = DockTab
type TrendsView = 'strength' | 'recovery'

const TRENDS: Array<{ value: TrendsView; label: string }> = [
  { value: 'strength', label: 'Strength' },
  { value: 'recovery', label: 'Recovery' },
]

const WORKOUTS_TAB: Record<Exclude<Tab, 'trends'>, WorkoutsTab> = {
  today: 'today',
  log: 'history',
  plan: 'plan',
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
  // result banner lives — Recovery, under Trends — instead of Today.
  const [whoopLanding] = useState(() =>
    new URLSearchParams(window.location.search).has('whoop'),
  )
  const [tab, setTab] = useState<Tab>(whoopLanding ? 'trends' : 'today')
  const [trendsView, setTrendsView] = useState<TrendsView>(
    whoopLanding ? 'recovery' : 'strength',
  )
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Tab switches crossfade the content in; reduced motion skips it.
  const contentRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = contentRef.current
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return
    }
    const anim = el.animate(
      [
        { opacity: 0, transform: 'translateY(4px)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: 200, easing: 'cubic-bezier(.2,0,0,1)' },
    )
    return () => anim.cancel()
  }, [tab])

  const showRecovery = tab === 'trends' && trendsView === 'recovery'
  const workoutsTab: WorkoutsTab =
    tab === 'trends' ? 'progress' : WORKOUTS_TAB[tab]

  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <TopBar demo={demo} onSettings={() => setSettingsOpen(true)} />

      <main className="mx-auto flex max-w-column flex-col gap-4 px-gutter pt-3 pb-[calc(88px+env(safe-area-inset-bottom))]">
        {demo && (
          <Banner tone="info">Demo. Changes stay in this browser.</Banner>
        )}

        <div ref={contentRef} className="flex flex-col gap-4">
          {tab === 'trends' && (
            <Chips
              options={TRENDS}
              value={trendsView}
              onChange={setTrendsView}
              ariaLabel="Trends"
            />
          )}
          <Suspense
            fallback={
              <p className="py-12 text-center text-body text-ink-3">Loading</p>
            }
          >
            {/* One Workouts instance stays mounted across today, log, plan
                and strength trends so drafts and caches survive tab hops. */}
            {showRecovery ? (
              <Recovery api={api} />
            ) : (
              <Workouts api={api} tab={workoutsTab} />
            )}
          </Suspense>
        </div>
      </main>

      <ShellDock
        tab={tab}
        onTab={setTab}
        onOpen={() => {
          setTab('today')
          requestResume()
        }}
      />

      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        demo={demo}
        email={email}
        onSignOut={onSignOut}
      />
    </div>
  )
}

function toneFor(label: string): TimerTone {
  const l = label.toLowerCase()
  if (l.includes('work')) return 'effort'
  if (l.includes('rest')) return 'rest'
  if (l.includes('warm')) return 'caution'
  return 'neutral'
}

function togglePause(): void {
  const d = loadTimerDraft()
  if (!d || timerSnapshot(d, Date.now()).finished) return
  saveTimerDraft(
    d.paused
      ? {
          ...d,
          paused: false,
          startEpoch: Date.now(),
          skipOffsetMs: d.pausedElapsedMs,
        }
      : {
          ...d,
          paused: true,
          pausedElapsedMs: Date.now() - d.startEpoch + d.skipOffsetMs,
        },
  )
}

function skip(): void {
  const d = loadTimerDraft()
  if (!d) return
  saveTimerDraft(skipSection(d, Date.now()))
}

/**
 * The dock plus the state that picks its face. Owns the once-a-second
 * draft poll so the timer readout never re-renders the whole shell (and
 * whichever tab is open). Bus subscriptions flip the moment a flow
 * opens/closes; the poll catches draft changes inside the Workouts subtree.
 * Seed AFTER subscribing: on a reload with a live draft, Workouts' child
 * effect sets the bus before these effects run, so the initial state is
 * already stale by the time we get here.
 */
function ShellDock({
  tab,
  onTab,
  onOpen,
}: {
  tab: Tab
  onTab: (t: Tab) => void
  onOpen: () => void
}) {
  const [inSession, setInSession] = useState(false)
  const [overlay, setOverlay] = useState(false)
  const [live, setLive] = useState<Omit<DockLive, 'onOpen'> | null>(null)
  const [timer, setTimer] = useState<Omit<
    DockTimer,
    'onOpen' | 'onPauseToggle' | 'onSkip'
  > | null>(null)
  const [timerFinished, setTimerFinished] = useState(false)

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
      const td = loadTimerDraft()
      const sd = td ? null : loadDraft()
      if (td) {
        const snap = timerSnapshot(td, Date.now())
        const label = snap.finished
          ? 'Done'
          : snap.stopwatch
            ? 'Elapsed'
            : (snap.section?.label ?? 'Work')
        setTimer({
          label,
          tone: snap.finished ? 'neutral' : toneFor(label),
          time: snap.stopwatch
            ? fmtSec(snap.elapsedMs / 1000)
            : snap.finished
              ? fmtSec(snap.totalSec)
              : fmtSec(Math.ceil(snap.remainingSec)),
          paused: td.paused,
        })
        setTimerFinished(snap.finished)
        setLive(null)
      } else if (sd) {
        const elapsed = (Date.now() - new Date(sd.start).getTime()) / 1000
        let done = 0
        let total = 0
        for (const ex of sd.exercises) {
          for (const s of ex.sets) {
            total += 1
            if (s.done) done += 1
          }
        }
        setLive({
          title: sd.title || 'Strength',
          sub: `${fmtSec(elapsed)} · ${done} of ${total} sets`,
        })
        setTimer(null)
      } else {
        setTimer(null)
        setLive(null)
      }
      // A reload mid-session lands here with a live draft but no gesture —
      // let the lock-screen widget try to come back up if it was on.
      if (td || sd) maybeResumeLockScreen()
    }
    check()
    const t = setInterval(check, 1000)
    return () => clearInterval(t)
  }, [])

  // Full-screen flows (live session, wizards) own the whole viewport —
  // the dock yields to their action bars.
  if (overlay) return null

  const mode: DockMode =
    timer && !inSession ? 'timer' : live && !inSession ? 'live' : 'tabs'

  return (
    <Dock
      tab={tab}
      onTab={onTab}
      mode={mode}
      live={live ? { ...live, onOpen } : undefined}
      timer={
        timer
          ? {
              ...timer,
              onOpen,
              onPauseToggle: timerFinished ? undefined : togglePause,
              onSkip: timerFinished ? undefined : skip,
            }
          : undefined
      }
    />
  )
}
