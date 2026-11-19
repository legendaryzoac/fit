import type { Api } from './api'
import { getMe } from './me'
import { getThemePref } from './theme'
import { getUnitPref } from './units'

/** Where reports land. The server pins its own copy; this one is only for
 * the prefilled-link fallback. */
export const BUG_REPO = 'legendaryzoac/fit'

/** Kept in step with api/src/bugs.ts, which treats anything else as other. */
export const BUG_KINDS = [
  { value: 'crash', label: 'Crashed or froze' },
  { value: 'data', label: 'Wrong numbers or data' },
  { value: 'lost', label: "Didn't save / lost data" },
  { value: 'display', label: 'Looks wrong (layout, display)' },
  { value: 'sync', label: 'Strap or sync problem' },
  { value: 'coach', label: 'Coach gave a bad answer' },
  { value: 'slow', label: 'Slow' },
  { value: 'other', label: 'Something else…' },
] as const

export const BUG_AREAS = [
  { value: 'today', label: 'Today' },
  { value: 'log', label: 'Log (workout logger)' },
  { value: 'plan', label: 'Plan (blocks, templates)' },
  { value: 'trends', label: 'Trends' },
  { value: 'timer', label: 'Interval timer' },
  { value: 'coach', label: 'Coach' },
  { value: 'checkin', label: 'Check-in / weigh-in' },
  { value: 'settings', label: 'Settings' },
  { value: 'signin', label: 'Sign-in' },
  { value: 'other', label: 'Somewhere else…' },
] as const

export type BugKind = (typeof BUG_KINDS)[number]['value']
export type BugArea = (typeof BUG_AREAS)[number]['value']

export interface BugReportInput {
  title: string
  kind: BugKind
  kindOther?: string
  area: BugArea
  areaOther?: string
  what: string
  steps?: string
  expected?: string
  extra?: string
  email?: string
}

export const APP_VERSION = __APP_VERSION__

/** What the app can tell about itself, so nobody has to type it. */
export function bugContext(demo: boolean): Record<string, string> {
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  const me = getMe()
  return {
    Version: APP_VERSION,
    Built: __BUILD_TIME__.slice(0, 16).replace('T', ' ') + ' UTC',
    Mode: demo ? 'demo' : 'signed in',
    Browser: navigator.userAgent,
    Screen: `${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}x`,
    Installed: standalone ? 'yes (home screen)' : 'no (browser tab)',
    Online: navigator.onLine ? 'yes' : 'no',
    Theme: getThemePref(),
    Units: getUnitPref(),
    Strap: me
      ? me.whoop.connected
        ? 'connected'
        : (me.whoop.status ?? 'not connected')
      : 'unknown',
    'Time zone': Intl.DateTimeFormat().resolvedOptions().timeZone,
    'Local time': new Date().toLocaleString(),
  }
}

export type SubmitResult =
  | { ok: true; number: number; url: string }
  /** With a fallback (demo, not configured, offline): hand the user a
   * prefilled GitHub link instead. */
  | { ok: false; error?: string; fallback?: string }

const labelOf = (
  list: ReadonlyArray<{ value: string; label: string }>,
  v: string,
) => (v === 'other' ? 'Other' : (list.find((o) => o.value === v)?.label ?? v))

/**
 * A github.com "new issue" link carrying the report, for when the server
 * cannot file it. GitHub caps URLs around 8 KB, so long fields are cut.
 */
export function prefilledIssueUrl(
  input: BugReportInput,
  context: Record<string, string>,
): string {
  const kind =
    input.kind === 'other' && input.kindOther
      ? `Other: ${input.kindOther}`
      : labelOf(BUG_KINDS, input.kind)
  const area =
    input.area === 'other' && input.areaOther
      ? `Other: ${input.areaOther}`
      : labelOf(BUG_AREAS, input.area)
  const cut = (s: string | undefined, n: number) =>
    !s ? '_Not given_' : s.length > n ? `${s.slice(0, n)}…` : s
  const body = [
    `**Type:** ${kind}  `,
    `**Area:** ${area}`,
    '',
    `### What happened\n\n${cut(input.what, 1500)}\n`,
    `### Steps to reproduce\n\n${cut(input.steps, 1500)}\n`,
    `### Expected\n\n${cut(input.expected, 600)}\n`,
    `### Anything else\n\n${cut(input.extra, 1000)}\n`,
    '### Environment\n',
    '| | |\n|---|---|',
    ...Object.entries(context).map(
      ([k, v]) => `| ${k} | ${v.replace(/\|/g, '\\|')} |`,
    ),
  ].join('\n')
  const q = new URLSearchParams({
    title: `[Bug] ${input.title}`,
    body,
    labels: 'bug,user-report',
  })
  return `https://github.com/${BUG_REPO}/issues/new?${q}`
}

export async function submitBugReport(
  api: Api,
  input: BugReportInput,
  demo: boolean,
): Promise<SubmitResult> {
  const context = bugContext(demo)
  // The demo has no account to file under: GitHub's own form, prefilled
  if (demo) return { ok: false, fallback: prefilledIssueUrl(input, context) }

  let res: Response
  try {
    res = await api.send('POST', '/api/bugs', { ...input, context })
  } catch {
    return {
      ok: false,
      error:
        "You look offline. Try again when you're connected, or open it on GitHub.",
      fallback: prefilledIssueUrl(input, context),
    }
  }
  const body = (await res.json().catch(() => ({}))) as {
    number?: number
    url?: string
    error?: string
  }
  if (res.ok && body.number && body.url) {
    return { ok: true, number: body.number, url: body.url }
  }
  if (res.status === 503 || res.status >= 500) {
    return {
      ok: false,
      error: body.error ? `${body.error}.` : undefined,
      fallback: prefilledIssueUrl(input, context),
    }
  }
  return {
    ok: false,
    error: body.error ?? `Something went wrong (${res.status})`,
  }
}
