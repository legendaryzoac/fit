import type { Collection, StrapProvider, VendorRecord } from '../providers/types'
import {
  buildAuthorizeUrl,
  exchangeCode,
  fetchWhoopProfile,
  refreshTokens,
  whoopGet,
} from './client'
import {
  normalizeCycle,
  normalizeRecovery,
  normalizeSleep,
  normalizeWorkout,
} from './normalize'

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** One WHOOP collection endpoint, 25 records a page, following next_token. */
function whoopPages(path: string): Collection['pages'] {
  return async function* ({ accessToken, since }) {
    let nextToken: string | undefined
    do {
      const page = await whoopGet(path, accessToken, {
        limit: '25',
        ...(since && { start: since.toISOString() }),
        ...(nextToken && { nextToken }),
      })
      yield (page.records ?? []) as VendorRecord[]
      nextToken = page.next_token || undefined
      // Stay well under WHOOP's 100 req/min during long backfills
      await pause(650)
    } while (nextToken)
  }
}

export const whoop: StrapProvider = {
  id: 'whoop',
  label: 'WHOOP',
  ssmPrefix: process.env.WHOOP_SSM_PREFIX ?? '/fit/whoop',
  storage: {
    connectionSk: 'WHOOP#CONNECTION',
    connectionType: 'whoop-connection',
    gsi1pk: 'WHOOPCONN',
    mappingPk: (id) => `WHOOP#${id}`,
    mappingType: 'whoop-mapping',
    externalIdAlias: 'whoopUserId',
    rawPrefix: 'whoop',
  },
  capabilities: { recoveryScore: true, strain: true, sessions: true, steps: false },
  rotatesRefreshToken: true,
  pushesChanges: true,
  authorizeUrl: (creds, redirectUri, state) =>
    buildAuthorizeUrl(creds.clientId, redirectUri, state),
  exchangeCode,
  refresh: refreshTokens,
  // As it has always been: any failed refresh asks for a reconnect
  isAuthDead: () => true,
  async identify(accessToken) {
    const profile = await fetchWhoopProfile(accessToken)
    return { externalUserId: String(profile.user_id) }
  },
  collections: [
    { type: 'cycle', pages: whoopPages('/v2/cycle'), normalize: normalizeCycle, idOf: (r) => r.id },
    { type: 'sleep', pages: whoopPages('/v2/activity/sleep'), normalize: normalizeSleep, idOf: (r) => r.id },
    { type: 'workout', pages: whoopPages('/v2/activity/workout'), normalize: normalizeWorkout, idOf: (r) => r.id },
    { type: 'recovery', pages: whoopPages('/v2/recovery'), normalize: normalizeRecovery, idOf: (r) => `${r.cycle_id}` },
  ],
  async extras(accessToken) {
    const body = await whoopGet('/v2/user/measurement/body', accessToken)
    return typeof body?.weight_kilogram === 'number'
      ? { bodyWeightKg: body.weight_kilogram }
      : {}
  },
}
