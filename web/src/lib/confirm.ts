// In-app replacement for window.confirm. Native dialogs are blocked in some
// embedded browsers and look foreign everywhere else; this store holds one
// request at a time and ConfirmDialog renders it.

export interface ConfirmRequest {
  title: string
  body?: string
  /** The affirmative button's label. */
  action: string
  cancel?: string
  tone?: 'danger' | 'brand'
}

interface Pending {
  req: ConfirmRequest
  resolve: (ok: boolean) => void
}

let pending: Pending | null = null
const subs = new Set<() => void>()

function emit(): void {
  for (const fn of subs) fn()
}

/** Resolves true when the action is chosen, false on cancel, Escape or scrim. */
export function confirm(req: ConfirmRequest): Promise<boolean> {
  // A second ask while one is up answers the first with "no".
  pending?.resolve(false)
  return new Promise((resolve) => {
    pending = { req, resolve }
    emit()
  })
}

export function settleConfirm(ok: boolean): void {
  const p = pending
  if (!p) return
  pending = null
  p.resolve(ok)
  emit()
}

export function currentConfirm(): ConfirmRequest | null {
  return pending?.req ?? null
}

export function subscribeConfirm(fn: () => void): () => void {
  subs.add(fn)
  return () => subs.delete(fn)
}
