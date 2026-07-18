// Lock-screen session widget, tailored for Android. A PWA can't render a
// real OS widget, but playing a silent looping track lets us own the media
// notification: the countdown ticks in the notification title, the progress
// bar tracks the WHOLE session (stable and monotonic — no per-section
// resets), and prev/next drive the interval timer like track controls.
// Playing audio also keeps the page alive while the phone is locked, so
// section-change beeps actually fire mid-sprint instead of freezing with
// the JS clock.
//
// The controller is module-scoped and reads the localStorage drafts (already
// the source of truth for live sessions) about once a second, so it keeps
// working when the session UI unmounts — minimized sessions, other tabs,
// locked phone. When the timer screen IS mounted it registers itself as a
// delegate so media-key actions flow through React state instead of racing
// it. Ticks ride on the audio element's `timeupdate` (media pipeline events
// escape the background timer throttling that stalls setInterval), with the
// interval kept as a fallback.

import { cue, primeCue } from './cue'
import { fmtSec } from './templates'
import { storageKey } from './storage'
import {
  backSection,
  loadDraft,
  loadTimerDraft,
  saveTimerDraft,
  skipSection,
  timerSnapshot,
} from './workouts'

const PREF_KEY = 'fit.lockScreenWidget'

export interface TimerControls {
  pause(): void
  resume(): void
  skip(): void
  back(): void
}

let delegate: TimerControls | null = null

/** The mounted timer screen owns media-key actions while it's on screen. */
export function registerTimerControls(controls: TimerControls): () => void {
  delegate = controls
  return () => {
    if (delegate === controls) delegate = null
  }
}

export function lockScreenSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'mediaSession' in navigator &&
    typeof Audio !== 'undefined'
  )
}

export function getLockScreenPref(): boolean {
  return localStorage.getItem(storageKey(PREF_KEY)) === '1'
}

function savePref(on: boolean): void {
  localStorage.setItem(storageKey(PREF_KEY), on ? '1' : '0')
}

// ---- silent keep-alive track ----

/** 10s of 8-bit mono silence — enough to register as real playback. */
function silentWavUrl(): string {
  const rate = 8000
  const samples = rate * 10
  const buf = new ArrayBuffer(44 + samples)
  const view = new DataView(buf)
  const ascii = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + samples, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, rate, true)
  view.setUint32(28, rate, true) // byte rate (8-bit mono)
  view.setUint16(32, 1, true) // block align
  view.setUint16(34, 8, true) // bits per sample
  ascii(36, 'data')
  view.setUint32(40, samples, true)
  new Uint8Array(buf, 44).fill(128) // 8-bit PCM midpoint = silence
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }))
}

// ---- controller state ----

let audio: HTMLAudioElement | null = null
let audioUrl: string | null = null
let ticker: ReturnType<typeof setInterval> | null = null
let active = false
let missingTicks = 0
let lastIndex = -1
let firedDone = false
let lastMetaKey = ''
let lastTickAt = 0
let retryArmed = false
let sectionKeysOn = false
/**
 * Set when the user dismisses the widget with the media Stop control: keeps
 * the resume poll from resurrecting it a second later. Cleared when a new
 * session starts or the toggle is flipped back on.
 */
let dismissed = false
/**
 * startEpoch of the timer draft the cue state (lastIndex/firedDone) belongs
 * to — a new timer starting while the widget is still up must not inherit
 * the old one's "already cued" flags. Resume-from-pause also changes
 * startEpoch, but the resulting reset is a harmless re-sync.
 */
let timerSig: number | null = null

const subs = new Set<() => void>()

export function isLockScreenActive(): boolean {
  return active
}

/** Fires whenever the widget turns on or off — for the toggle button. */
export function subscribeLockScreen(fn: () => void): () => void {
  subs.add(fn)
  return () => subs.delete(fn)
}

function notify(): void {
  for (const fn of subs) fn()
}

