import type { Collection, StrapProvider, VendorRecord } from '../providers/types'
import { civilToUtc, isoDate, utcDay, type CivilDate } from '../providers/time'
import {
  SCOPE,
  buildAuthorizeUrl,
  exchangeCode,
  fetchHealthUserId,
  healthGet,
  healthPost,
  isAuthDead,
  refreshTokens,
} from './client'
import {
  dailyDateOf,
  normalizeDaily,
  normalizeSleep,
  normalizeSteps,
  stepsDateOf,
} from './normalize'

const BACKFILL_DAYS = 365
const DAY_MS = 86_400_000
/** dailyRollUp refuses a range longer than this. */
const ROLLUP_MAX_DAYS = 90

// Unverified OAuth apps get 2.5 requests a second per user
const pause = (ms = 450) => new Promise((r) => setTimeout(r, ms))

/**
 * The first civil day to ask for. Filters compare the wearer's local
 * clock and we only know UTC, so start a day early rather than miss the
 * edge; a re-pulled day overwrites itself.
 */
const firstDay = (since: Date | undefined): CivilDate =>
  utcDay(since ?? new Date(Date.now() - BACKFILL_DAYS * DAY_MS), -1)

/** GET …/dataPoints:reconcile — one merged stream across the user's sources. */
function reconciled(
  dataType: string,
  filter: (from: string) => string,
  pageSize?: number,
): Collection['pages'] {
  return async function* ({ accessToken, since }) {
    let pageToken: string | undefined
    do {
      const page = await healthGet(
        `/users/me/dataTypes/${dataType}/dataPoints:reconcile`,
        accessToken,
        {
          filter: filter(isoDate(firstDay(since))),
          ...(pageSize && { pageSize: String(pageSize) }),
          ...(pageToken && { pageToken }),
        },
      )
      yield (page.dataPoints ?? []) as VendorRecord[]
      pageToken = page.nextPageToken || undefined
      await pause()
    } while (pageToken)
  }
}

/** A per-day vitals type; its filter field is the type id with underscores. */
function dailyVitals(dataType: string): Collection {
  const field = dataType.replaceAll('-', '_')
  return {
    type: dataType,
    pages: reconciled(dataType, (from) => `${field}.date >= "${from}"`),
    normalize: normalizeDaily,
    idOf: dailyDateOf,
    // Four types share one RECOVERY# row per day, each adding its fields
    write: 'merge',
    // One type failing must not cost the user their sleep data
    optional: true,
    requiresScope: SCOPE.vitals,
  }
}

const civilMidnight = (date: CivilDate) => ({
  date,
  time: { hours: 0, minutes: 0, seconds: 0, nanos: 0 },
})

/**
 * POST …/steps/dataPoints:dailyRollUp — steps summed per civil day, which
 * Google computes with the wearer's own UTC offsets (travel, DST).
 */
const dailySteps: Collection['pages'] = async function* ({ accessToken, since }) {
  // Through tomorrow (UTC), so "today" is covered in every time zone
  const end = civilToUtc(utcDay(new Date(), 2))
  let from = civilToUtc(firstDay(since))
  while (from < end) {
    const to = new Date(Math.min(from.getTime() + ROLLUP_MAX_DAYS * DAY_MS, end.getTime()))
    const page = await healthPost('/users/me/dataTypes/steps/dataPoints:dailyRollUp', accessToken, {
      range: { start: civilMidnight(utcDay(from)), end: civilMidnight(utcDay(to)) },
      windowSizeDays: 1,
    })
    // Days the band was not worn come back without a value: nothing to keep
    yield ((page.rollupDataPoints ?? []) as VendorRecord[]).filter((p) => p.steps)
    from = to
    await pause()
  }
}

export const google: StrapProvider = {
  id: 'google',
  label: 'Fitbit Air',
  ssmPrefix: process.env.GOOGLE_SSM_PREFIX ?? '/fit/google',
  storage: {
    connectionSk: 'GOOGLE#CONNECTION',
    connectionType: 'google-connection',
    gsi1pk: 'GOOGLECONN',
    mappingPk: (id) => `GOOGLE#${id}`,
    mappingType: 'google-mapping',
    rawPrefix: 'google',
  },
  // No vendor recovery score, no strain and (in this version) no workouts
  capabilities: { recoveryScore: false, strain: false, sessions: false, steps: true },
  rotatesRefreshToken: false,
  // Webhooks exist but are not wired up yet: the app asks on open instead
  pushesChanges: false,
  backfillDays: BACKFILL_DAYS,
  authorizeUrl: (creds, redirectUri, state) =>
    buildAuthorizeUrl(creds.clientId, redirectUri, state),
  exchangeCode,
  refresh: refreshTokens,
  isAuthDead,
  async identify(accessToken) {
    return { externalUserId: await fetchHealthUserId(accessToken) }
  },
  collections: [
    {
      type: 'sleep',
      // Sleep pages hold at most 25
      pages: reconciled('sleep', (from) => `sleep.interval.civil_end_time >= "${from}"`, 25),
      normalize: normalizeSleep,
      idOf: (r) => (r.dataPointName ?? r.name ?? '').split('/').pop() || 'unknown',
      requiresScope: SCOPE.sleep,
    },
    dailyVitals('daily-heart-rate-variability'),
    dailyVitals('daily-resting-heart-rate'),
    dailyVitals('daily-oxygen-saturation'),
    dailyVitals('daily-sleep-temperature-derivations'),
    {
      type: 'steps',
      pages: dailySteps,
      normalize: normalizeSteps,
      idOf: stepsDateOf,
      requiresScope: SCOPE.activity,
    },
  ],
}
