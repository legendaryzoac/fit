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

const resumeSubs = new Set<() => void>()

export function requestResume(): void {
  for (const fn of resumeSubs) fn()
}

export function onResume(fn: () => void): () => void {
  resumeSubs.add(fn)
  return () => resumeSubs.delete(fn)
}
