// POST /api/bugs — files an in-app bug report as a GitHub issue.
//
// The browser sends structured fields; this route owns everything a client
// must not choose: the repository, the labels, the issue layout, field
// length caps and a per-account daily limit. The GitHub token is a
// hand-written SSM SecureString (/fit/github/token), never in code; until
// it exists the route answers 503 and the app offers a prefilled GitHub
// link instead.

import { createHash } from 'node:crypto'
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb'
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm'
import { UpdateCommand } from '@aws-sdk/lib-dynamodb'
import type {
  LambdaFunctionURLEvent,
  LambdaFunctionURLResult,
} from 'aws-lambda'
import { TABLE_NAME, ddb } from './db'
import { json } from './http'

const REPO = process.env.GITHUB_REPO ?? 'legendaryzoac/fit'
const TOKEN_PARAM = process.env.GITHUB_TOKEN_PARAM ?? '/fit/github/token'

/** Reports one account may file per UTC day. */
export const BUG_DAILY_LIMIT = (() => {
  const n = Number(process.env.BUG_DAILY_LIMIT)
  return Number.isInteger(n) && n > 0 ? n : 10
})()

/** Kept in step with web/src/lib/bugReport.ts. Anything else reads as other. */
export const BUG_KINDS = {
  crash: 'Crashed or froze',
  data: 'Wrong numbers or data',
  lost: "Didn't save / lost data",
  display: 'Looks wrong (layout, display)',
  sync: 'Strap or sync problem',
  coach: 'Coach gave a bad answer',
  slow: 'Slow',
  other: 'Other',
} as const

export const BUG_AREAS = {
  today: 'Today',
  log: 'Log (workout logger)',
  plan: 'Plan (blocks, templates)',
  trends: 'Trends',
  timer: 'Interval timer',
  coach: 'Coach',
  checkin: 'Check-in / weigh-in',
  settings: 'Settings',
  signin: 'Sign-in',
  other: 'Other',
} as const

type Kind = keyof typeof BUG_KINDS
type Area = keyof typeof BUG_AREAS

const LIMITS = {
  title: 120,
  other: 120,
  what: 4000,
  steps: 4000,
  expected: 2000,
  extra: 4000,
  meta: 200,
}

export interface BugReport {
  title: string
  kind: Kind
  kindOther?: string
  area: Area
  areaOther?: string
  what: string
  steps?: string
  expected?: string
  extra?: string
  email?: string
  /** Captured by the app, not typed: version, browser, screen, … */
  context: Record<string, string>
}

/** Trims to a cap; collapses to undefined when empty. */
function text(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim().slice(0, max)
  return t || undefined
}

/** One line: no newlines, so it cannot break out of a list item or title. */
function line(v: unknown, max: number): string | undefined {
  return text(typeof v === 'string' ? v.replace(/\s+/g, ' ') : v, max)
}

export function sanitizeReport(
  raw: unknown,
): { ok: true; report: BugReport } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object')
    return { ok: false, error: 'expected an object' }
  const r = raw as Record<string, unknown>

  const title = line(r.title, LIMITS.title)
  const what = text(r.what, LIMITS.what)
  if (!title) return { ok: false, error: 'a summary is required' }
  if (!what) return { ok: false, error: 'say what happened' }

  const kind: Kind =
    typeof r.kind === 'string' && Object.hasOwn(BUG_KINDS, r.kind)
      ? (r.kind as Kind)
      : 'other'
  const area: Area =
    typeof r.area === 'string' && Object.hasOwn(BUG_AREAS, r.area)
      ? (r.area as Area)
      : 'other'

  const email = line(r.email, 254)
  const context: Record<string, string> = {}
  if (r.context && typeof r.context === 'object') {
    for (const [k, v] of Object.entries(
      r.context as Record<string, unknown>,
    ).slice(0, 20)) {
      const key = line(k, 40)
      const val = line(v, LIMITS.meta)
      if (key && val) context[key] = val
    }
  }

  return {
    ok: true,
    report: {
      title,
      kind,
      kindOther: kind === 'other' ? line(r.kindOther, LIMITS.other) : undefined,
      area,
      areaOther: area === 'other' ? line(r.areaOther, LIMITS.other) : undefined,
      what,
      steps: text(r.steps, LIMITS.steps),
      expected: text(r.expected, LIMITS.expected),
      extra: text(r.extra, LIMITS.extra),
      email:
        email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined,
      context,
    },
  }
}

/**
 * Stops an @handle in a report from pinging that GitHub user: a zero-width
 * space after the @ keeps it readable but unlinked.
 */
function defang(s: string): string {
  return s.replace(/@(?=[A-Za-z0-9-])/g, '@​')
}

/** A short, stable, non-reversible id for the account, so reports from the
 * same person can be grouped without exposing who they are. */
export function reporterRef(userId: string): string {
  return createHash('sha256')
    .update(`fit-bug:${userId}`)
    .digest('hex')
    .slice(0, 8)
}

