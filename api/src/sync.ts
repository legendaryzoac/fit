import { QueryCommand } from '@aws-sdk/lib-dynamodb'
import { TABLE_NAME, ddb } from './db'
import { getCredentials } from './providers/config'
import { PROVIDERS, getProvider } from './providers/registry'
import {
  getFreshAccessToken,
  loadConnection,
  mergeEntity,
  patchConnection,
  putEntity,
  putRaw,
} from './providers/store'

interface SyncEvent {
  mode: 'backfill' | 'recent' | 'nightly'
  userId?: string
  days?: number
  reason?: string
}

const DAY_MS = 86_400_000

async function syncUser(
  userId: string,
  opts: { days?: number; backfill?: boolean },
): Promise<void> {
  const connection = await loadConnection(userId)
  if (!connection || connection.status !== 'active') {
    console.log(`skip ${userId}: no active strap connection`)
    return
  }
  const provider = getProvider(connection.provider)
  const creds = await getCredentials(provider)
  if (!creds) throw new Error(`${provider.label} credentials not configured`)

  const accessToken = await getFreshAccessToken(provider, creds, userId, connection)

  let extras: Record<string, unknown> = {}
  try {
    extras = (await provider.extras?.(accessToken)) ?? {}
  } catch { /* extras are optional — never fail a sync over them */ }

  const days = opts.days ?? provider.backfillDays
  const since = days ? new Date(Date.now() - days * DAY_MS) : undefined

  const counts: Record<string, number> = {}
  for (const collection of provider.collections) {
    counts[collection.type] = 0
    const write = collection.write === 'merge' ? mergeEntity : putEntity
    try {
      for await (const records of collection.pages({ accessToken, since })) {
        await Promise.all(
          records.map((record) => {
            const entity = collection.normalize(record)
            return Promise.all([
              putRaw(provider, userId, collection.type, collection.idOf(record), record),
              entity && write(userId, entity),
            ])
          }),
        )
        counts[collection.type] += records.length
      }
    } catch (err) {
      if (!collection.optional) throw err
      console.error(`${provider.id} ${collection.type} failed for ${userId}`, err)
    }
  }

  await patchConnection(provider.id, userId, {
    lastSyncAt: new Date().toISOString(),
    lastSyncCounts: counts,
    ...(opts.backfill && { backfillDone: true }),
    ...extras,
  })
  await provider.derive?.(userId, since)
  console.log(`synced ${userId}`, JSON.stringify(counts))
}

/** Every user with a linked strap, band by band (sparse-index queries). */
async function listConnectedUserIds(): Promise<string[]> {
  const userIds: string[] = []
  for (const provider of PROVIDERS) {
    const res = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'gsi1',
        KeyConditionExpression: 'gsi1pk = :p',
        ExpressionAttributeValues: { ':p': provider.storage.gsi1pk },
      }),
    )
    userIds.push(...(res.Items ?? []).map((item) => item.gsi1sk as string))
  }
  return userIds
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
