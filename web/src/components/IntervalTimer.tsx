import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { cue } from '../lib/cue'
import { SPEED_DRILLS } from '../lib/exercises'
import { lockScreenSupported, registerTimerControls } from '../lib/lockScreen'
import {
  fmtSec,
  sectionTone,
  totalSec,
  type SectionTone,
} from '../lib/templates'
import {
  backSection,
  saveTimerDraft,
  skipSection,
  timerSnapshot,
  type SessionRecord,
  type TimerDraft,
  type Workout,
  type WorkoutExercise,
} from '../lib/workouts'
import { Button } from './cadence/Button'
import { Card } from './cadence/Card'
import { Countdown, type CountdownTone } from './cadence/Countdown'
import { Field, TextArea, TextInput } from './cadence/Field'
import { IconButton } from './cadence/IconButton'
import { List, ListItem } from './cadence/ListItem'
import { Progress, SessionBar } from './cadence/SessionBar'
import { AddSetButton, SetHeader, SetRow } from './cadence/SetRow'
import { StatusPill } from './cadence/StatusPill'
import { LockScreenSwitch } from './LockScreenSwitch'
import { IconChevronDown, IconRun, IconX } from './shell/icons'
import { Sheet } from './shell/Sheet'
import { useSheetDismiss } from './shell/useSheetDismiss'

const MILE = 1609.34
const YD = 0.9144

/** Post-timer rep logging for speed sessions — feeds the sprint analytics. */
function DrillSetsEditor({
  drills,
  onChange,
}: {
  drills: WorkoutExercise[]
  onChange: (drills: WorkoutExercise[]) => void
}) {
  const [name, setName] = useState('')
  const nameId = useId()

  function addDrill() {
    const trimmed = name.trim()
    if (!trimmed) return
    onChange([...drills, { name: trimmed, sets: [{}] }])
    setName('')
  }

  const patch = (
    di: number,
    si: number,
    field: 'distanceM' | 'durationSec',
    raw: number | undefined,
  ) => {
    const value =
      raw === undefined
        ? undefined
        : field === 'distanceM'
          ? Math.round(raw * YD * 100) / 100
          : raw
    onChange(
      drills.map((d, i) =>
        i !== di
          ? d
          : {
              ...d,
              sets: d.sets.map((s, j) =>
                j !== si ? s : { ...s, [field]: value },
              ),
            },
      ),
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-caption font-semibold text-ink-2">Reps</p>
      {drills.map((d, di) => (
        <Card key={di}>
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-title-sm text-ink">
              {d.name}
            </p>
            <IconButton
              size="sm"
              label="Remove drill"
              onClick={() => onChange(drills.filter((_, i) => i !== di))}
            >
              <IconX />
            </IconButton>
          </div>
          <div className="mt-2 flex flex-col">
            <SetHeader labels={['yd', 's']} check={false} />
            {d.sets.map((s, si) => (
              <SetRow
                key={si}
                index={si + 1}
                fields={[
                  {
                    key: 'yd',
                    value:
                      s.distanceM != null
                        ? Math.round(s.distanceM / YD)
                        : undefined,
                    placeholder: '',
                    ariaLabel: `Rep ${si + 1} yards`,
                    inputMode: 'numeric',
                    onChange: (v) => patch(di, si, 'distanceM', v),
                  },
                  {
                    key: 's',
                    value: s.durationSec,
                    placeholder: '',
                    ariaLabel: `Rep ${si + 1} seconds`,
                    inputMode: 'decimal',
                    onChange: (v) => patch(di, si, 'durationSec', v),
                  },
                ]}
                onRemove={() =>
                  onChange(
                    drills.map((x, i) =>
                      i !== di
                        ? x
                        : { ...x, sets: x.sets.filter((_, j) => j !== si) },
                    ),
                  )
                }
              />
            ))}
            <AddSetButton
              label="Add rep"
              onClick={() =>
                onChange(
                  drills.map((x, i) =>
                    i !== di
                      ? x
                      : { ...x, sets: [...x.sets, { ...x.sets.at(-1) }] },
                  ),
                )
              }
            />
          </div>
        </Card>
      ))}
      <Card>
        <Field label="Drill" htmlFor={nameId}>
          <TextInput
            id={nameId}
            list="drill-names"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addDrill()}
          />
          <datalist id="drill-names">
            {SPEED_DRILLS.map((d) => (
              <option key={d.name} value={d.name} />
            ))}
          </datalist>
        </Field>
        <Button variant="quiet" block className="mt-3" onClick={addDrill}>
          Add drill
        </Button>
      </Card>
    </div>
  )
}

