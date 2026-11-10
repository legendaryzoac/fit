// One turn of the conversation: the athlete says something, the coach
// answers, and in between the model may call tools that run here.
//
// Two rules keep this cheap and sturdy with a small model:
//
// - Between turns the conversation is plain text. Each request is rebuilt
//   from what was said plus a fresh <state> snapshot, so the model always
//   reads current truth instead of its own old tool calls, and nothing
//   stored on the device depends on the model, prompt or tool versions.
//   Raw blocks (thinking included) are replayed only inside a turn's own
//   tool loop, unmodified, as the API requires.
//
// - A turn ends as soon as nothing needs the model again. A plan the
//   engine accepted as written is shown and the turn is over; only a
//   lookup, or a proposal the engine changed or rejected, costs a second
//   call.

import type { Api } from '../api'
import { callCoach } from './client'
import { prepare, stateBlock } from './snapshot'
import { runTool } from './tools'
import type {
  AgentContext,
  AgentEffects,
  AssistantBlock,
  CoachCard,
  CoachSource,
  ThreadEntry,
  ToolResultBlock,
  ToolUseBlock,
  WireMessage,
} from './types'

/** Model calls one turn may spend. */
const MAX_ROUNDS = 5
/** Earlier entries sent along as context. */
const HISTORY_ENTRIES = 14

export interface TurnResult {
  text: string
  cards: CoachCard[]
  source: CoachSource
  rounds: number
  /** The model declined; the exchange should not be replayed as history. */
  refused?: boolean
}

/** What a past coach entry said, for entries that were only a card. */
function coachLine(e: ThreadEntry): string {
  if (e.text.trim()) return e.text.trim()
  const card = e.cards?.[0]
  if (card?.type === 'day-plan') return `Set today's plan: ${card.plan.headline}.`
  if (card?.type === 'block') return `Proposed a block: ${card.proposal.name}.`
  if (card?.type === 'note') return 'Noted.'
  if (card?.type === 'checkin') return 'Logged the check-in.'
  return 'Done.'
}

/** Earlier entries as plain alternating turns, starting with the athlete. */
export function historyMessages(history: ThreadEntry[]): WireMessage[] {
  const usable = history
    // A declined exchange goes entirely: the reply and what prompted it
    .filter((e, i) => !e.refused && !history[i + 1]?.refused)
    .filter((e) => !e.error)
    .slice(-HISTORY_ENTRIES)
  while (usable.length > 0 && usable[0].role !== 'user') usable.shift()
  return usable.map((e) =>
    e.role === 'user'
      ? { role: 'user', content: e.text.trim() || '(no text)' }
      : { role: 'assistant', content: coachLine(e) },
  )
}

const isToolUse = (b: AssistantBlock): b is ToolUseBlock => b.type === 'tool_use'

const textOf = (blocks: AssistantBlock[]): string =>
  blocks
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text.trim())
    .filter(Boolean)
    .join('\n\n')

/** Cards that are an answer in themselves. */
const answers = (c: CoachCard) =>
  c.type === 'day-plan' || c.type === 'block' || c.type === 'choices'

export async function runTurn(args: {
  api: Api
  history: ThreadEntry[]
  text: string
  ctx: AgentContext
  effects: AgentEffects
}): Promise<TurnResult> {
  // Tools read this copy; the effects keep it in step with what they save
  const ctx: AgentContext = { ...args.ctx, notes: [...args.ctx.notes] }
  const effects: AgentEffects = {
    saveCheckin: (patch) => args.effects.saveCheckin(patch),
    setDayPlan: (plan) => {
      ctx.dayPlan = plan
      args.effects.setDayPlan(plan)
    },
    addNote: (note) => {
      ctx.notes.push(note)
      args.effects.addNote(note)
    },
  }
  const prep = prepare(ctx)

  const messages: WireMessage[] = [
    ...historyMessages(args.history),
    {
      role: 'user',
      content: [
        { type: 'text', text: stateBlock(prep.state) },
        { type: 'text', text: args.text },
      ],
    },
  ]

  const said: string[] = []
  const cards: CoachCard[] = []
  let source: CoachSource = 'live'
  let rounds = 0
  let refused = false

  while (rounds < MAX_ROUNDS) {
    let reply
    try {
      reply = await callCoach(args.api, messages)
    } catch (err) {
      // Nothing has happened yet: let the caller show the failure and
      // offer a retry. After the first round the tools have already run
      // (a plan saved, a note kept), so the turn keeps what it has.
      if (rounds === 0) throw err
      said.push('I was cut off before I could finish. What is shown here is saved.')
      break
    }
    rounds++
    source = reply.source

    if (reply.stopReason === 'refusal') {
      said.push('That is outside what I can help with here.')
      refused = rounds === 1
      break
    }
    const spoken = textOf(reply.content)
    if (spoken) said.push(spoken)

    const calls = reply.content.filter(isToolUse)
    // A reply cut off at the token limit may carry half a tool call
    if (calls.length === 0 || reply.stopReason === 'max_tokens') break

    const plansToday = calls.some((c) => c.name === 'set_day_plan')
    const results: ToolResultBlock[] = []
    let again = false
    for (const call of calls) {
      const out = runTool(call.name, call.input, ctx, prep, effects, source)
      if (out.card) {
        // A corrected proposal replaces the one it corrects
        if (out.card.type === 'day-plan' || out.card.type === 'block') {
          const at = cards.findIndex((c) => c.type === out.card!.type)
          if (at !== -1) cards.splice(at, 1)
        }
        cards.push(out.card)
      }
      // A check-in logged alongside a plan needs no second look
      const needs =
        call.name === 'log_checkin' ? out.isError || !plansToday : out.followUp
      if (needs) again = true
      results.push({
        type: 'tool_result',
        tool_use_id: call.id,
        content: out.result,
        ...(out.isError && { is_error: true }),
      })
    }
    // Said nothing and showed nothing that answers: let it finish the thought
    if (!again && said.length === 0 && !cards.some(answers)) again = true
    if (!again) break

    messages.push(
      // Sent back as it came (thinking blocks included), minus any empty
      // text block: the API rejects those on the way in.
      {
        role: 'assistant',
        content: reply.content.filter(
          (b) => b.type !== 'text' || (b as { text: string }).text.trim() !== '',
        ),
      },
      { role: 'user', content: results },
    )
  }

  let text = said.join('\n\n')
  if (!text) {
    const card = cards.find(answers)
    text =
      card?.type === 'day-plan'
        ? "Today's plan is set."
        : card?.type === 'block'
          ? 'Here is the block.'
          : card
            ? ''
            : 'I did not get that. Say it another way?'
  }
  return { text, cards, source, rounds, ...(refused && { refused }) }
}
