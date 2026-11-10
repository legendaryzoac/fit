import { describe, expect, it } from 'vitest'
import type { Api } from '../../api'
import { builtinReply } from '../builtin'
import { prepare, stateBlock } from '../snapshot'
import { historyMessages, runTurn } from '../turn'
import type { AgentReply, AssistantBlock, ThreadEntry, WireMessage } from '../types'
import { makeCtx, recorder } from './fixtures'

const NO_TRIM = {
  keep_first_exercises: 0,
  drop_sets_per_exercise: 0,
  hold_load: false,
  swaps: [],
}

/** An API whose /api/agent plays back scripted model replies. */
function scripted(replies: Array<AssistantBlock[] | number>): Api & {
  bodies: Array<{ messages: WireMessage[] }>
} {
  const bodies: Array<{ messages: WireMessage[] }> = []
  let i = 0
  return {
    bodies,
    get: async () => new Response('{}', { status: 404 }),
    send: async (_method, _path, body) => {
      bodies.push(structuredClone(body) as { messages: WireMessage[] })
      const next = replies[i++]
      if (typeof next === 'number') return new Response('{}', { status: next })
      const stopReason = next.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn'
      return new Response(JSON.stringify({ content: next, stopReason }), { status: 200 })
    },
  }
}

const use = (name: string, input: Record<string, unknown>, id = `t-${name}`): AssistantBlock => ({
  type: 'tool_use',
  id,
  name,
  input,
})

const planInput = (items: unknown[]) => ({
  headline: 'Upper A',
  rationale: 'On the schedule.',
  items,
  custom_session: null,
})

describe('runTurn with the live coach', () => {
  it('ends in one call when the engine accepts the plan as written', async () => {
    const api = scripted([
      [
        { type: 'text', text: 'Upper A today, as written.' },
        use('set_day_plan', planInput([{ option_id: 'block:0', note: '', trim: NO_TRIM }])),
      ],
    ])
    const effects = recorder()
    const out = await runTurn({ api, history: [], text: 'Plan my day', ctx: makeCtx(), effects })
    expect(out.rounds).toBe(1)
    expect(out.source).toBe('live')
    expect(out.text).toBe('Upper A today, as written.')
    expect(out.cards.map((c) => c.type)).toEqual(['day-plan'])
    expect(effects.plans).toHaveLength(1)
    // The request ends with the state block and then the athlete's words
    const last = api.bodies[0].messages.at(-1)!
    expect(Array.isArray(last.content) && last.content.map((b) => b.type)).toEqual(['text', 'text'])
    expect(Array.isArray(last.content) && (last.content[0] as { text: string }).text).toMatch(/^<state>/)
  })

  it('hands a rejected plan back, with thinking blocks untouched, and shows the fix', async () => {
    const thinking: AssistantBlock = { type: 'thinking', thinking: '', signature: 'sig-abc' }
    const api = scripted([
      [thinking, use('set_day_plan', planInput([{ option_id: 'block:7', note: '', trim: NO_TRIM }]), 'a')],
      [
        { type: 'text', text: 'Upper A, as written.' },
        use('set_day_plan', planInput([{ option_id: 'block:0', note: '', trim: NO_TRIM }]), 'b'),
      ],
    ])
    const effects = recorder()
    const out = await runTurn({ api, history: [], text: 'Plan my day', ctx: makeCtx(), effects })
    expect(out.rounds).toBe(2)
    expect(effects.plans).toHaveLength(1)
    const second = api.bodies[1].messages
    expect(second.at(-2)).toEqual({ role: 'assistant', content: [thinking, expect.objectContaining({ id: 'a' })] })
    const result = (second.at(-1)!.content as Array<Record<string, unknown>>)[0]
    expect(result).toMatchObject({ type: 'tool_result', tool_use_id: 'a', is_error: true })
    expect(String(result.content)).toMatch(/Unknown option_id/)
  })

  it('answers a lookup from what the tool returned', async () => {
    const api = scripted([
      [use('get_exercise_history', { exercise: 'bench', sessions: 3 })],
      [{ type: 'text', text: 'Bench is moving: 175 to 185 for 8.' }],
    ])
    const out = await runTurn({ api, history: [], text: 'How is my bench?', ctx: makeCtx(), effects: recorder() })
    expect(out.rounds).toBe(2)
    const result = (api.bodies[1].messages.at(-1)!.content as Array<{ content: string }>)[0]
    const body = JSON.parse(result.content)
    expect(body.exercise).toBe('Bench press')
    expect(body.sessions[0].sets).toBe('185×8@8, 185×8@8, 185×8@8')
    expect(body.best_estimated_1rm.value).toBe(234)
  })

  it('does not run a tool call that was cut off at the token limit', async () => {
    const api: Api = {
      get: async () => new Response('{}', { status: 404 }),
      send: async () =>
        new Response(
          JSON.stringify({
            content: [use('set_day_plan', { headline: 'Upp' })],
            stopReason: 'max_tokens',
          }),
          { status: 200 },
        ),
    }
    const effects = recorder()
    const out = await runTurn({ api, history: [], text: 'Plan my day', ctx: makeCtx(), effects })
    expect(effects.plans).toHaveLength(0)
    expect(out.cards).toEqual([])
  })

  it('stops after a bounded number of calls when the model keeps failing', async () => {
    const bad = [use('set_day_plan', planInput([{ option_id: 'nope', note: '', trim: NO_TRIM }]))]
    const api = scripted([bad, bad, bad, bad, bad, bad, bad])
    const out = await runTurn({ api, history: [], text: 'Plan my day', ctx: makeCtx(), effects: recorder() })
    expect(out.rounds).toBe(5)
    expect(api.bodies).toHaveLength(5)
  })

  it('falls back to the built-in coach when the route is not deployed', async () => {
    const api = scripted([404])
    const effects = recorder()
    const out = await runTurn({ api, history: [], text: 'Plan my day', ctx: makeCtx(), effects })
    expect(out.source).toBe('builtin')
    expect(effects.plans[0].items.map((i) => i.kind)).toEqual(['warmup', 'block', 'cooldown', 'routine'])
  })

  it('surfaces the daily limit instead of quietly switching coaches', async () => {
    const api = scripted([429])
    await expect(
      runTurn({ api, history: [], text: 'Plan my day', ctx: makeCtx(), effects: recorder() }),
    ).rejects.toMatchObject({ reason: 'limit' })
  })
})