// ---- media-key actions ----
// Timer sessions: keys drive the countdown (via the mounted screen when it's
// up, else by rewriting the draft — nothing else owns it while unmounted).
// Strength: elapsed time is wall-clock and can't pause, so keys no-op; the
// silent track keeps playing either way so the widget never goes stale.

function draftPause(): void {
  const d = loadTimerDraft()
  if (!d || d.paused) return
  const snap = timerSnapshot(d, Date.now())
  saveTimerDraft({ ...d, paused: true, pausedElapsedMs: snap.elapsedMs })
}

function draftResume(): void {
  const d = loadTimerDraft()
  if (!d?.paused) return
  saveTimerDraft({
    ...d,
    paused: false,
    startEpoch: Date.now(),
    skipOffsetMs: d.pausedElapsedMs,
  })
}

function draftSkip(): void {
  const d = loadTimerDraft()
  if (d) saveTimerDraft(skipSection(d, Date.now()))
}

function draftBack(): void {
  const d = loadTimerDraft()
  if (d) saveTimerDraft(backSection(d, Date.now()))
}

function onPlay(): void {
  audio?.play().catch(() => {})
  if (loadTimerDraft()) (delegate ?? { resume: draftResume }).resume()
  tick()
}

function onPause(): void {
  // Deliberately keep the silent track rolling: pausing it would let the
  // browser freeze the page and strand the widget. Only the countdown pauses.
  if (loadTimerDraft()) (delegate ?? { pause: draftPause }).pause()
  tick()
}

function onSkip(): void {
  if (loadTimerDraft()) (delegate ?? { skip: draftSkip }).skip()
  tick()
}

function onBack(): void {
  if (loadTimerDraft()) (delegate ?? { back: draftBack }).back()
  tick()
}

/** Prev/next only make sense for sectioned timers; hide them otherwise. */
function ensureSectionKeys(on: boolean): void {
  if (on === sectionKeysOn) return
  sectionKeysOn = on
  try {
    const ms = navigator.mediaSession
    ms.setActionHandler('nexttrack', on ? onSkip : null)
    ms.setActionHandler('previoustrack', on ? onBack : null)
  } catch {
    /* not every action is supported everywhere */
  }
}

// ---- rendering ----

function setMeta(title: string, artist: string): void {
  const key = `${title}\n${artist}`
  if (key === lastMetaKey) return
  lastMetaKey = key
  navigator.mediaSession.metadata = new MediaMetadata({
    title,
    artist,
    album: 'fit',
    artwork: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  })
}

/**
 * Last position actually pushed to the OS. Re-pushing every tick makes the
 * Android progress bar jitter (it interpolates on its own), so we only push
 * when reality diverges from what the OS is already animating — a skip, a
 * pause/resume, a new session.
 */
let lastPush: {
  at: number
  pos: number
  dur: number
  playing: boolean
} | null = null

function setPosition(
  durationSec: number,
  positionSec: number,
  playing: boolean,
): void {
  if (!('setPositionState' in navigator.mediaSession)) return
  const duration = Math.max(0, durationSec) // Infinity = live, no scrub bar
  const position = Math.min(Math.max(0, positionSec), duration)
  if (lastPush && lastPush.dur === duration && lastPush.playing === playing) {
    const predicted =
      lastPush.pos + (playing ? (Date.now() - lastPush.at) / 1000 : 0)
    // While paused the OS should hold still, but re-sync it occasionally in
    // case an implementation keeps interpolating past our paused state.
    const fresh = playing || Date.now() - lastPush.at < 5000
    if (Math.abs(predicted - position) < 1.25 && fresh) return
  }
  try {
    navigator.mediaSession.setPositionState({
      duration,
      position,
      playbackRate: 1,
    })
    lastPush = { at: Date.now(), pos: position, dur: duration, playing }
  } catch {
    /* partial implementations reject some states — next push resyncs */
  }
}

