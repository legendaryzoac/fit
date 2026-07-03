/**
 * Storage namespace switch. Demo mode prefixes every localStorage key so a
 * visitor playing with the demo can never pollute the signed-in user's
 * offline queue, caches, or drafts on the same browser.
 */
let demoMode = false

export function setDemoStorage(on: boolean): void {
  demoMode = on
}

export function storageKey(key: string): string {
  return demoMode ? `demo.${key}` : key
}
