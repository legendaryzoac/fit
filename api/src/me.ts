import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import type { LambdaFunctionURLResult } from 'aws-lambda'
import type { MeResponse, ProviderInfo, StrapStatus } from '@fit/shared'
import { TABLE_NAME, ddb } from './db'
import { json } from './http'
import { getCredentials } from './providers/config'
import { PROVIDERS, getProvider } from './providers/registry'
import { loadConnection } from './providers/store'
import type { Connection } from './providers/types'

/** Never the tokens — only presentation state. */
function strapStatus(connection: Connection): StrapStatus {
  return {
    connected: connection.status === 'active',
    status: connection.status,
    lastSyncAt: connection.lastSyncAt ?? null,
    backfillDone: connection.backfillDone ?? false,
    bodyWeightLb:
      typeof connection.bodyWeightKg === 'number'
        ? Math.round(connection.bodyWeightKg * 2.20462 * 10) / 10
        : undefined,
  }
}

/** Bands whose client credentials exist, i.e. the ones that can be linked. */
async function linkableProviders(): Promise<ProviderInfo[]> {
  const configured = await Promise.all(
    PROVIDERS.map(async (p) => ((await getCredentials(p)) ? p : null)),
  )
  return configured.flatMap((p) => (p ? [{ id: p.id, label: p.label }] : []))
}

/** GET /api/me — the profile (created on first sight) and the strap's state. */
export async function getMe(userId: string): Promise<LambdaFunctionURLResult> {
  const key = { pk: `USER#${userId}`, sk: 'PROFILE' }
  const existing = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: key }),
  )
  let profile = existing.Item
  if (!profile) {
    profile = {
      ...key,
      type: 'profile',
      userId,
      createdAt: new Date().toISOString(),
    }
    await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: profile }))
  }

  const [connection, providers] = await Promise.all([
    loadConnection(userId),
    linkableProviders(),
  ])
  const status = connection ? strapStatus(connection) : null
  const body: MeResponse = {
    userId,
    createdAt: profile.createdAt,
    // App versions that predate `strap` read this key, and only know WHOOP
    whoop: status && connection?.provider === 'whoop' ? status : { connected: false },
    strap:
      status && connection
        ? {
            provider: connection.provider,
            ...status,
            capabilities: getProvider(connection.provider).capabilities,
            syncOnOpen: !getProvider(connection.provider).pushesChanges,
          }
        : { connected: false },
    providers,
  }
  return json(200, body)
}
