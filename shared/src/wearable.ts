// The one wearable data format. Every band's adapter converts into these
// records, the API stores and serves them, and the web reads them — so a
// new band is auth, fetch and conversion, never a new shape.
//
// Types only: this package has no runtime code and nothing to build.
//
// Same shape is not same meaning. Bands measure differently (WHOOP reports
// HRV from deep sleep, Fitbit a whole-night average), and none of them
// fills every field, so every metric is optional and every record says
// which band it came from.

/** A band the app can link. Also the `source` tag on its records. */
export type ProviderId = 'whoop' | 'google'

/** One sleep, night or nap. Instants are UTC ISO strings. */
export interface SleepRecord {
  source?: ProviderId
  start?: string
  end: string
  /** The wearer's UTC offset at the time, always `±HH:MM`. */
  timezoneOffset?: string
  nap: boolean
  inBedMin?: number
  awakeMin?: number
  lightMin?: number
  deepMin?: number
  remMin?: number
  sleepCycles?: number
  disturbances?: number
  respiratoryRate?: number
  /** Asleep ÷ in bed. */
  efficiencyPct?: number
  /** Sleep got ÷ sleep needed (WHOOP). */
  performancePct?: number
  consistencyPct?: number
  scoreState?: string
}

/** The morning's vitals for one day, measured over the night before. */
export interface DailyVitals {
  source?: ProviderId
  /**
   * When the reading belongs to: a civil date (`YYYY-MM-DD`) from bands
   * that report per day, or the UTC instant it was scored (WHOOP).
   * Either way the first ten characters are a date.
   */
  date: string
  /** 0–100. Absent on bands that publish no score. */
  recoveryScore?: number
  /** Who computed the score: the band's vendor, or our own model. */
  scoreSource?: 'vendor' | 'model'
  rhr?: number
  /** The band's headline HRV (RMSSD, ms). */
  hrvMs?: number
  /** RMSSD during deep sleep only, where the band reports it separately. */
  hrvDeepSleepMs?: number
  spo2Pct?: number
  /** Absolute skin temperature overnight. */
  skinTempC?: number
  /** Overnight skin temperature minus the wearer's own baseline. */
  skinTempDeviationC?: number
  scoreState?: string
  userCalibrating?: boolean
}

/** One day's step count, by civil date. */
export interface DailySteps {
  source?: ProviderId
  date: string
  steps: number
}

/** A day's cardiovascular load (WHOOP's sleep-to-sleep cycle). */
export interface DailyLoad {
  source?: ProviderId
  start: string
  end?: string
  timezoneOffset?: string
  strain?: number
  kilojoule?: number
  avgHr?: number
  maxHr?: number
  scoreState?: string
}

/** A workout the band captured on its own. `sk` is its link handle. */
export interface SessionRecord {
  sk: string
  source?: ProviderId
  sport?: string
  start: string
  end?: string
  timezoneOffset?: string
  strain?: number
  avgHr?: number
  maxHr?: number
  kilojoule?: number
  distanceM?: number
  altitudeGainM?: number
  percentRecorded?: number
  zoneMin?: {
    z0?: number
    z1?: number
    z2?: number
    z3?: number
    z4?: number
    z5?: number
  }
  scoreState?: string
}

/**
 * What a band can ever supply. The UI shows a metric when its field has
 * data; these only hide whole sections a band will never fill.
 */
export interface Capabilities {
  recoveryScore: boolean
  strain: boolean
  sessions: boolean
  steps: boolean
}

/** The linked band's presentation state. Never tokens. */
export interface StrapStatus {
  provider?: ProviderId
  connected: boolean
  status?: 'active' | 'error'
  lastSyncAt?: string | null
  backfillDone?: boolean
  bodyWeightLb?: number
  capabilities?: Capabilities
}

export interface ProviderInfo {
  id: ProviderId
  label: string
}

/** GET /api/me */
export interface MeResponse {
  userId?: string
  createdAt?: string
  /** The WHOOP connection alone, kept for app versions that predate `strap`. */
  whoop: StrapStatus
  strap?: StrapStatus
  /** Bands that can be linked right now (their credentials are configured). */
  providers?: ProviderInfo[]
}

/** GET /api/metrics */
export interface MetricsResponse {
  days: number
  recoveries: DailyVitals[]
  sleeps: SleepRecord[]
  cycles: DailyLoad[]
  steps?: DailySteps[]
}

/** GET /api/sessions */
export interface SessionsResponse {
  sessions: SessionRecord[]
}