function tick(): void {
  if (!active) return
  lastTickAt = Date.now()
  try {
    const timer = loadTimerDraft()
    const strength = timer ? null : loadDraft()
    if (!timer && !strength) {
      // Two-tick grace: a strength session saves its draft from a mount
      // effect, and finish/discard also lands here — stop once it's real.
      if (++missingTicks >= 2) stopLockScreen()
      return
    }
    missingTicks = 0

    if (timer) {
      if (timer.startEpoch !== timerSig) {
        timerSig = timer.startEpoch
        firedDone = false
        lastIndex = timerSnapshot(timer, Date.now()).index
      }
      const snap = timerSnapshot(timer, Date.now())
      ensureSectionKeys(!snap.stopwatch)
      if (snap.finished) {
        if (!firedDone) {
          firedDone = true
          if (!delegate) cue(3)
        }
        setMeta('Timer done', 'Open fit to save your session')
        setPosition(snap.totalSec, snap.totalSec, false)
        navigator.mediaSession.playbackState = 'playing'
        return
      }
      firedDone = false // a media-key "back" can un-finish the timer
      if (snap.stopwatch) {
        setMeta(
          `${timer.title ?? 'Cardio timer'} · ${fmtSec(snap.elapsedMs / 1000)}`,
          'Elapsed time',
        )
        setPosition(Infinity, snap.elapsedMs / 1000, !timer.paused)
      } else {
        if (lastIndex !== -1 && snap.index !== lastIndex && !delegate) {
          cue(2) // the mounted screen cues for itself
        }
        lastIndex = snap.index
        const section = snap.section
        if (section) {
          setMeta(
            `${section.label} · ${fmtSec(Math.ceil(snap.remainingSec))} left`,
            `${snap.index + 1}/${timer.sections.length}` +
              (snap.next
                ? ` · Next: ${snap.next.label} ${fmtSec(snap.next.durationSec)}`
                : ' · Final section') +
              (timer.title ? ` · ${timer.title}` : ''),
          )
          // The bar spans the whole session — a skip reads as a seek
          // forward instead of the bar snapping back to zero.
          setPosition(snap.totalSec, snap.elapsedMs / 1000, !timer.paused)
        }
      }
      navigator.mediaSession.playbackState = timer.paused
        ? 'paused'
        : 'playing'
      return
    }

    const w = strength!
    ensureSectionKeys(false)
    const totals = w.exercises.reduce(
      (n, e) => {
        for (const s of e.sets) {
          n.total++
          if (s.done) n.done++
        }
        return n
      },
      { done: 0, total: 0 },
    )
    const currentExercise = w.exercises.find((e) =>
      e.sets.some((s) => !s.done),
    )
    const elapsedSec = (Date.now() - new Date(w.start).getTime()) / 1000
    setMeta(
      `${currentExercise?.name ?? w.title ?? 'Strength session'} · ${fmtSec(elapsedSec)}`,
      totals.total > 0
        ? `${totals.done}/${totals.total} sets done`
        : 'Live session',
    )
    setPosition(Infinity, elapsedSec, true)
    navigator.mediaSession.playbackState = 'playing'
  } catch {
    /* media session quirks must never take down the app */
  }
}

const onVisible = () => {
  if (document.visibilityState === 'visible') tick()
}

// The media pipeline keeps firing timeupdate (~4/s) even when background
// throttling stalls setInterval — rate-limit it back down to ~1Hz.
const onTimeUpdate = () => {
  if (Date.now() - lastTickAt >= 900) tick()
}

// ---- lifecycle ----

let starting: Promise<boolean> | null = null

/**
 * Needs a user gesture on the call stack the first time (autoplay policy).
 * Resolves true when the silent track is rolling and the widget is live.
 */
export function startLockScreen(): Promise<boolean> {
  if (!lockScreenSupported()) return Promise.resolve(false)
  if (active) {
    notify() // self-heal any subscriber that missed the activation
    return Promise.resolve(true)
  }
  // Coalesce overlapping calls (start click vs. the AppShell poll) so only
  // one ticker ever exists — play() keeps the guard window open for a beat.
  if (!starting) {
    starting = doStart().finally(() => {
      starting = null
    })
  }
  return starting
}