// Work shouts in ember, rest cools to sky, warm-up is a caution amber.
const TONE: Record<SectionTone, CountdownTone> = {
  warm: 'caution',
  work: 'effort',
  rest: 'rest',
  cool: 'neutral',
  other: 'neutral',
}

export function IntervalSession({
  initial,
  sessions,
  onSave,
  onCancel,
  onMinimize,
}: {
  initial: TimerDraft
  sessions: SessionRecord[]
  onSave: (w: Workout) => void
  onCancel: () => void
  onMinimize: () => void
}) {
  const [draft, setDraft] = useState<TimerDraft>(initial)
  const [now, setNow] = useState(Date.now())
  const [phase, setPhase] = useState<'run' | 'done'>('run')
  const [title, setTitle] = useState(initial.title ?? '')
  const [miles, setMiles] = useState('')
  const [notes, setNotes] = useState('')
  const [linkedSk, setLinkedSk] = useState<string | undefined>()
  const [drills, setDrills] = useState<WorkoutExercise[]>([])
  const lastIdxRef = useRef(0)
  const doneElapsedRef = useRef(0)
  // When the timer actually ENDED — lingering on the summary screen must
  // not drift the workout's date (a meso session bucketed by start date
  // could land in the wrong week if saved the next morning).
  const doneAtRef = useRef(Date.now())
  // A timer that ran out while this screen was unmounted already announced
  // itself (lock-screen driver) — resuming into it shouldn't beep again.
  const finishedAtMount = useRef(
    initial.sections.length > 0 && timerSnapshot(initial, Date.now()).finished,
  )
  const titleId = useId()
  const milesId = useId()
  const notesId = useId()

  // Every way out unmounts this screen in the parent, so the sheet drops
  // first and the real callback waits for the exit to finish.
  const { open, dismiss, onExited } = useSheetDismiss()

  const sections = draft.sections
  const stopwatch = sections.length === 0
  const total = useMemo(() => totalSec(sections), [sections])
  const cumEnd = useMemo(() => {
    let acc = 0
    return sections.map((s) => (acc += s.durationSec))
  }, [sections])

  useEffect(() => {
    if (phase === 'run') saveTimerDraft(draft)
  }, [draft, phase])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [])

  const elapsedMs = draft.paused
    ? draft.pausedElapsedMs
    : now - draft.startEpoch + draft.skipOffsetMs
  const elapsedSec = elapsedMs / 1000
  const idx = cumEnd.findIndex((end) => elapsedSec < end)
  const finished = !stopwatch && idx === -1
  const current = (finished ? sections[sections.length - 1] : sections[idx]) ?? {
    label: 'Work',
    durationSec: 1,
  }
  const remaining = finished ? 0 : cumEnd[idx] - elapsedSec
  const next = finished || idx === sections.length - 1 ? null : sections[idx + 1]

  useEffect(() => {
    if (stopwatch) return
    if (phase !== 'run') return
    if (!finished && idx !== lastIdxRef.current) {
      lastIdxRef.current = idx
      cue(2)
    }
    if (finished) {
      doneElapsedRef.current = Math.min(elapsedMs, total * 1000)
      doneAtRef.current = Date.now()
      saveTimerDraft(null)
      if (!finishedAtMount.current) cue(3)
      setPhase('done')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, finished, phase])

  // Lock-screen media keys drive this screen while it's mounted. The ref
  // keeps the handlers on the freshest closures without re-registering.
  const controlsRef = useRef({ pause, resume, skip, back })
  controlsRef.current = { pause, resume, skip, back }
  useEffect(
    () =>
      registerTimerControls({
        pause: () => controlsRef.current.pause(),
        resume: () => controlsRef.current.resume(),
        skip: () => controlsRef.current.skip(),
        back: () => controlsRef.current.back(),
      }),
    [],
  )

  // These also fire from lock-screen media keys, which arrive in any state
  // (a headset can send play while running) and possibly while the 250ms
  // `now` state is stale from background throttling — so each one guards on
  // the draft itself and reads the clock at call time, not from the render.
  function pause() {
    setDraft((d) =>
      d.paused
        ? d
        : {
            ...d,
            paused: true,
            pausedElapsedMs: Date.now() - d.startEpoch + d.skipOffsetMs,
          },
    )
  }

  function resume() {
    setDraft((d) =>
      d.paused
        ? {
            ...d,
            paused: false,
            startEpoch: Date.now(),
            skipOffsetMs: d.pausedElapsedMs,
          }
        : d,
    )
  }

  function skip() {
    setDraft((d) => skipSection(d, Date.now()))
  }

  // Off the on-screen controls; the lock-screen previous-track key uses it.
  function back() {
    setDraft((d) => backSection(d, Date.now()))
  }

  // The one-tap way out of a running timer that keeps nothing: no summary,
  // no confirmation, the draft goes with it.
  function discard() {
    saveTimerDraft(null)
    dismiss(onCancel)
  }

  function endEarly() {
    doneElapsedRef.current = elapsedMs
    doneAtRef.current = Date.now()
    saveTimerDraft(null)
    setPhase('done')
  }

  function save() {
    const durMs = doneElapsedRef.current
    const doneAt = doneAtRef.current
    onSave({
      id: crypto.randomUUID(),
      // Approximate: paused time is excluded from the duration on purpose
      start: new Date(doneAt - durMs).toISOString(),
      end: new Date(doneAt).toISOString(),
      kind: draft.kind,
      title: title || undefined,
      weightUnit: 'lb',
      exercises: drills,
      ...(sections.length > 0 && { intervals: sections }),
      durationMin: Math.max(1, Math.round(durMs / 60_000)),
      distanceM: miles ? Math.round(Number(miles) * MILE) : undefined,
      notes: notes || undefined,
      linkedSessionSk: linkedSk,
      // meso cardio days count toward the block's day tracking
      mesoId: draft.mesoId,
      mesoDayIndex: draft.mesoDayIndex,
    })
  }

  // Scrim, Escape or a drag parks a running timer; once it has ended the
  // summary holds unsaved details, so the same gesture asks first.
  function close() {
    if (phase === 'run') {
      dismiss(onMinimize)
    } else if (window.confirm('Discard this session?')) {
      dismiss(onCancel)
    }
  }

  const heading = draft.title || (stopwatch ? 'Run' : 'Intervals')

  let body
  if (phase === 'done') {
    const linkCandidates = sessions.filter(
      (s) =>
        Math.abs(new Date(s.start).getTime() - Date.now()) < 6 * 3_600_000,
    )
    body = (
      <>
        <h2 className="text-title text-ink">Session complete</h2>
        <p className="text-display text-ink tabular-nums">
          {fmtSec(doneElapsedRef.current / 1000)}
        </p>
        <Field label="Title" htmlFor={titleId}>
          <TextInput
            id={titleId}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        {draft.kind === 'speed' && (
          <DrillSetsEditor drills={drills} onChange={setDrills} />
        )}
        {draft.kind === 'cardio' && (
          <>
            <Field label="Distance (mi)" htmlFor={milesId}>
              <TextInput
                id={milesId}
                type="number"
                inputMode="decimal"
                value={miles}
                onChange={(e) => setMiles(e.target.value)}
              />
            </Field>
            {linkCandidates.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <p className="text-caption font-semibold text-ink-2">
                  WHOOP session
                </p>
                <List>
                  {linkCandidates.map((s) => {
                    const linked = linkedSk === s.sk
                    return (
                      <ListItem
                        key={s.sk}
                        lead={<IconRun />}
                        leadTone={linked ? 'brand' : 'neutral'}
                        title={`${s.sport ?? 'Activity'} · ${new Date(
                          s.start,
                        ).toLocaleTimeString(undefined, { timeStyle: 'short' })}`}
                        sub={
                          s.avgHr != null
                            ? `${Math.round(s.avgHr)} bpm avg`
                            : undefined
                        }
                        trail={
                          linked ? (
                            <StatusPill tone="good">Linked</StatusPill>
                          ) : undefined
                        }
                        onClick={() => setLinkedSk(linked ? undefined : s.sk)}
                      />
                    )
                  })}
                </List>
              </div>
            )}
          </>
        )}
        <Field label="Notes" htmlFor={notesId}>
          <TextArea
            id={notesId}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
        <Button variant="primary" block onClick={() => dismiss(save)}>
          Save
        </Button>
        <Button variant="ghost" block onClick={() => dismiss(onCancel)}>
          Discard
        </Button>
      </>
    )
  } else {
    body = (
      <>
        <Countdown
          label={current.label}
          tone={TONE[sectionTone(current.label)]}
          time={
            stopwatch ? fmtSec(elapsedSec) : fmtSec(Math.ceil(remaining))
          }
          next={
            next
              ? `Next · ${next.label} ${fmtSec(next.durationSec)} · ${idx + 1} of ${sections.length}`
              : undefined
          }
          remaining={remaining / current.durationSec}
          paused={draft.paused}
          onPause={pause}
          onResume={resume}
          onSkip={stopwatch ? undefined : skip}
          stopwatch={stopwatch}
        />
        {lockScreenSupported() && (
          <Card>
            <LockScreenSwitch />
          </Card>
        )}
        {!stopwatch && (
          <List>
            {sections.map((s, i) => (
              <ListItem
                key={i}
                title={s.label}
                sub={fmtSec(s.durationSec)}
                muted={i < idx}
                trail={
                  i === idx ? <StatusPill tone="effort">Now</StatusPill> : undefined
                }
              />
            ))}
          </List>
        )}
      </>
    )
  }

  return (
    <Sheet open={open} onClose={close} onExited={onExited} ariaLabel="Timer">
      <SessionBar
        left={
          phase === 'run' && (
            <IconButton label="Minimise" onClick={() => dismiss(onMinimize)}>
              <IconChevronDown />
            </IconButton>
          )
        }
        center={
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-body font-medium text-ink">
              {heading}
            </span>
            {phase === 'run' && (
              <span className="shrink-0 text-caption text-ink-2 tabular-nums">
                {stopwatch
                  ? fmtSec(elapsedSec)
                  : `${fmtSec(Math.min(elapsedSec, total))} of ${fmtSec(total)}`}
              </span>
            )}
          </div>
        }
        right={
          phase === 'run' && (
            <div className="flex items-center gap-2">
              <IconButton label="Discard" onClick={discard}>
                <IconX />
              </IconButton>
              <Button variant="ghost" size="sm" onClick={endEarly}>
                End
              </Button>
            </div>
          )
        }
        progress={
          phase === 'run' && !stopwatch ? (
            <Progress
              value={total > 0 ? Math.min(elapsedSec, total) / total : 0}
              tone="effort"
              label="Session"
            />
          ) : undefined
        }
      />
      <div className="mt-3 flex flex-col gap-3">{body}</div>
    </Sheet>
  )
}