export function issueTitle(report: BugReport): string {
  return `[Bug] ${report.title}`
}

export function issueBody(report: BugReport, reporter: string): string {
  const kind =
    report.kind === 'other' && report.kindOther
      ? `Other: ${report.kindOther}`
      : BUG_KINDS[report.kind]
  const area =
    report.area === 'other' && report.areaOther
      ? `Other: ${report.areaOther}`
      : BUG_AREAS[report.area]

  const section = (heading: string, body?: string) =>
    `### ${heading}\n\n${body ? defang(body) : '_Not given_'}\n`

  const ctx = Object.entries(report.context)
    .map(([k, v]) => `| ${k} | ${defang(v).replace(/\|/g, '\\|')} |`)
    .join('\n')

  return [
    `**Type:** ${defang(kind)}  `,
    `**Area:** ${defang(area)}  `,
    `**Reporter:** ${report.email ? defang(report.email) : '_email not shared_'} (ref \`${reporter}\`)`,
    '',
    section('What happened', report.what),
    section('Steps to reproduce', report.steps),
    section('Expected', report.expected),
    section('Anything else', report.extra),
    '### Environment',
    '',
    '| | |',
    '|---|---|',
    ctx || '| — | — |',
    '',
    '<sub>Filed from the in-app bug reporter.</sub>',
  ].join('\n')
}

export function issueLabels(report: BugReport): string[] {
  return ['bug', 'user-report', `area: ${report.area}`]
}

const ssm = new SSMClient({})
let cachedToken: string | null = null
let missingUntil = 0

async function getGithubToken(): Promise<string | null> {
  if (cachedToken) return cachedToken
  if (Date.now() < missingUntil) return null
  try {
    const res = await ssm.send(
      new GetParameterCommand({ Name: TOKEN_PARAM, WithDecryption: true }),
    )
    const value = res.Parameter?.Value?.trim()
    if (value) {
      cachedToken = value
      return value
    }
  } catch {
    // ParameterNotFound → not configured yet
  }
  missingUntil = Date.now() + 60_000
  return null
}

const today = () => new Date().toISOString().slice(0, 10)

/** Counts the report against today's limit; false when the limit is spent. */
async function spendReport(userId: string): Promise<boolean> {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { pk: `USER#${userId}`, sk: `BUGUSE#${today()}` },
        UpdateExpression:
          'ADD #n :one SET #type = if_not_exists(#type, :type), #ttl = if_not_exists(#ttl, :ttl)',
        ConditionExpression: 'attribute_not_exists(#n) OR #n < :max',
        ExpressionAttributeNames: {
          '#n': 'reports',
          '#type': 'type',
          '#ttl': 'ttl',
        },
        ExpressionAttributeValues: {
          ':one': 1,
          ':max': BUG_DAILY_LIMIT,
          ':type': 'bugUsage',
          ':ttl': Math.floor(Date.now() / 1000) + 7 * 86_400,
        },
      }),
    )
    return true
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return false
    throw err
  }
}

async function createIssue(
  token: string,
  payload: { title: string; body: string; labels?: string[] },
): Promise<Response> {
  return fetch(`https://api.github.com/repos/${REPO}/issues`, {
    method: 'POST',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'user-agent': 'fit-bug-reporter',
      'x-github-api-version': '2022-11-28',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  })
}

export async function handleBugReport(
  userId: string,
  event: LambdaFunctionURLEvent,
): Promise<LambdaFunctionURLResult> {
  let parsed: unknown
  try {
    const body = event.isBase64Encoded
      ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
      : (event.body ?? '')
    parsed = JSON.parse(body)
  } catch {
    return json(400, { error: 'invalid JSON' })
  }
  const clean = sanitizeReport(parsed)
  if (!clean.ok) return json(400, { error: clean.error })

  const token = await getGithubToken()
  if (!token) return json(503, { error: 'bug reporting is not configured' })

  if (!(await spendReport(userId))) {
    return json(429, {
      error: `That's ${BUG_DAILY_LIMIT} reports today — try again tomorrow.`,
    })
  }

  const { report } = clean
  const payload = {
    title: issueTitle(report),
    body: issueBody(report, reporterRef(userId)),
    labels: issueLabels(report),
  }

  try {
    let res = await createIssue(token, payload)
    // A token without label rights, or a label GitHub won't create, is a
    // 422 on the labels alone: file the issue without them rather than lose it.
    if (res.status === 422) {
      res = await createIssue(token, {
        title: payload.title,
        body: payload.body,
      })
    }
    if (res.status === 401) {
      cachedToken = null
    }
    if (!res.ok) {
      console.error('github issue not created', res.status, await res.text())
      return json(502, { error: 'GitHub did not accept the report' })
    }
    const issue = (await res.json()) as { number: number; html_url: string }
    return json(201, { number: issue.number, url: issue.html_url })
  } catch (err) {
    console.error('github issue request failed', err)
    return json(502, { error: 'Could not reach GitHub' })
  }
}
