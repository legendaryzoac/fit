// Tiny module store bridging the live workout session and the rest of the app:
// AppShell watches whether a session is active (to show/hide the resume bar) and
// can ask an already-mounted Workouts to re-enter its session. No deps.

let inSession = false
const sessionSubs = new Set<() => void>()

export function setInSession(v: boolean): void {
  if (v === inSession) return
  inSession = v
  for (const fn of sessionSubs) fn()
}

export function subscribeInSession(fn: () => void): () => void {
  sessionSubs.add(fn)
  return () => sessionSubs.delete(fn)
}

export function isInSession(): boolean {
  return inSession
}

// Whether Workouts is showing a full-screen flow (live session, wizard,
// builder…) — AppShell hides the bottom tab bar while one is up.
let overlay = false
const overlaySubs = new Set<() => void>()

export function setOverlay(v: boolean): void {
  if (v === overlay) return
  overlay = v
  for (const fn of overlaySubs) fn()
}

export function subscribeOverlay(fn: () => void): () => void {
  overlaySubs.add(fn)
  return () => overlaySubs.delete(fn)
}

export function isOverlay(): boolean {
  return overlay
}

const resumeSubs = new Set<() => void>()

export function requestResume(): void {
  for (const fn of resumeSubs) fn()
}

export function onResume(fn: () => void): () => void {
  resumeSubs.add(fn)
  return () => resumeSubs.delete(fn)
}

// Ask Workouts to open the start picker on a kind. Workouts is unmounted
// while the Recovery tab is up, so a request made from there parks until
// the next mount takes it.
let pendingPick: string | null = null
const pickSubs = new Set<(kind: string) => void>()

export function requestPick(kind: string): void {
  if (pickSubs.size === 0) {
    pendingPick = kind
    return
  }
  for (const fn of pickSubs) fn(kind)
}

export function onPick(fn: (kind: string) => void): () => void {
  pickSubs.add(fn)
  return () => pickSubs.delete(fn)
}

export function takePendingPick(): string | null {
  const k = pendingPick
  pendingPick = null
  return k
}
