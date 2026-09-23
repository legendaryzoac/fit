import { useMemo, useState } from 'react'
import {
  CHECKIN_ITEMS,
  checkinComplete,
  todayCheckin,
  type Checkin,
  type CheckinItemKey,
} from '../lib/checkins'
import { MUSCLE_GROUPS } from '../lib/exercises'
import { localToday } from '../lib/weights'
import { baselineAt, dailySeries, flagFor } from '../lib/wellness'
import { Segmented } from './Feedback'
import { buttonClass } from './ui'

/**
 * The daily readiness check-in and its trend strip. One screen, four taps,
 * under twenty seconds; then today's dot on four personal sparklines, so
 * the entry visibly feeds back. Higher is better on every item.
 */

const SCALE: Array<{ value: '1' | '2' | '3' | '4' | '5'; label: string }> = [
  { value: '1', label: '1' },
  { value: '2', label: '2' },
  { value: '3', label: '3' },
  { value: '4', label: '4' },
  { value: '5', label: '5' },
]

const REGIONS = MUSCLE_GROUPS.filter((m) => m !== 'other' && m !== 'full body')

/** 28-day sparkline on a fixed 1–5 scale; missing days stay gaps. */
function MiniSpark({
  points,
  baseline,
}: {
  points: Array<number | null>
  baseline: number | null
}) {
  const W = 160
  const H = 34
  const x = (i: number) => (i / Math.max(1, points.length - 1)) * (W - 6) + 3
  const y = (v: number) => H - 4 - ((v - 1) / 4) * (H - 8)
  // Split into runs of consecutive logged days so gaps are never bridged
  const runs: string[] = []
  const singles: Array<[number, number]> = []
  let run: string[] = []
  points.forEach((v, i) => {
    if (v == null) {
      if (run.length === 1) singles.push([x(i - 1), y(points[i - 1] as number)])
      if (run.length > 1) runs.push(run.join(' '))
      run = []
      return
    }
    run.push(`${x(i)},${y(v)}`)
  })
  if (run.length === 1) {
    singles.push([x(points.length - 1), y(points[points.length - 1] as number)])
  }
  if (run.length > 1) runs.push(run.join(' '))
  const last = points[points.length - 1]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-9 w-full" aria-hidden="true">
      {baseline != null && (
        <line
          x1="0"
          x2={W}
          y1={y(baseline)}
          y2={y(baseline)}
          stroke="#201e1d"
          strokeWidth="1"
          strokeDasharray="2 3"
          opacity=".45"
        />
      )}
      {runs.map((r, i) => (
        <polyline
          key={i}
          points={r}
          fill="none"
          stroke="#e0a112"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      ))}
      {singles.map(([cx, cy], i) => (
        <rect key={`s${i}`} x={cx - 2} y={cy - 2} width="4" height="4" fill="#e0a112" />
      ))}
      {last != null && (
        <rect
          x={x(points.length - 1) - 3}
          y={y(last) - 3}
          width="6"
          height="6"
          fill="#8f6807"
        />
      )}
    </svg>
  )
}

