import type { BlockProposal, VolumeRow } from '../../lib/agent/types'
import { WEEKDAY_SHORT } from '../../lib/mesocycle'
import { Button } from '../cadence/Button'

const ZONE_LABEL: Record<VolumeRow['zone'], string> = {
  below: 'low',
  maintenance: 'maintain',
  productive: 'productive',
  high: 'high',
  over: 'over max',
}

/** 'MON' becomes 'Mon'. */
const dayName = (i: number | undefined) =>
  i == null ? 'Any' : WEEKDAY_SHORT[i][0] + WEEKDAY_SHORT[i].slice(1).toLowerCase()

/**
 * Week-one weekly sets for one muscle on a track that ends at its maximum
 * recoverable volume, with a tick at the minimum effective dose. The
 * number and the zone are always written out; the fill only repeats them.
 */
function VolumeMeter({ row }: { row: VolumeRow }) {
  const pct = Math.min(100, (row.sets / row.mrv) * 100)
  const tick = row.mev > 0 ? Math.min(100, (row.mev / row.mrv) * 100) : null
  const fill =
    row.zone === 'productive'
      ? 'bg-brand'
      : row.zone === 'high' || row.zone === 'over'
        ? 'bg-amber'
        : 'bg-ink-4'
  return (
    <div className="grid grid-cols-[104px_1fr_auto] items-center gap-3 py-1">
      <span className="truncate text-caption text-ink">
        {row.muscle}
        {row.focus && <span className="text-brand-strong"> · focus</span>}
      </span>
      <span
        role="img"
        aria-label={`${row.sets} of ${row.mrv} sets, ${ZONE_LABEL[row.zone]}`}
        className="relative h-2 rounded-pill bg-surface-3"
      >
        <span
          className={`absolute inset-y-0 left-0 rounded-pill ${fill}`}
          style={{ width: `${pct}%` }}
        />
        {tick != null && (
          <span
            className="absolute -inset-y-0.5 w-0.5 rounded-pill bg-ink-2"
            style={{ left: `${tick}%` }}
          />
        )}
      </span>
      <span className="w-[92px] text-right text-caption text-ink-2">
        <span className="font-semibold text-ink">{row.sets}</span>{' '}
        {ZONE_LABEL[row.zone]}
      </span>
    </div>
  )
}

/**
 * A block the coach proposed and the engine passed: the days, week-one
 * volume against the landmarks, and the two ways forward. Save starts it
 * today; Customize opens it in the block editor first.
 */
export function BlockCard({
  proposal,
  saved,
  replaces,
  onSave,
  onCustomize,
}: {
  proposal: BlockProposal
  saved: boolean
  /** The active block this one would end, if there is one. */
  replaces?: string
  onSave: () => void
  onCustomize: () => void
}) {
  const sets = proposal.days.reduce(
    (n, d) => n + d.exercises.reduce((m, e) => m + e.setCount, 0),
    0,
  )
  const notes = [...proposal.adjustments, ...proposal.warnings]
  return (
    <div className="rounded-lg bg-surface-2 p-4">
      <p className="text-eyebrow text-ink-2">Block proposal</p>
      <h3 className="mt-0.5 text-title text-ink">{proposal.name}</h3>
      <p className="text-caption text-ink-2">
        {proposal.weeks} weeks · {proposal.days.length} days · {sets} sets a week
        {proposal.focus.length > 0 && ` · focus ${proposal.focus.join(', ')}`}
      </p>
      {proposal.rationale && (
        <p className="mt-2 text-caption text-ink-2">{proposal.rationale}</p>
      )}

      <div className="mt-3 flex flex-col">
        {proposal.days.map((d, i) => (
          <div key={i}>
            {i > 0 && <div aria-hidden="true" className="h-px bg-hairline" />}
            <div className="flex gap-3 py-2">
              <span className="w-9 shrink-0 pt-0.5 text-eyebrow text-ink-3">
                {dayName(d.weekday)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-body font-medium text-ink">
                    {d.label}
                  </span>
                  <span className="shrink-0 text-caption text-ink-3">
                    {proposal.minutes[i]} min
                  </span>
                </div>
                <p className="text-caption text-ink-2">
                  {d.exercises.map((e) => `${e.name} ${e.setCount}`).join(' · ')}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <p className="mt-3 text-eyebrow text-ink-2">Weekly sets, week 1</p>
      <div className="mt-1">
        {proposal.volume.map((row) => (
          <VolumeMeter key={row.muscle} row={row} />
        ))}
      </div>
      <p className="mt-1 text-micro text-ink-3">
        Each track ends at that muscle&rsquo;s weekly maximum. The tick is the
        least that still builds; under it is maintenance.
      </p>

      {notes.length > 0 && (
        <p className="mt-2 text-caption text-ink-3">Engine: {notes.join(' ')}</p>
      )}

      {saved ? (
        <p className="mt-3.5 text-body font-medium text-brand-strong">
          Saved. Edit it any time from Plan.
        </p>
      ) : (
        <>
          <div className="mt-3.5 flex gap-2">
            <Button variant="primary" className="flex-1" onClick={onSave}>
              Save block
            </Button>
            <Button variant="quiet" className="flex-1" onClick={onCustomize}>
              Customize
            </Button>
          </div>
          {replaces && (
            <p className="mt-2 text-caption text-ink-3">
              Saving ends {replaces}.
            </p>
          )}
        </>
      )}
    </div>
  )
}
