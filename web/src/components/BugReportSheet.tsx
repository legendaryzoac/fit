import { useEffect, useId, useState } from 'react'
import type { Api } from '../lib/api'
import {
  APP_VERSION,
  BUG_AREAS,
  BUG_KINDS,
  submitBugReport,
  type BugArea,
  type BugKind,
} from '../lib/bugReport'
import { Banner } from './cadence/Banner'
import { Button } from './cadence/Button'
import { Field, SELECT_WELL, TextArea, TextInput } from './cadence/Field'
import { Switch } from './cadence/Switch'
import { Sheet } from './shell/Sheet'

type Status =
  | { state: 'idle' }
  | { state: 'sending' }
  | { state: 'filed'; number: number; url: string }
  | { state: 'fallback'; url: string; note?: string }
  | { state: 'error'; message: string }

/**
 * Report a bug from inside the app. Version, device and settings are
 * captured automatically; the person fills in what happened. It files a
 * GitHub issue through the API, or (demo, or no token on the server) hands
 * over a prefilled GitHub link instead.
 */
export function BugReportSheet({
  open,
  onClose,
  api,
  demo,
  email,
}: {
  open: boolean
  onClose: () => void
  api: Api
  demo: boolean
  email: string
}) {
  const ids = {
    title: useId(),
    kind: useId(),
    kindOther: useId(),
    area: useId(),
    areaOther: useId(),
    what: useId(),
    steps: useId(),
    expected: useId(),
    extra: useId(),
  }
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<BugKind>('crash')
  const [kindOther, setKindOther] = useState('')
  const [area, setArea] = useState<BugArea>('today')
  const [areaOther, setAreaOther] = useState('')
  const [what, setWhat] = useState('')
  const [steps, setSteps] = useState('')
  const [expected, setExpected] = useState('')
  const [extra, setExtra] = useState('')
  const [shareEmail, setShareEmail] = useState(true)
  const [tried, setTried] = useState(false)
  const [status, setStatus] = useState<Status>({ state: 'idle' })

  // A filed report clears for next time; an unsent draft survives a close
  useEffect(() => {
    if (open && status.state === 'filed') {
      setTitle('')
      setKindOther('')
      setAreaOther('')
      setWhat('')
      setSteps('')
      setExpected('')
      setExtra('')
      setTried(false)
      setStatus({ state: 'idle' })
    }
    // Only on reopen
  }, [open])

  // An edit after a failed send makes the prefilled link stale: back to Send
  useEffect(() => {
    setStatus((s) =>
      s.state === 'fallback' || s.state === 'error' ? { state: 'idle' } : s,
    )
  }, [
    title,
    kind,
    kindOther,
    area,
    areaOther,
    what,
    steps,
    expected,
    extra,
    shareEmail,
  ])

  const missingTitle = !title.trim()
  const missingWhat = !what.trim()
  const sending = status.state === 'sending'

  async function submit() {
    setTried(true)
    if (missingTitle || missingWhat) return
    setStatus({ state: 'sending' })
    const res = await submitBugReport(
      api,
      {
        title,
        kind,
        kindOther: kind === 'other' ? kindOther : undefined,
        area,
        areaOther: area === 'other' ? areaOther : undefined,
        what,
        steps,
        expected,
        extra,
        email: shareEmail && !demo ? email : undefined,
      },
      demo,
    )
    if (res.ok) setStatus({ state: 'filed', number: res.number, url: res.url })
    else if (res.fallback)
      setStatus({ state: 'fallback', url: res.fallback, note: res.error })
    else
      setStatus({
        state: 'error',
        message: res.error ?? 'Something went wrong',
      })
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={status.state === 'filed' ? "Thanks — it's logged" : 'Report a bug'}
      footer={
        status.state === 'filed' ? (
          <Button block onClick={onClose}>
            Done
          </Button>
        ) : status.state === 'fallback' ? (
          <div className="flex flex-col gap-3">
            <Banner tone="info">
              {status.note ? `${status.note} ` : ''}
              {demo
                ? 'In the demo, reports go through GitHub directly — it opens with everything filled in.'
                : "It couldn't be sent from here, so it opens on GitHub with everything filled in."}
            </Banner>
            <a
              href={status.url}
              target="_blank"
              rel="noreferrer"
              className="pressable flex min-h-11 w-full items-center justify-center rounded-pill bg-brand px-5 text-body font-semibold text-on-brand"
            >
              Open on GitHub
            </a>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {status.state === 'error' && (
              <Banner tone="error">{status.message}</Banner>
            )}
            <Button block disabled={sending} onClick={() => void submit()}>
              {sending ? 'Sending…' : 'Send report'}
            </Button>
          </div>
        )
      }
    >
      {status.state === 'filed' ? (
        <div className="flex flex-col gap-4">
          <p className="text-body text-ink-2">
            Filed as issue #{status.number}. We'll take a look.
          </p>
          <a
            href={status.url}
            target="_blank"
            rel="noreferrer"
            className="text-body font-semibold text-brand-strong underline"
          >
            View it on GitHub
          </a>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-caption text-ink-3">
            Version {APP_VERSION}. Your device, browser and settings are
            attached automatically.
          </p>

          <Field
            label="Summary"
            htmlFor={ids.title}
            error={
              tried && missingTitle ? 'Give it a one-line summary' : undefined
            }
          >
            <TextInput
              id={ids.title}
              value={title}
              maxLength={120}
              placeholder="e.g. Timer skipped the last rest"
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>

          <Field label="What kind of problem?" htmlFor={ids.kind}>
            <select
              id={ids.kind}
              className={SELECT_WELL}
              value={kind}
              onChange={(e) => setKind(e.target.value as BugKind)}
            >
              {BUG_KINDS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          {kind === 'other' && (
            <Field label="Describe the kind of problem" htmlFor={ids.kindOther}>
              <TextInput
                id={ids.kindOther}
                value={kindOther}
                maxLength={120}
                onChange={(e) => setKindOther(e.target.value)}
              />
            </Field>
          )}

          <Field label="Where in the app?" htmlFor={ids.area}>
            <select
              id={ids.area}
              className={SELECT_WELL}
              value={area}
              onChange={(e) => setArea(e.target.value as BugArea)}
            >
              {BUG_AREAS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          {area === 'other' && (
            <Field label="Where was it?" htmlFor={ids.areaOther}>
              <TextInput
                id={ids.areaOther}
                value={areaOther}
                maxLength={120}
                onChange={(e) => setAreaOther(e.target.value)}
              />
            </Field>
          )}

          <Field
            label="What happened?"
            htmlFor={ids.what}
            error={tried && missingWhat ? 'Say what went wrong' : undefined}
          >
            <TextArea
              id={ids.what}
              value={what}
              maxLength={4000}
              onChange={(e) => setWhat(e.target.value)}
            />
          </Field>

          <Field
            label="Steps to reproduce"
            htmlFor={ids.steps}
            help="What you tapped, in order, if you can remember"
          >
            <TextArea
              id={ids.steps}
              value={steps}
              maxLength={4000}
              placeholder={'1. Opened Log\n2. Started a session\n3. …'}
              onChange={(e) => setSteps(e.target.value)}
            />
          </Field>

          <Field label="What did you expect?" htmlFor={ids.expected}>
            <TextArea
              id={ids.expected}
              value={expected}
              maxLength={2000}
              onChange={(e) => setExpected(e.target.value)}
            />
          </Field>

          <Field label="Anything else" htmlFor={ids.extra}>
            <TextArea
              id={ids.extra}
              value={extra}
              maxLength={4000}
              onChange={(e) => setExtra(e.target.value)}
            />
          </Field>

          {!demo && (
            <Switch
              checked={shareEmail}
              onChange={setShareEmail}
              label="Include my email"
              help={`${email} — reports are public on GitHub`}
            />
          )}
        </div>
      )}
    </Sheet>
  )
}