export function CheckinCard({
  checkins,
  onSave,
  title = 'Readiness',
}: {
  checkins: Checkin[]
  onSave: (patch: Partial<Checkin>) => void
  title?: string
}) {
  const today = localToday()
  const current = todayCheckin(checkins)
  const [editing, setEditing] = useState(false)
  const [later, setLater] = useState(false)
  const [draft, setDraft] = useState<Partial<Checkin>>({})

  const value = (k: CheckinItemKey): number | undefined =>
    (draft[k] as number | undefined) ?? current?.[k]
  const regions = draft.soreRegions ?? current?.soreRegions ?? []
  const complete = CHECKIN_ITEMS.every((it) => value(it.key) != null)
  const showForm = editing || (!checkinComplete(current) && !later)

  const series = useMemo(
    () =>
      CHECKIN_ITEMS.map((it) => {
        const s = dailySeries(checkins, it.key, 28, today)
        const b = baselineAt(s, s.length - 1)
        const logged = s.filter((p) => p.value != null).length
        return {
          ...it,
          points: s.map((p) => p.value),
          // A line needs a few days to be a line; a baseline needs a week
          // to be a baseline. Until then, just the number.
          spark: logged >= 3,
          baseline: b && b.n >= 7 ? b.mean : null,
        }
      }),
    [checkins, today],
  )
  const flags = useMemo(
    () =>
      CHECKIN_ITEMS.map((it) => flagFor(checkins, it.key, today)).filter(
        (f): f is NonNullable<typeof f> => f !== null,
      ),
    [checkins, today],
  )

  function submit() {
    if (!complete) return
    onSave({
      sleep: value('sleep'),
      fatigue: value('fatigue'),
      soreness: value('soreness'),
      stress: value('stress'),
      soreRegions: regions.length > 0 ? regions : undefined,
    })
    setDraft({})
    setEditing(false)
  }

  if (showForm) {
    return (
      <section className="border-t-2 border-ink/40 pt-2.5">
        <div className="mb-2 flex items-baseline justify-between">
          <p className="kicker">
            {title}
            <span className="ml-2 font-semibold normal-case tracking-normal text-ink/45">
              higher is better
            </span>
          </p>
          {!checkinComplete(current) && !editing && (
            <button
              onClick={() => setLater(true)}
              className="text-[10px] font-semibold uppercase tracking-widest text-ink/45 hover:text-ink"
            >
              Later
            </button>
          )}
          {editing && (
            <button
              onClick={() => {
                setEditing(false)
                setDraft({})
              }}
              className="text-[10px] font-semibold uppercase tracking-widest text-ink/45 hover:text-ink"
            >
              Cancel
            </button>
          )}
        </div>
        <div className="flex flex-col gap-3">
          {CHECKIN_ITEMS.map((it) => (
            <div key={it.key}>
              <div className="mb-1 flex items-baseline justify-between text-[10px] font-semibold uppercase tracking-wider">
                <span className="text-ink">{it.label}</span>
              </div>
              <Segmented
                options={SCALE}
                value={
                  value(it.key) == null
                    ? undefined
                    : (String(value(it.key)) as (typeof SCALE)[number]['value'])
                }
                onChange={(v) =>
                  // Functional: taps can land faster than re-renders
                  setDraft((d) => ({ ...d, [it.key]: Number(v) }))
                }
              />
            </div>
          ))}
          {value('soreness') != null && (value('soreness') as number) <= 3 && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink/45">
                Sore where
              </p>
              <div className="flex flex-wrap gap-1.5">
                {REGIONS.map((r) => {
                  const on = regions.includes(r)
                  return (
                    <button
                      key={r}
                      onClick={() =>
                        setDraft((d) => {
                          const cur = d.soreRegions ?? current?.soreRegions ?? []
                          return {
                            ...d,
                            soreRegions: cur.includes(r)
                              ? cur.filter((x) => x !== r)
                              : [...cur, r],
                          }
                        })
                      }
                      className={`px-2 py-1 text-[10px] font-semibold uppercase tracking-wider ${
                        on
                          ? 'bg-ink text-paper'
                          : 'border border-ink/40 text-ink/60 hover:bg-ink/5'
                      }`}
                    >
                      {r}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          <button
            onClick={submit}
            disabled={!complete}
            className={`${buttonClass} w-full justify-between`}
          >
            Save check-in<span>→</span>
          </button>
        </div>
      </section>
    )
  }

  if (!checkinComplete(current)) {
    // Deferred for now — one line to bring it back
    return (
      <button
        onClick={() => setLater(false)}
        className="flex w-full items-center justify-between border border-ink/40 px-3 py-2 text-left text-sm font-semibold text-ink hover:bg-ink/5"
      >
        Log today’s check-in
        <span className="text-accent-700">→</span>
      </button>
    )
  }

  return (
    <section className="border-t-2 border-ink/40 pt-2.5">
      <div className="mb-1.5 flex items-baseline justify-between">
        <p className="kicker">{title}</p>
        <button
          onClick={() => setEditing(true)}
          className="text-[10px] font-semibold uppercase tracking-widest text-ink/45 hover:text-ink"
        >
          Edit
        </button>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        {series.map((s) => (
          <div key={s.key}>
            <div className="flex items-baseline justify-between">
              <span className="text-[9px] font-semibold tracking-widest text-ink/50">
                {s.label.toUpperCase()}
              </span>
              <span className="text-lg font-extrabold leading-none">
                {current?.[s.key] ?? '—'}
                <span className="text-[10px] font-semibold text-ink/45">/5</span>
              </span>
            </div>
            {s.spark && <MiniSpark points={s.points} baseline={s.baseline} />}
          </div>
        ))}
      </div>
      {(series.some((s) => s.spark) || current?.prs != null) && (
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 text-[9px] font-semibold tracking-widest text-ink/45">
          <span>{series.some((s) => s.spark) ? '28D' : ''}</span>
          {current?.prs != null && <span>PRS {current.prs}</span>}
        </div>
      )}
      {flags.length > 0 && (
        <div className="mt-2 flex flex-col gap-0.5">
          {flags.map((f) => {
            const label = CHECKIN_ITEMS.find((i) => i.key === f.key)?.label ?? f.key
            return (
              <p key={f.key} className="text-xs font-semibold text-accent-700">
                {label} {Math.abs(f.z).toFixed(1)} SD {f.z < 0 ? 'below' : 'above'}{' '}
                baseline, {f.days}d
              </p>
            )
          })}
        </div>
      )}
    </section>
  )
}
