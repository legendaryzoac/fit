// One model call. The live coach answers through /api/agent; when that
// route is not there (stack not deployed yet, no API key, no signal) the
// coach built into the app answers in the same block format, so the rest
// of the loop cannot tell the difference. The demo's API serves the
// built-in coach from the same path.

import type { Api } from '../api'
import { builtinReply } from './builtin'
import type { AgentReply, AssistantBlock, WireMessage } from './types'

export type CoachFailure = 'limit' | 'rejected' | 'auth'

export class CoachError extends Error {
  readonly reason: CoachFailure
  constructor(reason: CoachFailure) {
    super(reason)
    this.name = 'CoachError'
    this.reason = reason
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

function parseReply(body: unknown): AgentReply | null {
  if (typeof body !== 'object' || body === null) return null
  const b = body as {
    content?: unknown
    stopReason?: unknown
    source?: unknown
  }
  if (!Array.isArray(b.content)) return null
  const content = b.content.filter(
    (x): x is AssistantBlock =>
      typeof x === 'object' &&
      x !== null &&
      typeof (x as { type?: unknown }).type === 'string',
  )
  return {
    content,
    stopReason: typeof b.stopReason === 'string' ? b.stopReason : null,
    source: b.source === 'builtin' ? 'builtin' : 'live',
  }
}

export async function callCoach(
  api: Api,
  messages: WireMessage[],
): Promise<AgentReply> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response
    try {
      res = await api.send('POST', '/api/agent', { messages })
    } catch {
      // Offline: the built-in coach works from what is on the device
      return builtinReply(messages)
    }
    if (res.ok) {
      const reply = parseReply(await res.json().catch(() => null))
      if (reply) return reply
      return builtinReply(messages)
    }
    if (res.status === 429) throw new CoachError('limit')
    if (res.status === 409 || res.status === 400) throw new CoachError('rejected')
    if (res.status === 401) throw new CoachError('auth')
    // A 502 is worth one more try. A 504 already used the server's whole
    // time budget, and anything else means the live coach is not available
    // here (404 before deploy, 503 before a key or when it is busy): the
    // built-in coach answers instead.
    if (res.status !== 502) break
    if (attempt === 0) await wait(700)
  }
  return builtinReply(messages)
}

/** Is the live coach configured for this account? Never throws. */
export async function coachStatus(
  api: Api,
): Promise<{ live: boolean; remaining?: number }> {
  try {
    const res = await api.get('/api/agent')
    if (!res.ok) return { live: false }
    const body = (await res.json()) as { available?: boolean; remaining?: number }
    return {
      live: body.available === true,
      ...(typeof body.remaining === 'number' && { remaining: body.remaining }),
    }
  } catch {
    return { live: false }
  }
}
