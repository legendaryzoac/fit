import { useId, useState } from 'react'
import { localInputValue } from '../lib/datetime'
import type { Mesocycle } from '../lib/mesocycle'
import {
  blockDaysAt,
  defaultPastStart,
  pastStartProblem,
  type PastChoice,
} from '../lib/past'
import type { Template } from '../lib/templates'
import { Field, TextInput } from './cadence/Field'
import { List, ListItem } from './cadence/ListItem'
import { IconPlus, IconRecover, IconRun, IconStrength } from './shell/icons'
import { Sheet } from './shell/Sheet'
import { useSheetDismiss } from './shell/useSheetDismiss'
import { KIND_LEAD, templateMeta } from './TemplateBuilder'

/**
 * Logging something that already happened: when it was, then what it was.
 * The block's days are offered only for a moment inside the block, and as
 * that week planned them, so a session entered late still counts for the
 * week it belonged to.
 */
export function PastSession({
  meso,
  templates,
  onPick,
  onCancel,
}: {
  meso?: Mesocycle
  templates: Template[]
  /** Runs once the sheet has dropped. */
  onPick: (choice: PastChoice, startIso: string) => void
  onCancel: () => void
}) {
  const { open, dismiss, onExited } = useSheetDismiss()
  const whenId = useId()
  const [when, setWhen] = useState(() => localInputValue(defaultPastStart(Date.now())))
  const startMs = new Date(when).getTime()
  const problem = pastStartProblem(startMs, Date.now())
  const days = problem ? [] : blockDaysAt(meso, startMs)
  const trainable = templates.filter((t) => t.kind !== 'recovery' && !t.builtin)

  const pick = (choice: PastChoice) => {
    if (problem) return
    dismiss(() => onPick(choice, new Date(startMs).toISOString()))
  }

  return (
    <Sheet
      open={open}
      onClose={() => dismiss(onCancel)}
      onExited={onExited}
      title="Log a past session"
    >
      <div className="flex flex-col gap-4">
        <Field label="When" htmlFor={whenId} error={problem ?? undefined}>
          <TextInput
            id={whenId}
            type="datetime-local"
            value={when}
            max={localInputValue(new Date())}
            onChange={(e) => setWhen(e.target.value)}
          />
        </Field>

        {days.length > 0 && meso && (
          <div className="flex flex-col gap-1.5">
            <p className="text-caption font-semibold text-ink-2">
              {meso.name} · week {days[0].week + 1}
            </p>
            <List className="bg-surface-2">
              {days.map((d) => (
                <ListItem
                  key={d.dayIndex}
                  lead={d.cardio ? <IconRun /> : <IconStrength />}
                  leadTone={d.cardio ? 'rest' : 'brand'}
                  title={d.label}
                  sub="Counts for that week of the block"
                  chevron
                  onClick={() => pick({ kind: 'block', dayIndex: d.dayIndex })}
                />
              ))}
            </List>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <p className="text-caption font-semibold text-ink-2">
            {days.length > 0 ? 'Something else' : 'What was it'}
          </p>
          <List className="bg-surface-2">
            {trainable.map((t) => (
              <ListItem
                key={t.id}
                lead={KIND_LEAD[t.kind].icon}
                leadTone={KIND_LEAD[t.kind].tone}
                title={t.name}
                sub={templateMeta(t)}
                chevron
                onClick={() => pick({ kind: 'template', templateId: t.id })}
              />
            ))}
            <ListItem
              key="open"
              lead={<IconPlus />}
              title="Strength"
              sub="Add the lifts and sets you did"
              chevron
              onClick={() => pick({ kind: 'open' })}
            />
            <ListItem
              key="cardio"
              lead={<IconRun />}
              leadTone="rest"
              title="Cardio"
              sub="Time, distance and effort"
              chevron
              onClick={() => pick({ kind: 'cardio' })}
            />
            <ListItem
              key="recovery"
              lead={<IconRecover />}
              leadTone="calm"
              title="Recovery"
              sub="Stretching, sauna, cold, a walk"
              chevron
              onClick={() => pick({ kind: 'recovery' })}
            />
          </List>
        </div>
      </div>
    </Sheet>
  )
}
