import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  cue,
  getSpeakPref,
  setSpeakPref,
  speak,
  speakSupported,
  warnCue,
} from '../lib/cue'
import { SPEED_DRILLS } from '../lib/exercises'
import { lockScreenSupported, registerTimerControls } from '../lib/lockScreen'
import { recoveryExercisesFromSections } from '../lib/routines'
import { stretchByName } from '../lib/stretches'
import { getUnitPref } from '../lib/units'
import {
  fmtSec,
  holdBaseName,
  holdSide,
  isTransition,
  sectionTone,
  SWITCH_LABEL,
  totalSec,
  type SectionTone,
} from '../lib/templates'
import { acquireWakeLock, releaseWakeLock } from '../lib/wakeLock'
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
import { ScaleRow } from './cadence/ScaleRow'
import { AddSetButton, SetHeader, SetRow } from './cadence/SetRow'
import { StatusPill } from './cadence/StatusPill'
import { Switch } from './cadence/Switch'
import { LockScreenSwitch } from './LockScreenSwitch'
import { Segment } from './shell/Segment'
import { IconChevronDown, IconRun, IconX } from './shell/icons'
import { confirm } from '../lib/confirm'
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

/** What to say when a recovery section begins. */
function phraseFor(label: string): string {
  if (label === SWITCH_LABEL) return 'Switch sides'
  const base = holdBaseName(label)
  const side = holdSide(label)
  const sideText =
    side === 'L' ? ', left side' : side === 'R' ? ', right side' : ''
  return isTransition(label) ? `Next, ${base}${sideText}` : `${base}${sideText}`
}

