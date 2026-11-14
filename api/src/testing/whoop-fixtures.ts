// WHOOP v2 records in the vendor's shape, as the developer API returns them.

export const whoopSleep = {
  id: 'ecfc6a15-4661-442f-a9a4-f160dd7afae8',
  cycle_id: 93845,
  user_id: 10129,
  created_at: '2026-11-10T11:25:44.774Z',
  updated_at: '2026-11-10T14:25:44.774Z',
  start: '2026-11-10T02:25:44.774Z',
  end: '2026-11-10T10:25:44.774Z',
  timezone_offset: '-05:00',
  nap: false,
  score_state: 'SCORED',
  score: {
    stage_summary: {
      total_in_bed_time_milli: 30272735,
      total_awake_time_milli: 1403507,
      total_no_data_time_milli: 0,
      total_light_sleep_time_milli: 14905851,
      total_slow_wave_sleep_time_milli: 6630370,
      total_rem_sleep_time_milli: 5879573,
      sleep_cycle_count: 3,
      disturbance_count: 12,
    },
    sleep_needed: { baseline_milli: 27395716 },
    respiratory_rate: 16.11328125,
    sleep_performance_percentage: 98,
    sleep_consistency_percentage: 90,
    sleep_efficiency_percentage: 91.69533848,
  },
}

export const whoopSleepUnscored = {
  id: 'a1b2c3d4-0000-4000-8000-000000000001',
  updated_at: '2026-11-11T12:00:00.000Z',
  start: '2026-11-11T03:00:00.000Z',
  end: '2026-11-11T11:00:00.000Z',
  timezone_offset: '-05:00',
  score_state: 'PENDING_SCORE',
}

export const whoopWorkout = {
  id: '1043e0f5-5d1c-4f0a-9a7e-2b0c3a0c7f11',
  user_id: 10129,
  updated_at: '2026-11-10T19:25:44.774Z',
  start: '2026-11-10T17:25:44.774Z',
  end: '2026-11-10T18:25:44.774Z',
  timezone_offset: '-05:00',
  sport_name: 'running',
  sport_id: 0,
  score_state: 'SCORED',
  score: {
    strain: 8.2463,
    average_heart_rate: 123,
    max_heart_rate: 146,
    kilojoule: 1569.34033203125,
    percent_recorded: 100,
    distance_meter: 1772.77035916,
    altitude_gain_meter: 46.64384460449,
    zone_durations: {
      zone_zero_milli: 300000,
      zone_one_milli: 600000,
      zone_two_milli: 900000,
      zone_three_milli: 900000,
      zone_four_milli: 600000,
      zone_five_milli: 300000,
    },
  },
}

export const whoopCycle = {
  id: 93845,
  user_id: 10129,
  updated_at: '2026-11-10T11:25:44.774Z',
  start: '2026-11-10T02:25:44.774Z',
  end: '2026-11-11T02:10:00.000Z',
  timezone_offset: '-05:00',
  score_state: 'SCORED',
  score: {
    strain: 5.2951527,
    kilojoule: 8288.297,
    average_heart_rate: 68,
    max_heart_rate: 141,
  },
}

export const whoopCycleOngoing = {
  id: 93846,
  updated_at: '2026-11-11T11:00:00.000Z',
  start: '2026-11-11T02:10:00.000Z',
  end: null,
  timezone_offset: '-05:00',
  score_state: 'PENDING_SCORE',
}

export const whoopRecovery = {
  cycle_id: 93845,
  sleep_id: 'ecfc6a15-4661-442f-a9a4-f160dd7afae8',
  user_id: 10129,
  created_at: '2026-11-10T11:25:44.774Z',
  updated_at: '2026-11-10T14:25:44.774Z',
  score_state: 'SCORED',
  score: {
    user_calibrating: false,
    recovery_score: 44,
    resting_heart_rate: 64,
    hrv_rmssd_milli: 31.813562,
    spo2_percentage: 95.6875,
    skin_temp_celsius: 33.7,
  },
}
