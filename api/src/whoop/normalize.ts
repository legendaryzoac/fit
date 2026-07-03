/**
 * WHOOP v2 records → wearable-agnostic DynamoDB entities.
 *
 * Every entity gets an ISO-dated sort key so date-range queries are a
 * `between` on sk. Fields WHOOP hasn't scored yet come through undefined and
 * are dropped by the document client (removeUndefinedValues).
 */

type WhoopRecord = Record<string, any>

export interface Entity {
  sk: string
  [key: string]: unknown
}

const toMin = (ms: unknown): number | undefined =>
  typeof ms === 'number' ? Math.round(ms / 6000) / 10 : undefined

export function normalizeSleep(r: WhoopRecord): Entity {
  const stages = r.score?.stage_summary ?? {}
  return {
    sk: `SLEEP#${r.end}#${r.id}`,
    type: 'sleep',
    source: 'whoop',
    id: r.id,
    start: r.start,
    end: r.end,
    timezoneOffset: r.timezone_offset,
    nap: r.nap ?? false,
    scoreState: r.score_state,
    inBedMin: toMin(stages.total_in_bed_time_milli),
    awakeMin: toMin(stages.total_awake_time_milli),
    lightMin: toMin(stages.total_light_sleep_time_milli),
    deepMin: toMin(stages.total_slow_wave_sleep_time_milli),
    remMin: toMin(stages.total_rem_sleep_time_milli),
    sleepCycles: stages.sleep_cycle_count,
    disturbances: stages.disturbance_count,
    respiratoryRate: r.score?.respiratory_rate,
    performancePct: r.score?.sleep_performance_percentage,
    consistencyPct: r.score?.sleep_consistency_percentage,
    efficiencyPct: r.score?.sleep_efficiency_percentage,
    updatedAt: r.updated_at,
  }
}

export function normalizeWorkout(r: WhoopRecord): Entity {
  const zones = r.score?.zone_durations ?? {}
  return {
    sk: `SESSION#${r.start}#${r.id}`,
    type: 'session',
    source: 'whoop',
    id: r.id,
    sport: r.sport_name ?? (r.sport_id != null ? String(r.sport_id) : 'unknown'),
    start: r.start,
    end: r.end,
    timezoneOffset: r.timezone_offset,
    scoreState: r.score_state,
    strain: r.score?.strain,
    avgHr: r.score?.average_heart_rate,
    maxHr: r.score?.max_heart_rate,
    kilojoule: r.score?.kilojoule,
    distanceM: r.score?.distance_meter,
    altitudeGainM: r.score?.altitude_gain_meter,
    percentRecorded: r.score?.percent_recorded,
    zoneMin: {
      z0: toMin(zones.zone_zero_milli),
      z1: toMin(zones.zone_one_milli),
      z2: toMin(zones.zone_two_milli),
      z3: toMin(zones.zone_three_milli),
      z4: toMin(zones.zone_four_milli),
      z5: toMin(zones.zone_five_milli),
    },
    updatedAt: r.updated_at,
  }
}

export function normalizeCycle(r: WhoopRecord): Entity {
  return {
    sk: `CYCLE#${r.start}#${r.id}`,
    type: 'cycle',
    source: 'whoop',
    id: r.id,
    start: r.start,
    end: r.end ?? undefined, // null while the cycle is ongoing
    timezoneOffset: r.timezone_offset,
    scoreState: r.score_state,
    strain: r.score?.strain,
    kilojoule: r.score?.kilojoule,
    avgHr: r.score?.average_heart_rate,
    maxHr: r.score?.max_heart_rate,
    updatedAt: r.updated_at,
  }
}

export function normalizeRecovery(r: WhoopRecord): Entity {
  return {
    sk: `RECOVERY#${r.created_at}#${r.cycle_id}`,
    type: 'recovery',
    source: 'whoop',
    cycleId: r.cycle_id,
    sleepId: r.sleep_id,
    scoreState: r.score_state,
    userCalibrating: r.score?.user_calibrating,
    recoveryScore: r.score?.recovery_score,
    rhr: r.score?.resting_heart_rate,
    hrvMs: r.score?.hrv_rmssd_milli,
    spo2Pct: r.score?.spo2_percentage,
    skinTempC: r.score?.skin_temp_celsius,
    updatedAt: r.updated_at,
  }
}
