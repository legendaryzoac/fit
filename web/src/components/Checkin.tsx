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
import { Button } from './cadence/Button'
import { Card, CardHead } from './cadence/Card'
import { ListItem } from './cadence/ListItem'
import { IconCheck } from './shell/icons'
import { Segment } from './shell/Segment'

/**
 * The daily readiness check-in: the wearable-free signal. Four items,
 * higher is better on every one, against the person's own baseline.
 */

const SCALE_OPTIONS = ['1', '2', '3', '4', '5'].map((v) => ({
  value: v,
  label: v,
}))

const REGIONS = MUSCLE_GROUPS.filter((m) => m !== 'other' && m !== 'full body')

/** 28-day sparkline on a FIXED 1–5 scale; missing days stay gaps — runs of
 * consecutive logged days draw as polylines, isolated days as dots. The
 * shared Sparkline autoscales and can't show gaps, so this stays local. */
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
          stroke="var(--ink-3)"
          strokeWidth="1"
          strokeDasharray="2 3"
        />
      )}
      {runs.map((r, i) => (
        <polyline
          key={i}
          points={r}
          fill="none"
          stroke="var(--brand)"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      ))}
      {singles.map(([cx, cy], i) => (
        <circle key={`s${i}`} cx={cx} cy={cy} r="2" fill="var(--brand)" />
      ))}
      {last != null && (
        <circle
          cx={x(points.length - 1)}
          cy={y(last)}
          r="3.5"
          fill="var(--brand)"
        />
      )}
    </svg>
  )
}

export function CheckinCard({
  checkins,
  onSave,
}: {
  checkins: Checkin[]
  onSave: (patch: Partial<Checkin>) => void
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
          // A line needs a few days to be a line; a baseline needs a week.
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
      <Card>
        <CardHead
          title="Readiness"
          action={
            editing ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditing(false)
                  setDraft({})
                }}
              >
                Cancel
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setLater(true)}>
                Later
              </Button>
            )
          }
        />
        <div className="mt-3.5 flex flex-col gap-3.5">
          {CHECKIN_ITEMS.map((it) => (
            <div key={it.key}>
              <div className="mb-1.5 flex items-baseline justify-between">
                <span className="text-caption font-semibold text-ink-2">
                  {it.label}
                </span>
                <span className="text-caption text-ink-3">
                  {it.low} to {it.high}
                </span>
              </div>
              <Segment
                options={SCALE_OPTIONS}
                value={value(it.key) == null ? undefined : String(value(it.key))}
                onChange={(v) =>
                  // Functional: taps can land faster than re-renders
                  setDraft((d) => ({ ...d, [it.key]: Number(v) }))
                }
                block
                ariaLabel={it.label}
              />
            </div>
          ))}
          {value('soreness') != null && (value('soreness') as number) <= 3 && (
            <div>
              <p className="mb-1.5 text-caption font-semibold text-ink-2">
                Sore where
              </p>
              <div className="flex flex-wrap gap-1.5">
                {REGIONS.map((r) => {
                  const on = regions.includes(r)
                  return (
                    <button
                      key={r}
                      type="button"
                      aria-pressed={on}
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
                      className={`rounded-pill px-2.5 py-1 text-caption font-medium capitalize ${
                        on ? 'bg-brand text-on-brand' : 'bg-surface-2 text-ink-2'
                      }`}
                    >
                      {r}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          <Button variant="primary" block disabled={!complete} onClick={submit}>
            Save
          </Button>
        </div>
      </Card>
    )
  }

  if (!checkinComplete(current)) {
    return (
      <ListItem
        lead={<IconCheck />}
        leadTone="neutral"
        title="Log today's check-in"
        chevron
        onClick={() => setLater(false)}
      />
    )
  }

  return (
    <Card>
      <CardHead
        title="Readiness"
        action={
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            Edit
          </Button>
        }
      />
      <div className="mt-3.5 grid grid-cols-2 gap-x-4 gap-y-3.5">
        {series.map((s) => (
          <div key={s.key}>
            <div className="flex items-baseline justify-between">
              <span className="text-eyebrow text-ink-2">{s.label}</span>
              <span className="text-numeric-lg text-ink">
                {current?.[s.key] ?? '—'}
                <span className="text-caption text-ink-3">/5</span>
              </span>
            </div>
            {s.spark && (
              <div className="mt-1">
                <MiniSpark points={s.points} baseline={s.baseline} />
              </div>
            )}
          </div>
        ))}
      </div>
      {(series.some((s) => s.spark) || current?.prs != null) && (
        <div className="mt-2 flex items-baseline justify-between text-caption text-ink-3">
          <span>{series.some((s) => s.spark) ? '28 d' : ''}</span>
          {current?.prs != null && <span>Recovered {current.prs}</span>}
        </div>
      )}
      {flags.length > 0 && (
        <div className="mt-2 flex flex-col gap-0.5">
          {flags.map((f) => {
            const label = CHECKIN_ITEMS.find((i) => i.key === f.key)?.label ?? f.key
            return (
              <p key={f.key} className="text-caption font-semibold text-amber-strong">
                {label} {Math.abs(f.z).toFixed(1)} SD {f.z < 0 ? 'below' : 'above'}{' '}
                baseline, {f.days} d
              </p>
            )
          })}
        </div>
      )}
    </Card>
  )
}
