// Screen Wake Lock for guided sessions: a routine is followed with the
// phone propped up, so the screen must not dim mid-hold. The OS releases
// the lock whenever the page is hidden; we re-acquire on return for as
// long as a session wants it. Best-effort everywhere (Android Chrome,
// iOS 16.4+ in Safari, iOS 18.4+ in Home Screen web apps).

let sentinel: WakeLockSentinel | null = null
let wanted = false
let listening = false

async function request(): Promise<void> {
  if (!('wakeLock' in navigator)) return
  if (document.visibilityState !== 'visible') return
  if (sentinel) return
  try {
    const s = await navigator.wakeLock.request('screen')
    s.addEventListener('release', () => {
      if (sentinel === s) sentinel = null
    })
    sentinel = s
  } catch {
    /* low battery, permission, or unsupported — the countdown still runs */
  }
}

function onVisible(): void {
  if (wanted && document.visibilityState === 'visible') void request()
}

export function acquireWakeLock(): void {
  wanted = true
  if (!listening) {
    listening = true
    document.addEventListener('visibilitychange', onVisible)
  }
  void request()
}

export function releaseWakeLock(): void {
  wanted = false
  const s = sentinel
  sentinel = null
  s?.release().catch(() => {})
}
