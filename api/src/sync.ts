import { QueryCommand } from '@aws-sdk/lib-dynamodb'
import { TABLE_NAME, ddb } from './db'
import { whoopGet } from './whoop/client'
import { getWhoopCredentials } from './whoop/config'
import {
  getFreshAccessToken,
  loadConnection,
  patchConnection,
  putEntity,
  putRaw,
} from './whoop/store'
import {
  normalizeCycle,
  normalizeRecovery,
  normalizeSleep,
  normalizeWorkout,
  type Entity,
} from './whoop/normalize'

interface SyncEvent {
  mode: 'backfill' | 'recent' | 'nightly'
  userId?: string
  days?: number
  reason?: string
}

const COLLECTIONS: Array<{
  type: string
  path: string
  normalize: (r: Record<string, any>) => Entity
  idOf: (r: Record<string, any>) => string | number
}> = [
  { type: 'cycle', path: '/v2/cycle', normalize: normalizeCycle, idOf: (r) => r.id },
  { type: 'sleep', path: '/v2/activity/sleep', normalize: normalizeSleep, idOf: (r) => r.id },
  { type: 'workout', path: '/v2/activity/workout', normalize: normalizeWorkout, idOf: (r) => r.id },
  { type: 'recovery', path: '/v2/recovery', normalize: normalizeRecovery, idOf: (r) => `${r.cycle_id}` },
]

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function syncUser(
  userId: string,
  opts: { days?: number; backfill?: boolean },
): Promise<void> {
  const connection = await loadConnection(userId)
  if (!connection || connection.status !== 'active') {
    console.log(`skip ${userId}: no active WHOOP connection`)
    return
  }
  const creds = await getWhoopCredentials()
  if (!creds) throw new Error('WHOOP credentials not configured')

  const accessToken = await getFreshAccessToken(creds, userId, connection)

  let bodyWeightKg: number | undefined
  try {
    const body = await whoopGet('/v2/user/measurement/body', accessToken)
    if (typeof body?.weight_kilogram === 'number') bodyWeightKg = body.weight_kilogram
  } catch { /* measurement is optional — never fail a sync over it */ }

  const start = opts.days
    ? new Date(Date.now() - opts.days * 86_400_000).toISOString()
    : undefined

  const counts: Record<string, number> = {}
  for (const collection of COLLECTIONS) {
    counts[collection.type] = 0
    let nextToken: string | undefined
    do {
      const page = await whoopGet(collection.path, accessToken, {
        limit: '25',
        ...(start && { start }),
        ...(nextToken && { nextToken }),
      })
      const records: Array<Record<string, any>> = page.records ?? []
      await Promise.all(
        records.map((record) =>
          Promise.all([
            putRaw(userId, collection.type, collection.idOf(record), record),
            putEntity(userId, collection.normalize(record)),
          ]),
        ),
      )
      counts[collection.type] += records.length
      nextToken = page.next_token || undefined
      // Stay well under WHOOP's 100 req/min during long backfills
      await pause(650)
    } while (nextToken)
  }

  await patchConnection(userId, {
    lastSyncAt: new Date().toISOString(),
    lastSyncCounts: counts,
    ...(opts.backfill && { backfillDone: true }),
    ...(bodyWeightKg !== undefined && { bodyWeightKg }),
  })
  console.log(`synced ${userId}`, JSON.stringify(counts))
}

async function listConnectedUserIds(): Promise<string[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'gsi1',
      KeyConditionExpression: 'gsi1pk = :p',
      ExpressionAttributeValues: { ':p': 'WHOOPCONN' },
    }),
  )
  return (res.Items ?? []).map((item) => item.gsi1sk as string)
}

export async function handler(event: SyncEvent): Promise<void> {
  console.log('sync event', JSON.stringify(event))
  if (event.mode === 'nightly') {
    // Sequential on purpose: shared client rate limit
    for (const userId of await listConnectedUserIds()) {
      try {
        await syncUser(userId, { days: 14 })
      } catch (err) {
        console.error(`nightly sync failed for ${userId}`, err)
      }
    }
    return
  }
  if (!event.userId) throw new Error(`mode ${event.mode} requires userId`)
  if (event.mode === 'backfill') {
    await syncUser(event.userId, { backfill: true })
  } else {
    await syncUser(event.userId, { days: event.days ?? 3 })
  }
}
