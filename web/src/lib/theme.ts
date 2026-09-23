/**
 * Theme: Dawn (light), Dusk (dark) or auto. The preference is a device
 * setting, so it is stored unprefixed and applies to demo mode too. The
 * resolved theme lands on <html data-theme> where index.css reads it.
 */
export type ThemePref = 'light' | 'dark' | 'auto'
export type Theme = 'light' | 'dark'

const KEY = 'fit.theme'
const CANVAS: Record<Theme, string> = { light: '#f2f0ea', dark: '#0f1311' }

const listeners = new Set<() => void>()
const media =
  typeof window !== 'undefined' && 'matchMedia' in window
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

export function resolveTheme(pref: ThemePref = getThemePref()): Theme {
  if (pref !== 'auto') return pref
  return media?.matches ? 'dark' : 'light'
}

function apply(): void {
  const theme = resolveTheme()
  document.documentElement.dataset.theme = theme
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (meta) meta.content = CANVAS[theme]
  for (const fn of listeners) fn()
}

export function setThemePref(pref: ThemePref): void {
  try {
    if (pref === 'auto') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, pref)
  } catch {
    // storage unavailable — the choice still applies for this page
  }
  apply()
}

export function subscribeTheme(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Call once before the first render. */
export function initTheme(): void {
  apply()
  media?.addEventListener('change', () => {
    if (getThemePref() === 'auto') apply()
  })
}
