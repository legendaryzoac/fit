import type { ReactNode } from 'react'
import {
  IconLog,
  IconPause,
  IconPlan,
  IconPlay,
  IconSkip,
  IconToday,
  IconTrends,
} from './icons'

export type DockTab = 'today' | 'log' | 'plan' | 'trends'
export type DockMode = 'tabs' | 'live' | 'timer'
export type TimerTone = 'effort' | 'rest' | 'caution' | 'neutral'

export interface DockLive {
  title: string
  sub: string
  onOpen: () => void
}

export interface DockTimer {
  label: string
  tone: TimerTone
  time: string
  paused: boolean
  onOpen: () => void
  /** Absent once the timer has finished — nothing left to pause. */
  onPauseToggle?: () => void
  onSkip?: () => void
}

const TABS: Array<{ value: DockTab; label: string; icon: ReactNode }> = [
  { value: 'today', label: 'Today', icon: <IconToday className="h-[22px] w-[22px]" /> },
  { value: 'log', label: 'Log', icon: <IconLog className="h-[22px] w-[22px]" /> },
  { value: 'plan', label: 'Plan', icon: <IconPlan className="h-[22px] w-[22px]" /> },
  { value: 'trends', label: 'Trends', icon: <IconTrends className="h-[22px] w-[22px]" /> },
]

const TONE: Record<TimerTone, string> = {
  effort: 'bg-ember-soft text-ember-strong',
  rest: 'bg-sky-soft text-sky-strong',
  caution: 'bg-amber-soft text-amber-strong',
  neutral: 'bg-surface-2 text-ink-2',
}

/** Each layer crossfades and slides 12px; the hidden ones ignore taps. */
function layerClass(active: boolean, leavesUp: boolean): string {
  return `motion-slow absolute inset-0 flex items-center transition-[opacity,transform] ${
    active
      ? 'opacity-100'
      : `pointer-events-none opacity-0 ${leavesUp ? '-translate-y-3' : 'translate-y-3'}`
  }`
}

/**
 * The floating bottom dock. It is one surface that morphs between three
 * faces: the four tabs, the parked strength session, and the running timer.
 */
export function Dock({
  tab,
  onTab,
  mode,
  live,
  timer,
}: {
  tab: DockTab
  onTab: (t: DockTab) => void
  mode: DockMode
  live?: DockLive
  timer?: DockTimer
}) {
  const activeIndex = Math.max(
    0,
    TABS.findIndex((t) => t.value === tab),
  )

  return (
    <div className="fixed inset-x-3 bottom-[calc(12px+env(safe-area-inset-bottom))] z-30">
      <div className="relative mx-auto h-dock max-w-column overflow-hidden rounded-xl bg-surface/90 shadow-float backdrop-blur-xl">
        {/* Tabs */}
        <nav
          aria-label="Sections"
          aria-hidden={mode !== 'tabs'}
          className={layerClass(mode === 'tabs', true)}
        >
          <div className="relative grid h-full w-full grid-cols-4">
            {/* One indicator, a column wide, slides by whole columns */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-0 flex w-1/4 flex-col items-center justify-center gap-0.5 transition-transform duration-[320ms] ease-out"
              style={{ transform: `translateX(${activeIndex * 100}%)` }}
            >
              <div className="h-7 w-14 rounded-pill bg-brand-soft" />
              {/* Same stack as a tab, so the pill lands on the icon row */}
              <span className="invisible text-micro font-semibold">Today</span>
            </div>
            {TABS.map((t) => {
              const active = t.value === tab
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => onTab(t.value)}
                  aria-current={active ? 'page' : undefined}
                  tabIndex={mode === 'tabs' ? 0 : -1}
                  className={`pressable relative z-10 flex h-full flex-col items-center justify-center gap-0.5 text-micro transition-colors duration-[200ms] ease-standard ${
                    active ? 'font-semibold text-brand-strong' : 'text-ink-3'
                  }`}
                >
                  <span className="flex h-7 items-center justify-center">
                    {t.icon}
                  </span>
                  <span>{t.label}</span>
                </button>
              )
            })}
          </div>
        </nav>

        {/* Live strength session parked off-screen */}
        <div
          aria-hidden={mode !== 'live'}
          className={`${layerClass(mode === 'live', false)} gap-2 pl-[18px] pr-3`}
        >
          <button
            type="button"
            onClick={live?.onOpen}
            aria-label="Open the live session"
            tabIndex={mode === 'live' ? 0 : -1}
            className="pressable flex h-full min-w-0 flex-1 items-center gap-3 text-left"
          >
            <span
              aria-hidden="true"
              className="animate-live h-2.5 w-2.5 shrink-0 rounded-pill bg-ember"
            />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-body font-semibold text-ink">
                {live?.title}
              </span>
              <span className="truncate text-caption text-ink-2">
                {live?.sub}
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={live?.onOpen}
            tabIndex={mode === 'live' ? 0 : -1}
            className="pressable flex h-9 shrink-0 items-center rounded-pill bg-brand-soft px-3.5 text-caption font-semibold text-brand-strong"
          >
            Resume
          </button>
        </div>

        {/* Interval timer running off-screen */}
        <div
          aria-hidden={mode !== 'timer'}
          className={`${layerClass(mode === 'timer', false)} gap-1 pl-[18px] pr-2.5`}
        >
          <button
            type="button"
            onClick={timer?.onOpen}
            aria-label="Open the timer"
            tabIndex={mode === 'timer' ? 0 : -1}
            className="pressable flex h-full min-w-0 flex-1 items-center gap-3 text-left"
          >
            <span
              className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-pill px-2.5 text-caption font-semibold ${
                TONE[timer?.tone ?? 'neutral']
              }`}
            >
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-pill bg-current"
              />
              {timer?.label}
            </span>
            <span className="truncate text-numeric-lg text-ink">
              {timer?.time}
            </span>
          </button>
          {timer?.onPauseToggle && (
            <button
              type="button"
              onClick={timer.onPauseToggle}
              aria-label={timer.paused ? 'Resume' : 'Pause'}
              tabIndex={mode === 'timer' ? 0 : -1}
              className="pressable flex h-touch w-touch shrink-0 items-center justify-center rounded-pill bg-surface-2 text-ink"
            >
              {timer.paused ? <IconPlay /> : <IconPause />}
            </button>
          )}
          {timer?.onSkip && (
            <button
              type="button"
              onClick={timer.onSkip}
              aria-label="Skip section"
              tabIndex={mode === 'timer' ? 0 : -1}
              className="pressable flex h-touch w-touch shrink-0 items-center justify-center rounded-pill text-ink-2"
            >
              <IconSkip />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
