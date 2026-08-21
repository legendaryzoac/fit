import { useEffect, useMemo, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { Api } from '../lib/api'
import { squareDot } from './Charts'
import {
  loadWeightCache,
  localToday,
  saveWeightCache,
  sortWeights,
  type WeightEntry,
} from '../lib/weights'
import { buttonClass, inputClass } from './ui'

/**
 * Manual body-weight log. Owns its own fetch/cache so it works on any tab
 * and offline; a typed entry always outranks WHOOP's measurement, which
 * is what keeps bodyweight lifts honest once a strap goes away.
 */
export function BodyWeight({
  api,
  whoopLb,
  onChange,
}: {
  api: Api
  whoopLb?: number
  onChange?: (entries: WeightEntry[]) => void
}) {
  const [entries, setEntries] = useState<WeightEntry[]>(loadWeightCache)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .get('/api/weights')
      .then(async (res) => {
        if (!res.ok) return
        const body = await res.json()
        if (!Array.isArray(body.weights)) return
        setEntries(body.weights)
        saveWeightCache(body.weights)
        onChange?.(body.weights)
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api])

  const sorted = useMemo(() => sortWeights(entries), [entries])
  /** Oldest-first for the trend chart. */
  const trend = useMemo(() => [...sorted].reverse(), [sorted])
  const newest = sorted[0]
  const prior = sorted.find((e) => e.date !== newest?.date)
  const delta =
    newest && prior ? Math.round((newest.lb - prior.lb) * 10) / 10 : null

  function save() {
    const lb = Number(draft)
    if (!Number.isFinite(lb) || lb < 40 || lb > 1200) {
      setError('Enter a weight between 40 and 1200 lb.')
      return
    }
    const entry: WeightEntry = {
      date: localToday(),
      lb: Math.round(lb * 10) / 10,
    }
    // Optimistic — one entry per day, today's overwrites
    const next = [...entries.filter((e) => e.date !== entry.date), entry]
    setEntries(next)
    saveWeightCache(next)
    onChange?.(next)
    setDraft('')
    setError(null)
    void api
      .send('POST', '/api/weights', entry)
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status))
      })
      .catch(() => setError('Saved locally — syncing needs a connection.'))
  }

  return (
    <section className="border-t-2 border-ink/40 pt-2.5">
      <div className="mb-2.5">
        <h2 className="kicker">Body weight</h2>
        <p className="mt-0.5 text-xs font-semibold text-ink/50">
          logged by hand · used for bodyweight lifts
        </p>
      </div>

      <div className="flex items-end justify-between">
        <div className="text-4xl font-extrabold leading-none tracking-tight">
          {newest ? newest.lb : (whoopLb ?? '—')}
          <span className="ml-1 text-base font-semibold">lb</span>
        </div>
        <div className="pb-1 text-right text-[10px] font-semibold uppercase tracking-wider text-ink/50">
          {newest ? (
            <>
              {newest.date}
              {delta != null && (
                <span
                  className={`block ${delta > 0 ? 'text-accent-700' : 'text-ink/55'}`}
                >
                  {delta > 0 ? '+' : ''}
                  {delta} since last
                </span>
              )}
            </>
          ) : whoopLb != null ? (
            <>from whoop</>
          ) : (
            <>no entries yet</>
          )}
        </div>
      </div>

      {trend.length > 1 && (
        <ResponsiveContainer width="100%" height={150}>
          <LineChart
            data={trend}
            margin={{ top: 8, right: 4, bottom: 0, left: -14 }}
          >
            <CartesianGrid stroke="rgba(32,30,29,.18)" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{
                fill: '#7d7979',
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '.06em',
              }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(d: string) => d.slice(5)}
              minTickGap={28}
            />
            <YAxis
              tick={{ fill: '#7d7979', fontSize: 10, fontWeight: 600 }}
              tickLine={false}
              axisLine={false}
              width={40}
              domain={['dataMin - 2', 'dataMax + 2']}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#f3f2f2',
                border: '1px solid #201e1d',
                borderRadius: 0,
                fontSize: 12,
                color: '#201e1d',
              }}
              labelStyle={{ color: '#201e1d', fontWeight: 600 }}
              formatter={(v) => [`${v} lb`, 'weight']}
            />
            <Line
              type="monotone"
              dataKey="lb"
              stroke="#ec3013"
              strokeWidth={2}
              dot={squareDot('#ec3013')}
              activeDot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      )}

      <div className="mt-3 flex gap-2">
        <input
          className={inputClass}
          type="number"
          inputMode="decimal"
          step="0.1"
          aria-label="today's body weight in pounds"
          placeholder={`today — lb${newest ? ` (last ${newest.lb})` : ''}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
        <button onClick={save} className={`${buttonClass} shrink-0`}>
          Log
        </button>
      </div>
      {error && (
        <p className="mt-1.5 text-xs font-semibold text-accent-700">{error}</p>
      )}

      {sorted.length > 1 && (
        <div className="mt-3">
          <div className="grid grid-cols-[1fr_auto] border-b-2 border-ink/40 pb-1 text-[9px] font-semibold uppercase tracking-widest text-ink/50">
            <span>date</span>
            <span>lb</span>
          </div>
          {sorted.slice(0, 8).map((e) => (
            <div
              key={e.date}
              className="grid grid-cols-[1fr_auto] border-b border-ink/20 py-1.5 text-sm"
            >
              <span className="text-ink/70">{e.date}</span>
              <span className="font-extrabold">{e.lb}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
