// What a band's adapter has to provide. Everything else — connection
// storage, OAuth state, token freshness, the sync loop, the routes — is
// shared and lives beside this file.

import type {
  Capabilities,
  DailyLoad,
  DailySteps,
  DailyVitals,
  ProviderId,
  SessionRecord,
  SleepRecord,
} from '@fit/shared'

export type { ProviderId } from '@fit/shared'

export interface Credentials {
  clientId: string
  clientSecret: string
}

export interface Tokens {
  accessToken: string
  refreshToken: string
  expiresAt: number // epoch ms
  scope: string
}

// ---- stored entities: a shared record plus its key and bookkeeping ----

interface StoredMeta<K extends string> {
  /** ISO-dated sort key, so date ranges are a `between` on sk. */
  sk: string
  type: K
  source: ProviderId
  id?: string | number
  updatedAt?: string
}

export type SleepEntity = SleepRecord & StoredMeta<'sleep'>
export type LoadEntity = DailyLoad & StoredMeta<'cycle'>
export type SessionEntity = SessionRecord & StoredMeta<'session'>
export type StepsEntity = DailySteps & StoredMeta<'steps'>
/** WHOOP rows carry their date in the sort key only. */
export type VitalsEntity = Omit<DailyVitals, 'date'> &
  StoredMeta<'recovery'> & {
    date?: string
    cycleId?: number
    sleepId?: string
  }

export type Entity = SleepEntity | LoadEntity | SessionEntity | StepsEntity | VitalsEntity

// ---- the adapter ----

export interface SyncContext {
  accessToken: string
  /** Lower bound of the pull; absent means everything the band has. */
  since?: Date
}

export type VendorRecord = Record<string, any>

export interface Collection {
  /** Names the raw-archive folder and the lastSyncCounts key. */
  type: string
  pages(ctx: SyncContext): AsyncIterable<VendorRecord[]>
  /** null archives the raw record without storing an entity. */
  normalize(record: VendorRecord): Entity | null
  idOf(record: VendorRecord): string | number
  /**
   * 'put' replaces the item. 'merge' sets only the fields present, for
   * bands that deliver one entity across several collections.
   */
  write?: 'put' | 'merge'
  /** A failure is logged and the rest of the sync carries on. */
  optional?: boolean
}

export interface StrapProvider {
  id: ProviderId
  label: string
  /** SSM path holding client-id and client-secret. */
  ssmPrefix: string
  storage: {
    connectionSk: string
    connectionType: string
    /** Sparse-index partition listing this band's connected users. */
    gsi1pk: string
    mappingPk(externalUserId: string): string
    mappingType: string
    /** Extra connection attribute that repeats the external id (legacy). */
    externalIdAlias?: string
    rawPrefix: string
  }
  capabilities: Capabilities
  /** Refresh tokens are single-use: a concurrent refresh can strand us. */
  rotatesRefreshToken: boolean
  /** The vendor tells us when data changes, so the app need not ask. */
  pushesChanges: boolean
  /** How far a backfill reaches; absent means all history. */
  backfillDays?: number
  authorizeUrl(creds: Credentials, redirectUri: string, state: string): string
  exchangeCode(creds: Credentials, code: string, redirectUri: string): Promise<Tokens>
  /** Always returns a refresh token (the old one if the vendor sent none). */
  refresh(creds: Credentials, refreshToken: string): Promise<Tokens>
  /** Whether a refresh failure means the user must reconnect. */
  isAuthDead(err: unknown): boolean
  identify(accessToken: string): Promise<{ externalUserId: string }>
  collections: Collection[]
  /** Connection-level facts fetched each sync (e.g. body weight). */
  extras?(accessToken: string): Promise<Record<string, unknown>>
  /** Seam for scores we compute ourselves; unused so far. */
  derive?(userId: string, since?: Date): Promise<void>
}

export interface Connection extends Tokens {
  provider: ProviderId
  externalUserId: string
  status: 'active' | 'error'
  connectedAt: string
  lastSyncAt?: string
  syncRequestedAt?: string
  backfillDone?: boolean
  lastSyncCounts?: Record<string, number>
  bodyWeightKg?: number
}

/** The account authorised us but has nothing to sync yet. */
export class StrapNotLinkedError extends Error {}
