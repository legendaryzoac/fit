// The conversation as the UI sees it: the stored thread, whether a turn is
// running, and the few things a tap can do (send, retry, start over, add a
// line of the app's own). The turn itself keeps running if the sheet is
// closed, because this lives with the data, not with the sheet.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Api } from '../api'
import { CoachError, coachStatus } from './client'
import { clearThread, getThread, setThread, useThread } from './store'
import { runTurn } from './turn'
import type { AgentContext, AgentEffects, ThreadEntry } from './types'

const FAILURES: Record<string, string> = {
  limit: 'That is the coach’s limit for today. It resets at midnight UTC.',
  rejected: 'That message did not go through. Try wording it differently.',
  auth: 'Your session expired. Sign in again to keep going.',
  failed: 'The coach did not answer. Check your connection and try again.',
}

const entry = (
  role: ThreadEntry['role'],
  text: string,
  extra: Partial<ThreadEntry> = {},
): ThreadEntry => ({
  id: crypto.randomUUID(),
  role,
  text,
  at: new Date().toISOString(),
  ...extra,
})

export interface Coach {
  thread: ThreadEntry[]
  busy: boolean
  /** null until the first status check lands. */
  live: boolean | null
  send: (text: string) => void
  /** Send the last message again after a failure. */
  retry: () => void
  reset: () => void
  /** A line from the app itself, e.g. after a block is saved. No model call. */
  say: (text: string) => void
  markBlockSaved: (cardId: string, mesoId: string) => void
}

export function useCoach(
  api: Api,
  /** Called when a turn starts, so the snapshot is as fresh as the tap. */
  getContext: () => AgentContext,
  effects: AgentEffects,
): Coach {
  const thread = useThread()
  const [busy, setBusy] = useState(false)
  const [live, setLive] = useState<boolean | null>(null)
  const busyRef = useRef(false)
  // Inline closures from the caller change every render; a turn must use
  // the ones current when it runs.
  const getContextRef = useRef(getContext)
  getContextRef.current = getContext
  const effectsRef = useRef(effects)
  effectsRef.current = effects

  useEffect(() => {
    let alive = true
    void coachStatus(api).then((s) => {
      if (alive) setLive(s.live)
    })
    return () => {
      alive = false
    }
  }, [api])

  const send = useCallback(
    (text: string) => {
      const said = text.trim().slice(0, 2000)
      if (!said || busyRef.current) return
      busyRef.current = true
      setBusy(true)
      const history = getThread()
      setThread([...history, entry('user', said)])
      void runTurn({
        api,
        history,
        text: said,
        ctx: getContextRef.current(),
        effects: {
          saveCheckin: (p) => effectsRef.current.saveCheckin(p),
          setDayPlan: (p) => effectsRef.current.setDayPlan(p),
          addNote: (n) => effectsRef.current.addNote(n),
        },
      })
        .then((out) => {
          setLive(out.source === 'live')
          setThread([
            ...getThread(),
            entry('coach', out.text, {
              source: out.source,
              ...(out.cards.length > 0 && { cards: out.cards }),
            }),
          ])
        })
        .catch((err: unknown) => {
          const reason = err instanceof CoachError ? err.reason : 'failed'
          setThread([
            ...getThread(),
            entry('coach', '', { error: FAILURES[reason] ?? FAILURES.failed }),
          ])
        })
        .finally(() => {
          busyRef.current = false
          setBusy(false)
        })
    },
    [api],
  )

  const retry = useCallback(() => {
    if (busyRef.current) return
    const all = getThread()
    const failed = all.at(-1)
    const asked = all.at(-2)
    if (!failed?.error || asked?.role !== 'user') return
    setThread(all.slice(0, -2))
    send(asked.text)
  }, [send])

  const reset = useCallback(() => {
    if (!busyRef.current) clearThread()
  }, [])

  const say = useCallback((text: string) => {
    setThread([...getThread(), entry('coach', text)])
  }, [])

  const markBlockSaved = useCallback((cardId: string, mesoId: string) => {
    setThread(
      getThread().map((e) =>
        e.cards?.some((c) => c.type === 'block' && c.id === cardId)
          ? {
              ...e,
              cards: e.cards.map((c) =>
                c.type === 'block' && c.id === cardId
                  ? { ...c, savedMesoId: mesoId }
                  : c,
              ),
            }
          : e,
      ),
    )
  }, [])

  return { thread, busy, live, send, retry, reset, say, markBlockSaved }
}