async function doStart(): Promise<boolean> {
  // Synchronously, while any user gesture is still on the stack: unlock the
  // shared beep context, or the OS keeps it suspended and background cues mute.
  primeCue()
  if (!audio) {
    audioUrl = silentWavUrl()
    audio = new Audio(audioUrl)
    audio.loop = true
    audio.preload = 'auto'
    audio.addEventListener('timeupdate', onTimeUpdate)
  }
  try {
    await audio.play()
  } catch {
    return false // no gesture yet — caller may retry on the next tap
  }
  active = true
  missingTicks = 0
  firedDone = false
  lastMetaKey = ''
  lastPush = null
  lastIndex = -1
  timerSig = null // first tick re-seeds cue state from the live draft
  try {
    const ms = navigator.mediaSession
    ms.setActionHandler('play', onPlay)
    ms.setActionHandler('pause', onPause)
    ms.setActionHandler('stop', () => {
      // An explicit dismissal — stay down for the rest of this session.
      dismissed = true
      stopLockScreen()
    })
  } catch {
    /* not every action is supported everywhere */
  }
  document.addEventListener('visibilitychange', onVisible)
  ticker = setInterval(tick, 1000)
  tick()
  notify()
  return true
}

/** Tear down the widget (keeps the user preference for the next session). */
export function stopLockScreen(): void {
  if (ticker) clearInterval(ticker)
  ticker = null
  document.removeEventListener('visibilitychange', onVisible)
  if (audio) {
    audio.removeEventListener('timeupdate', onTimeUpdate)
    audio.pause()
    audio.src = ''
    audio = null
  }
  if (audioUrl) {
    URL.revokeObjectURL(audioUrl)
    audioUrl = null
  }
  if (active && lockScreenSupported()) {
    try {
      const ms = navigator.mediaSession
      ms.metadata = null
      ms.playbackState = 'none'
      ms.setActionHandler('play', null)
      ms.setActionHandler('pause', null)
      ms.setActionHandler('nexttrack', null)
      ms.setActionHandler('previoustrack', null)
      ms.setActionHandler('stop', null)
      if ('setPositionState' in ms) ms.setPositionState()
    } catch {
      /* best effort */
    }
  }
  lastMetaKey = ''
  lastPush = null
  sectionKeysOn = false
  active = false
  notify()
}

/** The session-screen toggle: flips the persisted preference too. */
export async function setLockScreenEnabled(on: boolean): Promise<boolean> {
  savePref(on)
  if (!on) {
    stopLockScreen()
    return true
  }
  dismissed = false // an explicit re-enable overrides a media-key dismissal
  return startLockScreen()
}

/**
 * Called from session-start click handlers (a gesture, so play() is allowed):
 * bring the widget up automatically when the user opted in previously.
 */
export function autoStartLockScreen(): void {
  dismissed = false // new session, fresh choice
  if (getLockScreenPref()) void startLockScreen()
}

/**
 * Reload-with-a-live-draft case (no gesture available): try anyway, and if
 * autoplay blocks us, arm a one-shot retry on the next interaction. `click`
 * rather than pointerdown — touch browsers don't grant user activation until
 * the tap completes, so play() inside a pointerdown handler would still
 * reject; `keydown` covers keyboard users.
 */
export function maybeResumeLockScreen(): void {
  if (
    !getLockScreenPref() ||
    !lockScreenSupported() ||
    active ||
    retryArmed ||
    dismissed
  ) {
    return
  }
  retryArmed = true
  void startLockScreen().then((ok) => {
    if (ok) {
      retryArmed = false
      return
    }
    const retry = () => {
      window.removeEventListener('click', retry, true)
      window.removeEventListener('keydown', retry, true)
      retryArmed = false
      if (
        getLockScreenPref() &&
        !dismissed &&
        (loadTimerDraft() || loadDraft())
      ) {
        void startLockScreen()
      }
    }
    window.addEventListener('click', retry, { once: true, capture: true })
    window.addEventListener('keydown', retry, { once: true, capture: true })
  })
}