describe('history', () => {
  const entry = (role: 'user' | 'coach', text: string, extra: Partial<ThreadEntry> = {}): ThreadEntry => ({
    id: `${role}-${text}`,
    role,
    text,
    at: '2026-11-10T07:00:00.000Z',
    ...extra,
  })
  it('is plain alternating text that starts with the athlete', () => {
    const msgs = historyMessages([
      entry('coach', 'stray'),
      entry('user', 'Plan my day'),
      entry('coach', '', {
        cards: [{ type: 'choices', options: ['a', 'b'] }],
      }),
      entry('user', 'failed one', { error: 'offline' }),
    ])
    expect(msgs).toEqual([
      { role: 'user', content: 'Plan my day' },
      { role: 'assistant', content: 'Done.' },
    ])
  })
})

describe('the built-in coach', () => {
  const ask = (text: string, ctx = makeCtx(), before: WireMessage[] = []): AgentReply => {
    const { state } = prepare(ctx)
    return builtinReply([
      ...before,
      { role: 'user', content: [{ type: 'text', text: stateBlock(state) }, { type: 'text', text }] },
    ])
  }
  const callsOf = (r: AgentReply) =>
    r.content.filter((b): b is Extract<AssistantBlock, { type: 'tool_use' }> => b.type === 'tool_use')

  it('plans the scheduled session around a warm-up and cool-down', () => {
    const r = ask('Plan my day')
    const plan = callsOf(r).find((c) => c.name === 'set_day_plan')!.input as { items: Array<{ option_id: string }> }
    expect(plan.items.map((i) => i.option_id)).toEqual(['warmup', 'block:0', 'cooldown', 'routine:sleep'])
  })

  it('trims for time and backs off when the athlete is run down', () => {
    const r = ask('slept badly and my legs are fried, only have 20 min')
    const names = callsOf(r).map((c) => c.name)
    expect(names).toEqual(['log_checkin', 'set_day_plan'])
    const checkin = callsOf(r)[0].input
    expect(checkin).toMatchObject({ sleep: 2, soreness: 2 })
    const plan = callsOf(r)[1].input as { items: Array<{ option_id: string; trim: Record<string, unknown> }> }
    const main = plan.items.find((i) => i.option_id === 'block:0')!
    expect(main.trim).toMatchObject({ drop_sets_per_exercise: 1, hold_load: true })
    expect(main.trim.keep_first_exercises).toBeGreaterThan(0)
  })

  it('leaves out work around a painful joint and says to get it looked at', () => {
    const r = ask('my shoulder hurts today')
    const plan = callsOf(r).find((c) => c.name === 'set_day_plan')!.input as {
      rationale: string
      items: Array<{ option_id: string; trim: { swaps: Array<{ from: string; to: string }> } }>
    }
    const swaps = plan.items.find((i) => i.option_id === 'block:0')!.trim.swaps
    expect(swaps.map((s) => s.from)).toEqual(expect.arrayContaining(['Bench press', 'Overhead press']))
    expect(plan.rationale).toMatch(/get it looked at/)
  })

  it('interviews, then proposes a block the engine accepts', async () => {
    const api: Api = {
      get: async () => new Response('{}', { status: 404 }),
      send: async () => new Response('{}', { status: 503 }),
    }
    const ctx = makeCtx({ mesos: [] })
    const history: ThreadEntry[] = []
    const turn = async (text: string) => {
      const out = await runTurn({ api, history, text, ctx, effects: recorder() })
      history.push(
        { id: `u${history.length}`, role: 'user', text, at: '' },
        { id: `c${history.length}`, role: 'coach', text: out.text, cards: out.cards, at: '' },
      )
      return out
    }
    const q1 = await turn('Build me a block')
    expect(q1.text).toMatch(/How many days/)
    expect(q1.cards[0]).toMatchObject({ type: 'choices' })
    const q2 = await turn('4 days')
    expect(q2.text).toMatch(/prioritise/)
    const q3 = await turn('Chest')
    expect(q3.text).toMatch(/How long/)
    const done = await turn('5 weeks')
    const card = done.cards.find((c) => c.type === 'block')
    expect(card?.type === 'block' && card.proposal).toMatchObject({ weeks: 5, focus: ['chest'] })
    expect(card?.type === 'block' && card.proposal.days).toHaveLength(4)
    expect(done.rounds).toBe(1)
  })

  it('looks a lift up and reports from the result', async () => {
    const api: Api = {
      get: async () => new Response('{}', { status: 404 }),
      send: async () => new Response('{}', { status: 404 }),
    }
    const out = await runTurn({ api, history: [], text: "How's my bench press going?", ctx: makeCtx(), effects: recorder() })
    expect(out.rounds).toBe(2)
    expect(out.text).toMatch(/Bench press: last session .+ was 185×8@8/)
    expect(out.text).toMatch(/Best estimated max 234 lb/)
  })

  it('calls a rest day a rest day when nothing is scheduled', () => {
    const wednesday = makeCtx({ now: makeCtx().now + 86_400_000 })
    const r = ask('Plan my day', wednesday)
    const plan = callsOf(r).find((c) => c.name === 'set_day_plan')!.input as { headline: string }
    expect(plan.headline).toBe('Rest day')
    expect(callsOf(r).some((c) => c.name === 'offer_choices')).toBe(true)
  })

  it('keeps "a plan for today" and a lift with "split" in its name out of the block interview', () => {
    const day = ask('Make me a plan for today')
    expect(callsOf(day).some((c) => c.name === 'set_day_plan')).toBe(true)
    const swap = ask('Can we skip the Bulgarian split squat today, my knee hurts')
    expect(callsOf(swap).some((c) => c.name === 'propose_block')).toBe(false)
    expect(swap.content.some((b) => b.type === 'text' && /How many days/.test(b.text))).toBe(false)
  })

  it('remembers a stated fact', () => {
    const r = ask("I don't have a barbell at home")
    const note = callsOf(r).find((c) => c.name === 'remember')!.input
    expect(note).toMatchObject({ category: 'equipment', note: 'No barbell at home.' })
  })
})