const FEEL_OPTIONS = [
  { value: '1', label: '1' },
  { value: '2', label: '2' },
  { value: '3', label: '3' },
  { value: '4', label: '4' },
  { value: '5', label: '5' },
]

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
  const [rpe, setRpe] = useState<number | undefined>()
  const [feel, setFeel] = useState<number | undefined>()
  const [speakOn, setSpeakOn] = useState(getSpeakPref)
  const lastIdxRef = useRef(0)
  const lastWarnRef = useRef(-1)
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
  const recovery = draft.kind === 'recovery'
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
      lastWarnRef.current = -1
      cue(2)
      if (recovery && sections[idx]) {
        speak(phraseFor(sections[idx].label))
      }
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

  // The opening section is never an index CHANGE, so announce it once.
  useEffect(() => {
    if (recovery && !stopwatch && sections[0]) {
      speak(phraseFor(sections[0].label))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep the screen on while the countdown is on it; a minimized or
  // finished session gives the lock back.
  useEffect(() => {
    if (phase !== 'run') return
    acquireWakeLock()
    return () => releaseWakeLock()
  }, [phase])

  // Guided holds: a soft tick at three seconds left so the next position
  // can be set up before the change beep. Once per section.
  const secLeft = Math.ceil(remaining)
  useEffect(() => {
    if (!recovery || stopwatch || phase !== 'run' || finished || draft.paused) {
      return
    }
    if (isTransition(current.label) || current.durationSec < 15) return
    if (secLeft <= 3 && secLeft > 0 && lastWarnRef.current !== idx) {
      lastWarnRef.current = idx
      warnCue()
    }
  }, [
    recovery,
    stopwatch,
    phase,
    finished,
    draft.paused,
    current.label,
    current.durationSec,
    secLeft,
    idx,
  ])

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
    // A session ended early only logs the holds it reached. (A skipped
    // hold still counts — skipping advances the clock — which is the
    // honest limit of what the draft records today.)
    const reached: typeof sections = []
    let acc = 0
    for (const s of sections) {
      if (acc * 1000 >= durMs) break
      reached.push(s)
      acc += s.durationSec
    }
    onSave({
      id: crypto.randomUUID(),
      // Approximate: paused time is excluded from the duration on purpose
      start: new Date(doneAt - durMs).toISOString(),
      end: new Date(doneAt).toISOString(),
      kind: draft.kind,
      title: title || undefined,
      weightUnit: getUnitPref(),
      // Recovery: per-stretch holds recovered from the executed sections so
      // history has structure; other kinds keep their hand-logged drills.
      exercises: recovery ? recoveryExercisesFromSections(reached) : drills,
      ...(recovery && { modality: draft.modality ?? ('stretch' as const) }),
      ...(recovery && feel !== undefined && { rating: { post: feel } }),
      ...(rpe !== undefined && { sessionRpe: rpe }),
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
  async function close() {
    if (phase === 'run') {
      dismiss(onMinimize)
    } else if (
      await confirm({ title: 'Discard this session?', action: 'Discard' })
    ) {
      dismiss(onCancel)
    }
  }

  const heading =
    draft.title ||
    (recovery
      ? stopwatch
        ? 'Free stretch'
        : 'Routine'
      : stopwatch
        ? 'Run'
        : 'Intervals')

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
        <ScaleRow
          label="Effort"
          low="Rest"
          high="Max"
          value={rpe}
          onChange={setRpe}
        />
        {draft.kind === 'recovery' && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between">
              <span className="text-caption font-semibold text-ink-2">
                Feel
              </span>
              <span className="text-caption text-ink-3">Stiff to loose</span>
            </div>
            <Segment
              options={FEEL_OPTIONS}
              value={feel === undefined ? undefined : String(feel)}
              onChange={(v) => setFeel(Number(v))}
              block
              ariaLabel="Feel"
            />
          </div>
        )}
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
    const transition = recovery && isTransition(current.label)
    const tone: CountdownTone = recovery
      ? transition
        ? 'neutral'
        : 'calm'
      : TONE[sectionTone(current.label)]
    // The note below carries "(L)/(R)", so the pill never repeats it.
    const pillText = !recovery
      ? current.label
      : current.label === SWITCH_LABEL
        ? current.label
        : transition
          ? `Next: ${holdBaseName(current.label)}`
          : holdBaseName(current.label)
    // Which stretch to explain: the hold itself, the one a lead-in
    // announces, or (on a side swap) the one coming next.
    const explainLabel = !recovery
      ? ''
      : current.label === SWITCH_LABEL
        ? next?.label ?? ''
        : current.label
    const stretch = recovery
      ? stretchByName(holdBaseName(explainLabel))
      : undefined
    const side = recovery ? holdSide(explainLabel) : undefined
    const sideLabel =
      side === 'L' ? 'Left side' : side === 'R' ? 'Right side' : null
    const note =
      recovery && (sideLabel || stretch) ? (
        <>
          {sideLabel && (
            <p className="text-caption font-semibold text-ink-2">
              {sideLabel}
            </p>
          )}
          {stretch?.cues.map((c, i) => (
            <p key={i} className="text-body text-ink-2">
              {c}
            </p>
          ))}
        </>
      ) : undefined
    const nextText = !next
      ? 'Final section'
      : !recovery
        ? `Next · ${next.label} ${fmtSec(next.durationSec)} · ${idx + 1} of ${sections.length}`
        : next.label === SWITCH_LABEL
          ? 'Then · switch sides'
          : isTransition(next.label)
            ? `Then · ${holdBaseName(next.label)}`
            : `Next · ${holdBaseName(next.label)} ${fmtSec(next.durationSec)}`
    // The Now pill sits on the hold a lead-in or side-swap is announcing,
    // not on the transition beat itself.
    const announcedIdx = transition ? idx + 1 : idx

    body = (
      <>
        <Countdown
          label={pillText}
          tone={tone}
          time={
            stopwatch ? fmtSec(elapsedSec) : fmtSec(Math.ceil(remaining))
          }
          note={note}
          next={nextText}
          remaining={remaining / current.durationSec}
          paused={draft.paused}
          onPause={pause}
          onResume={resume}
          onSkip={stopwatch ? undefined : skip}
          stopwatch={stopwatch}
        />
        {(lockScreenSupported() || (recovery && speakSupported())) && (
          <Card>
            <div className="flex flex-col gap-3">
              <LockScreenSwitch />
              {recovery && speakSupported() && (
                <Switch
                  checked={speakOn}
                  onChange={(on) => {
                    setSpeakPref(on)
                    setSpeakOn(on)
                    if (on) speak('Spoken cues on')
                  }}
                  label="Spoken cues"
                />
              )}
            </div>
          </Card>
        )}
        {!stopwatch && (
          <List>
            {sections
              .map((s, i) => ({ s, i }))
              .filter(({ s }) => !recovery || !isTransition(s.label))
              .map(({ s, i }) => {
                const tag = recovery ? holdSide(s.label) : undefined
                return (
                  <ListItem
                    key={i}
                    title={recovery ? holdBaseName(s.label) : s.label}
                    sub={
                      recovery
                        ? `${s.durationSec} s${
                            tag === 'L' ? ' · left' : tag === 'R' ? ' · right' : ''
                          }`
                        : fmtSec(s.durationSec)
                    }
                    muted={i < idx}
                    trail={
                      i === announcedIdx ? (
                        <StatusPill tone={recovery ? 'mid' : 'effort'}>
                          Now
                        </StatusPill>
                      ) : undefined
                    }
                  />
                )
              })}
          </List>
        )}
      </>
    )
  }

  return (
    <Sheet
      open={open}
      onClose={close}
      onExited={onExited}
      ariaLabel="Timer"
      header={
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
      }
    >
      <div className="mt-3 flex flex-col gap-3">{body}</div>
    </Sheet>
  )
}
