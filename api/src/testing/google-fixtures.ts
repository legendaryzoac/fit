// Google Health API (v4) responses, built from the documented shapes at
// developers.google.com/health — NOT recorded from a real Fitbit Air.
// Replace with recorded payloads once a band is connected.

const offset = { startUtcOffset: '-18000s', endUtcOffset: '-18000s' }

/** A reconciled sleep data point with stages (the common overnight case). */
export const googleSleep = {
  dataPointName: 'users/abc123/dataTypes/sleep/dataPoints/sleep-8841',
  sleep: {
    interval: {
      startTime: '2026-11-11T03:30:00Z',
      endTime: '2026-11-11T11:30:00Z',
      ...offset,
    },
    type: 'STAGES',
    stages: [
      { startTime: '2026-11-11T03:30:00Z', endTime: '2026-11-11T04:45:00Z', ...offset, type: 'LIGHT' },
      { startTime: '2026-11-11T04:45:00Z', endTime: '2026-11-11T06:15:00Z', ...offset, type: 'DEEP' },
    ],
    metadata: { stagesStatus: 'SUCCEEDED', processed: true, nap: false, mainSleep: true },
    summary: {
      stagesSummary: [
        { type: 'AWAKE', minutes: '25', count: '9' },
        { type: 'LIGHT', minutes: '260', count: '21' },
        { type: 'DEEP', minutes: '85', count: '4' },
        { type: 'REM', minutes: '110', count: '6' },
      ],
      minutesInSleepPeriod: '480',
      minutesAsleep: '455',
      minutesAwake: '25',
      minutesToFallAsleep: '0',
      minutesAfterWakeUp: '0',
    },
    createTime: '2026-11-11T11:42:00Z',
    updateTime: '2026-11-11T11:42:10Z',
  },
}

/** A short afternoon nap: a "classic" log, no light/deep/REM split. */
export const googleNap = {
  dataPointName: 'users/abc123/dataTypes/sleep/dataPoints/sleep-8842',
  sleep: {
    interval: {
      startTime: '2026-11-11T19:00:00Z',
      endTime: '2026-11-11T19:50:00Z',
      ...offset,
    },
    type: 'CLASSIC',
    stages: [
      { startTime: '2026-11-11T19:00:00Z', endTime: '2026-11-11T19:44:00Z', ...offset, type: 'ASLEEP' },
      { startTime: '2026-11-11T19:44:00Z', endTime: '2026-11-11T19:50:00Z', ...offset, type: 'AWAKE' },
    ],
    metadata: { stagesStatus: 'REJECTED_NAP', nap: true, mainSleep: false },
  },
}

const date = { year: 2026, month: 11, day: 11 }

export const googleDailyHrv = {
  dailyHeartRateVariability: {
    date,
    averageHeartRateVariabilityMilliseconds: 48.2,
    nonRemHeartRateBeatsPerMinute: '52',
    entropy: 2.71,
    deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds: 55.1,
  },
}

export const googleDailyRhr = {
  dailyRestingHeartRate: { date, beatsPerMinute: '54' },
}

export const googleDailySpo2 = {
  dailyOxygenSaturation: {
    date,
    averagePercentage: 96.4,
    lowerBoundPercentage: 93.1,
    upperBoundPercentage: 98.9,
    standardDeviationPercentage: 1.2,
  },
}

export const googleDailyTemp = {
  dailySleepTemperatureDerivations: {
    date,
    nightlyTemperatureCelsius: 34.12,
    baselineTemperatureCelsius: 33.95,
    relativeNightlyStddev30dCelsius: 0.23,
  },
}

export const googleStepsDay = (day: number, countSum?: string) => ({
  civilStartTime: { date: { year: 2026, month: 11, day }, time: {} },
  civilEndTime: { date: { year: 2026, month: 11, day: day + 1 }, time: {} },
  ...(countSum !== undefined && { steps: { countSum } }),
})

export const googleScopes = [
  'https://www.googleapis.com/auth/googlehealth.sleep.readonly',
  'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly',
  'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
]

export const googleNotLinked = {
  error: {
    code: 400,
    message: 'The account is not linked to Google Health.',
    status: 'FAILED_PRECONDITION',
    details: [
      {
        '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
        reason: 'ACCOUNT_NOT_LINKED',
        domain: 'health.googleapis.com',
        metadata: { redirect_uri: 'https://fitbit.google.com/auth/signup' },
      },
    ],
  },
}
