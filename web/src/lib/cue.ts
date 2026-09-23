import { storageKey } from './storage'

// One shared context, created (ideally) on a user-gesture stack: iOS starts
// gesture-less contexts suspended, which would mute every beep fired from
// the background lock-screen driver.
let ctx: AudioContext | null = null
let listening = false

function resumeIfNeeded(): void {
  if (!ctx) return
  // iOS reports 'interrupted' (not in lib.dom's union) after a lock or
  // app switch; treat it like 'suspended'.
  const state = ctx.state as string
  if (state === 'suspended' || state === 'interrupted') {
    void ctx.resume().catch(() => {})
  }
}

function sharedContext(): AudioContext {
  if (ctx && ctx.state === 'closed') ctx = null
  ctx ??= new AudioContext()
  if (!listening) {
    listening = true
    // Coming back to the foreground is when a suspended context can be
    // revived; without this the first cue after an unlock is silent.
    document.addEventListener('visibilitychange', resumeIfNeeded)
    window.addEventListener('pageshow', resumeIfNeeded)
    window.addEventListener('focus', resumeIfNeeded)
  }
  resumeIfNeeded()
  return ctx
}

/**
 * Call from a user-gesture handler (e.g. session start) so the shared
 * context is unlocked before background ticks need to beep through it.
 */
export function primeCue(): void {
  try {
    sharedContext()
  } catch {
    /* no WebAudio — cue() falls back to vibration only */
  }
}

function chirp(
  times: number,
  hz: number,
  lengthSec: number,
  gapSec: number,
  peak: number,
): void {
  const ctx = sharedContext()
  for (let i = 0; i < times; i++) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = hz
    const t = ctx.currentTime + i * gapSec
    gain.gain.setValueAtTime(0.001, t)
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, t + lengthSec)
    osc.start(t)
    osc.stop(t + lengthSec + 0.02)
  }
}

/** Best-effort chirp + vibration on section changes; silence is acceptable. */
export function cue(times: number) {
  try {
    navigator.vibrate?.(
      Array.from({ length: times }, () => [150, 100]).flat(),
    )
  } catch {
    /* no vibration support */
  }
  try {
    chirp(times, 880, 0.2, 0.25, 0.35)
  } catch {
    /* autoplay policy — vibration already fired */
  }
}

// ---- spoken cues (opt-in, foreground only) ----
// speechSynthesis is unreliable once the page is hidden and it ducks other
// audio on iOS, so it never runs in the background; the chirps and the
// lock-screen text carry the session there.

const SPEAK_KEY = 'fit.spokenCues'

export function speakSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

export function getSpeakPref(): boolean {
  try {
    return localStorage.getItem(storageKey(SPEAK_KEY)) === '1'
  } catch {
    return false
  }
}

export function setSpeakPref(on: boolean): void {
  localStorage.setItem(storageKey(SPEAK_KEY), on ? '1' : '0')
  if (!on && speakSupported()) window.speechSynthesis.cancel()
}

export function speak(text: string): void {
  if (!speakSupported() || !getSpeakPref()) return
  if (document.visibilityState !== 'visible') return
  try {
    const synth = window.speechSynthesis
    synth.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.rate = 1
    u.volume = 0.9
    synth.speak(u)
  } catch {
    /* no voices, or blocked — chirps still fire */
  }
}

/** Softer, lower "three seconds left" tick for long holds. */
export function warnCue() {
  try {
    navigator.vibrate?.(40)
  } catch {
    /* no vibration support */
  }
  try {
    chirp(1, 660, 0.12, 0, 0.2)
  } catch {
    /* autoplay policy */
  }
}
