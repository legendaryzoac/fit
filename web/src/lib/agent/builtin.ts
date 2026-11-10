// The coach built into the app: no model, just rules over the same <state>
// block and the same tools. It answers in the demo (which never spends a
// model call), offline, and on a stack that has no API key yet. It speaks
// the model's block format, so its plans and blocks go through the same
// engine checks and render as the same cards.
//
// It is deliberately narrow: plan today (and reshape it for time, fatigue,
// pain or a different session), build a block from a short interview, look
// up a lift, log a check-in, remember a fact. Anything else gets a short
// list of what it can do.

import type {
  AgentReply,
  AssistantBlock,
  ToolResultBlock,
  UserBlock,
  WireMessage,
} from './types'

// ---- reading the conversation ----

interface StateOption {
  id: string
  kind: string
  title: string
  min?: number
  today?: boolean
  done?: boolean
  exercises?: Array<{ name: string; sets: number; target?: string }>
}

interface State {
  now?: { date?: string; weekday?: string; part?: string }
  units?: string
  readiness?: {
    checkin?: Record<string, number> | null
    strap?: { recovery?: number } | null
    flags?: string[]
  }
  block?: {
    name?: string
    week?: number
    weeks?: number
    deload?: boolean
    finished?: boolean
    days?: Array<{ id: string; label: string; weekday?: string; done?: boolean }>
  } | null
  today?: {
    scheduled?: string[]
    next?: string | null
    trained?: Array<{ title: string; kind: string }>
  }
  options?: StateOption[]
  recent?: Array<{ title: string; kind: string }>
  catalog?: Record<string, string[]>
}

const blocksOf = (m: WireMessage): Array<UserBlock | AssistantBlock> =>
  typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content

function findState(messages: WireMessage[]): State | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'user') continue
    for (const b of blocksOf(m)) {
      if (b.type !== 'text') continue
      const text = (b as { text: string }).text
      if (!text.startsWith('<state>')) continue
      try {
        return JSON.parse(
          text.slice('<state>'.length, text.lastIndexOf('</state>')),
        ) as State
      } catch {
        return null
      }
    }
  }
  return null
}

/** What was said, turn by turn, without state blocks or tool traffic. */
function transcript(
  messages: WireMessage[],
): Array<{ role: 'user' | 'assistant'; text: string }> {
  const out: Array<{ role: 'user' | 'assistant'; text: string }> = []
  for (const m of messages) {
    const text = blocksOf(m)
      .filter((b) => b.type === 'text')
      .map((b) => (b as { text: string }).text)
      .filter((t) => !t.startsWith('<state>'))
      .join(' ')
      .trim()
    if (text) out.push({ role: m.role, text })
  }
  return out
}

// ---- writing a reply ----

const say = (text: string): AssistantBlock => ({ type: 'text', text })

const call = (name: string, input: Record<string, unknown>): AssistantBlock => ({
  type: 'tool_use',
  id: `builtin_${crypto.randomUUID()}`,
  name,
  input,
})

const reply = (...content: AssistantBlock[]): AgentReply => ({
  content,
  stopReason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn',
  source: 'builtin',
})

const NO_TRIM = {
  keep_first_exercises: 0,
  drop_sets_per_exercise: 0,
  hold_load: false,
  swaps: [] as Array<{ from: string; to: string }>,
}

// ---- planning a day ----

interface Mods {
  minutes?: number
  /** The athlete said they are run down. */
  gentle?: boolean
  /** Muscles to leave out today (pain). */
  avoid?: string[]
  avoidPart?: string
  optionId?: string
  rest?: boolean
  trainAnyway?: boolean
}

const PART_MUSCLES: Record<string, string[]> = {
  shoulder: ['shoulders', 'chest'],
  elbow: ['triceps', 'biceps'],
  wrist: ['biceps', 'triceps'],
  knee: ['quads'],
  hip: ['glutes', 'quads'],
  back: ['posterior chain', 'hamstrings'],
  hamstring: ['hamstrings', 'posterior chain'],
  quad: ['quads'],
  ankle: ['calves'],
  calf: ['calves'],
  neck: ['traps'],
}

/** Lowercase, with the curly apostrophes phones type made straight, so
 * "don’t" and "don't" read the same to every pattern below. */
const norm = (s: string): string => s.toLowerCase().replace(/[‘’]/g, "'")

const SLEPT_BADLY =
  /\b(rough night|no sleep|did ?n[o']?t sleep|slept (badly|poorly|terribly|like))\b/
const LOW_ENERGY = /\b(tired|exhausted|wrecked|run[- ]?down|low energy|drained|hungover)\b/
const TIRED =
  /\b(tired|beat[- ]?up|fried|exhausted|wrecked|run[- ]?down|rough night|no sleep|did ?n[o']?t sleep|slept (badly|poorly|terribly|like)|stressed|hungover|low energy|drained|not feeling (it|great|good)|go easy|take it easy)\b/
const SORE = /\b(sore|fried|beat[- ]?up|achy|stiff|doms)\b/
const GREAT =
  /\b(feel(ing)? (great|good|strong|fresh|amazing)|slept (well|great)|fully recovered|let'?s go|ready to go)\b/
const PAIN = /\b(hurts?|hurting|pain|painful|tweak(ed)?|injur(y|ed)|pinch(ing|ed)?|flar(e|ed|ing))\b/
const TODAYISH = /\b(today|tonight|tomorrow|later|this (morning|afternoon|evening|week))\b/

/**
 * True when the pattern matches somewhere it is not negated: "sore" counts,
 * "not sore" and "aren't that sore" do not. Phrases that carry their own
 * negator ("no sleep", "not feeling great") are unaffected, because the
 * negator is inside the match rather than before it.
 */
function hit(re: RegExp, t: string): boolean {
  for (const m of t.matchAll(new RegExp(re.source, 'g'))) {
    if (!/(\bnot|\bno|\bnever|n't)\s+(\w+\s+)?$/.test(t.slice(0, m.index))) {
      return true
    }
  }
  return false
}

function readMinutes(t: string): number | undefined {
  const m = t.match(/\b(\d{2,3})\s*(?:min|mins|minutes|m)\b/)
  if (m) return Number(m[1])
  if (/\bhalf (an )?hour\b/.test(t)) return 30
  if (/\b(an|one|1) hour\b/.test(t)) return 60
  if (/\b(short on time|quick|in a hurry|not much time|pressed for time|busy day|squeeze)\b/.test(t)) {
    return 30
  }
  return undefined
}

function checkinFrom(t: string): Record<string, number> | null {
  const c = { sleep: 0, energy: 0, soreness: 0, stress: 0, prs: -1 }
  const tired = hit(TIRED, t)
  if (hit(SLEPT_BADLY, t)) c.sleep = 2
  if (hit(LOW_ENERGY, t)) c.energy = 2
  if (hit(SORE, t)) c.soreness = 2
  if (hit(/\bstressed\b/, t)) c.stress = 2
  // "Not feeling great" must not log as feeling great
  if (!tired && hit(GREAT, t)) {
    if (/slept (well|great)/.test(t)) c.sleep = 4
    c.energy = 4
  }
  return c.sleep || c.energy || c.soreness || c.stress ? c : null
}

const trains = (o: StateOption) =>
  o.kind === 'strength' || o.kind === 'strength template' || o.kind === 'cardio'

const lifts = (o: StateOption) =>
  o.kind === 'strength' || o.kind === 'strength template'

const plain = (s: string) =>
  s.replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * A session the athlete asked for by name. The title has to be the request
 * ("legs", "do the pull day", "upper a instead"), not just a word in the
 * sentence: "my legs are fried" is about the athlete, not the Legs day.
 */
function namedOption(t: string, state: State): StateOption | undefined {
  const said = plain(t)
  return (state.options ?? []).find((o) => {
    if (!trains(o)) return false
    const title = plain(o.title.toLowerCase())
    if (!title) return false
    const x = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return (
      new RegExp(`^(the )?${x}( (today|day|session|instead|please))?$`).test(said) ||
      new RegExp(
        `\\b(do|run|start|switch to|swap to|rather do|want|give me) (the )?${x}\\b`,
      ).test(said) ||
      new RegExp(`\\b${x} (day|session|instead)\\b`).test(said)
    )
  })
}

function readMods(t: string, state: State): Mods {
  const mods: Mods = {}
  const minutes = readMinutes(t)
  if (minutes) mods.minutes = minutes
  if (hit(TIRED, t) || hit(SORE, t)) mods.gentle = true
  if (hit(PAIN, t)) {
    const part = Object.keys(PART_MUSCLES).find((p) => new RegExp(`\\b${p}s?\\b`).test(t))
    if (part) {
      mods.avoid = PART_MUSCLES[part]
      mods.avoidPart = part
    }
  }
  if (/\b(rest day|day off|skip (today|it|the session)|take (today|the day) off|no training)\b/.test(t)) {
    mods.rest = true
  }
  // "Pull it forward" answers the coach's own rest-day line: it means the
  // next session, not the day called Pull
  const forward = /\b(pull it forward|bring it forward|move it up)\b/.test(t)
  if (forward || /\b(train anyway|anyway|still train|want to (train|lift))\b/.test(t)) {
    mods.trainAnyway = true
  }
  const named = forward ? undefined : namedOption(t, state)
  if (named) mods.optionId = named.id
  return mods
}

const has = (state: State, id: string) =>
  (state.options ?? []).some((o) => o.id === id)

function readinessLine(state: State): string | null {
  const c = state.readiness?.checkin
  const parts: string[] = []
  if (c?.sleep != null) parts.push(`sleep ${c.sleep}/5`)
  if (c?.energy != null) parts.push(`energy ${c.energy}/5`)
  if (c?.soreness != null) parts.push(`soreness ${c.soreness}/5`)
  if (c?.prs != null) parts.push(`recovery ${c.prs}/10`)
  const strap = state.readiness?.strap?.recovery
  if (strap != null) parts.push(`strap ${strap}%`)
  return parts.length ? parts.join(', ') : null
}

function planDay(state: State, mods: Mods): AgentReply {
  const options = state.options ?? []
  const flags = state.readiness?.flags ?? []
  const block = state.block
  const sleepId = has(state, 'routine:sleep') ? 'routine:sleep' : null
  const evening = sleepId ? [{ option_id: sleepId, note: 'Before bed', trim: NO_TRIM }] : []
  const trainedToday = flags.includes('trained_today')

  const restPlan = (headline: string, rationale: string, lead: string) =>
    reply(
      say(lead),
      call('set_day_plan', {
        headline,
        rationale,
        items: evening,
        custom_session: null,
      }),
    )

  if (mods.rest) {
    return restPlan(
      'Rest day',
      'You asked for the day off. The session stays on the schedule and nothing is lost by moving it.',
      'Day off it is. The session keeps.',
    )
  }

  // What is still on today's schedule. A session logged without its block
  // link stays "scheduled", so anything already trained under that title
  // (logged titles carry " · wk N") is counted as done here too.
  const trainedTitles = (state.today?.trained ?? []).map((x) => x.title)
  const remaining = (state.today?.scheduled ?? [])
    .map((id) => options.find((o) => o.id === id))
    .filter((o): o is StateOption => !!o)
    .filter((o) => !trainedTitles.some((title) => title.startsWith(o.title)))

  if (trainedToday && !mods.trainAnyway && !mods.optionId && remaining.length === 0) {
    const done = state.today?.trained?.find((t) => t.kind !== 'recovery')?.title
    const asked = mods.minutes || mods.gentle || mods.avoid
    return restPlan(
      'Training done',
      `${done ?? 'Today’s session'} is logged. What is left is winding down.`,
      asked
        ? `${done ?? 'Today’s session'} is already logged, so there is nothing left to trim. Wind down${mods.gentle ? ' and get to bed early' : ''}. Say "train anyway" for a second session.`
        : 'The work is in. All that is left today is the wind-down.',
    )
  }

  // Which sessions are today's. Usually one; a double day has two.
  let sessions: StateOption[] = []
  let why = ''
  if (mods.optionId) {
    const asked = options.find((o) => o.id === mods.optionId)
    if (asked) sessions = [asked]
    why = `You asked for ${asked?.title}.`
  } else if (block && !block.finished) {
    const days = block.days ?? []
    const anchored = days.some((d) => d.weekday)
    if (remaining.length > 0) {
      sessions = remaining
      why = `Week ${block.week} of ${block.weeks}${block.deload ? ', deload' : ''}: ${remaining.map((o) => o.title).join(' and ')} ${remaining.length > 1 ? 'are' : 'is'} on the schedule.`
    } else if (!anchored || mods.trainAnyway) {
      const next = options.find((o) => o.id === state.today?.next)
      if (next) {
        sessions = [next]
        why = `Week ${block.week} of ${block.weeks}${block.deload ? ', deload' : ''}: ${next.title} is next up.`
      }
    }
    if (sessions.length === 0) {
      const next = options.find((o) => o.id === state.today?.next)
      const day = days.find((d) => d.id === state.today?.next)
      return reply(
        say(
          `Nothing is scheduled today. ${next ? `${next.title} is next${day?.weekday ? ` on ${day.weekday}` : ''}.` : ''} Rest, or pull it forward.`.replace(/\s+/g, ' '),
        ),
        call('set_day_plan', {
          headline: 'Rest day',
          rationale: `Week ${block.week} of ${block.weeks}. No session falls on today, so the plan is recovery.`,
          items: evening,
          custom_session: null,
        }),
        call('offer_choices', { options: ['Train anyway', 'Keep it a rest day'] }),
      )
    }
  } else {
    // No block: the strength template that was not the last thing trained
    const templates = options.filter((o) => o.kind === 'strength template')
    const lastTitle = (state.recent ?? []).find((r) => r.kind === 'strength')?.title
    const pick = templates.find((o) => o.title !== lastTitle) ?? templates[0]
    if (pick) {
      sessions = [pick]
      why = `No block is running, so this is ${pick.title}${lastTitle && lastTitle !== pick.title ? `, since ${lastTitle} was last` : ''}.`
    }
  }

  const gentle = mods.gentle || flags.includes('readiness_low')
  const readiness = readinessLine(state)
  const reasons: string[] = [why]
  const trim = { ...NO_TRIM, swaps: [] as Array<{ from: string; to: string }> }
  const tags: string[] = []

  if (sessions.length === 0) {
    // Nothing saved to run: a simple full-body session from the catalog
    const pick = (muscle: string, want: string) =>
      (state.catalog?.[muscle] ?? []).includes(want) ? want : state.catalog?.[muscle]?.[0]
    const rows = [
      { name: pick('quads', 'Back squat'), sets: 3 },
      { name: pick('chest', 'Bench press'), sets: 3 },
      { name: pick('back', 'Barbell row'), sets: 3 },
      { name: pick('hamstrings', 'Romanian deadlift'), sets: 2 },
      { name: pick('shoulders', 'Overhead press'), sets: 2 },
    ].filter((r): r is { name: string; sets: number } => !!r.name)
    const sets = gentle ? rows.map((r) => ({ ...r, sets: Math.max(1, r.sets - 1) })) : rows
    const short = mods.minutes ? sets.slice(0, Math.max(2, Math.floor((mods.minutes - 5) / 9))) : sets
    return reply(
      say('No block and no templates yet, so here is a plain full-body session. Say the word and I will build you a block.'),
      call('set_day_plan', {
        headline: mods.minutes ? `Full body, ${mods.minutes} min` : 'Full body',
        rationale: `Nothing is programmed, so this covers the big patterns once.${gentle && readiness ? ` Kept light: ${readiness}.` : ''}`,
        items: [
          { option_id: 'warmup', note: '', trim: NO_TRIM },
          { option_id: 'custom', note: '', trim: NO_TRIM },
          { option_id: 'cooldown', note: '', trim: NO_TRIM },
          ...evening,
        ],
        custom_session: { title: 'Full body', exercises: short },
      }),
    )
  }

  // The lift is the session the day is shaped around: trims apply to it
  // and the warm-up and cool-down are built from it.
  const lift = sessions.find(lifts)
  const exercises = lift?.exercises ?? []
  if (lift && exercises.length > 0) {
    if (mods.avoid) {
      const catalog = state.catalog ?? {}
      for (const e of exercises) {
        const muscle = Object.keys(catalog).find((m) => catalog[m].includes(e.name))
        if (muscle && mods.avoid.includes(muscle)) trim.swaps.push({ from: e.name, to: '' })
      }
      if (trim.swaps.length > 0) {
        tags.push(`no ${mods.avoidPart} work`)
        reasons.push(
          `Left out ${trim.swaps.map((s) => s.from).join(', ')} around the ${mods.avoidPart}. If it is sharp or it lingers, get it looked at.`,
        )
      }
    }
    const kept = exercises.filter((e) => !trim.swaps.some((s) => s.from === e.name))
    if (gentle && !block?.deload) {
      trim.drop_sets_per_exercise = 1
      trim.hold_load = true
      tags.push('easy')
      // What they just said outranks the numbers in state, which were
      // read before this message's check-in was logged
      reasons.push(
        `${mods.gentle ? 'You said you are run down' : `Readiness is low${readiness ? ` (${readiness})` : ''}`}, so one set comes off each lift and loads hold.`,
      )
    } else if (gentle) {
      reasons.push('It is the deload week, which is already the easy version.')
    } else if (readiness) {
      reasons.push(`Readiness: ${readiness}.`)
    }
    if (mods.minutes) {
      // About three minutes a set plus five to get going
      const budget = Math.max(3, Math.floor((mods.minutes - 5) / 3))
      let used = 0
      let keep = 0
      for (const e of kept) {
        const sets = Math.max(1, e.sets - trim.drop_sets_per_exercise)
        if (keep >= 2 && used + sets > budget) break
        used += sets
        keep++
      }
      if (keep < kept.length) {
        trim.keep_first_exercises = keep
        reasons.push(`${mods.minutes} minutes fits the first ${keep} lifts; the compounds come first, so the important work stays.`)
      }
      // Two lifts is the floor; if they still run long, take a set off each
      if (used > budget && trim.drop_sets_per_exercise === 0) {
        trim.drop_sets_per_exercise = 1
        reasons.push('One set comes off each to fit the clock.')
      }
      tags.push(`${mods.minutes} min`)
    }
  } else if (readiness) {
    reasons.push(`Readiness: ${readiness}.`)
  }

  const title = sessions.map((o) => o.title).join(' and ')
  const headline = [title, ...tags].join(', ')
  const changed =
    trim.swaps.length > 0 || trim.drop_sets_per_exercise > 0 || trim.keep_first_exercises > 0
  const lead = changed
    ? `${title}, reshaped for today: ${tags.join(', ')}.`
    : `${title} today, as written.`
  if (!changed && readiness && lift) reasons.push('Run it as written.')
  return reply(
    say(lead),
    call('set_day_plan', {
      headline,
      rationale: reasons.filter(Boolean).join(' '),
      items: [
        ...sessions.flatMap((o) =>
          o === lift
            ? [
                { option_id: 'warmup', note: '', trim: NO_TRIM },
                { option_id: o.id, note: trim.hold_load ? 'Repeat last time’s numbers' : '', trim },
                { option_id: 'cooldown', note: '', trim: NO_TRIM },
              ]
            : [{ option_id: o.id, note: '', trim: NO_TRIM }],
        ),
        ...evening,
      ],
      custom_session: null,
    }),
  )
}

// ---- building a block ----

const Q_DAYS = 'How many days a week can you train?'
const Q_FOCUS = 'What should this block prioritise?'
const Q_WEEKS = 'How long should it run, deload week included?'

type Row = [string, number]
const day = (label: string, rows: Row[]) => ({
  label,
  weekday: 'any',
  exercises: rows.map(([name, sets]) => ({ name, sets })),
})

const UPPER_A = day('Upper A', [['Bench press', 3], ['Barbell row', 3], ['Overhead press', 3], ['Lat pulldown', 2], ['Dumbbell curl', 2], ['Triceps pushdown', 2]])
const LOWER_A = day('Lower A', [['Back squat', 3], ['Romanian deadlift', 3], ['Leg press', 2], ['Leg curl', 2], ['Calf raise', 3]])
const UPPER_B = day('Upper B', [['Incline dumbbell press', 3], ['Seated cable row', 3], ['Lateral raise', 3], ['Pull-up', 2], ['Hammer curl', 2], ['Skullcrusher', 2]])
const LOWER_B = day('Lower B', [['Deadlift', 2], ['Front squat', 3], ['Leg extension', 2], ['Leg curl', 3], ['Seated calf raise', 3], ['Hanging leg raise', 2]])
const PUSH_A = day('Push A', [['Bench press', 3], ['Overhead press', 3], ['Incline dumbbell press', 2], ['Lateral raise', 3], ['Triceps pushdown', 3]])
const PULL_A = day('Pull A', [['Barbell row', 3], ['Lat pulldown', 3], ['Seated cable row', 2], ['Face pull', 2], ['Barbell curl', 3]])
const LEGS_A = day('Legs A', [['Back squat', 3], ['Romanian deadlift', 3], ['Leg press', 2], ['Leg curl', 2], ['Calf raise', 3]])
const PUSH_B = day('Push B', [['Incline bench press', 3], ['Dumbbell bench press', 2], ['Arnold press', 3], ['Cable fly', 2], ['Overhead triceps extension', 3]])
const PULL_B = day('Pull B', [['Pull-up', 3], ['Chest-supported row', 3], ['Straight-arm pulldown', 2], ['Rear delt fly', 2], ['Hammer curl', 3]])
const LEGS_B = day('Legs B', [['Deadlift', 2], ['Hack squat', 3], ['Leg extension', 2], ['Nordic curl', 2], ['Seated calf raise', 3]])
const FULL_A = day('Full body A', [['Back squat', 3], ['Bench press', 3], ['Barbell row', 3], ['Romanian deadlift', 2], ['Lateral raise', 2], ['Triceps pushdown', 2]])
const FULL_B = day('Full body B', [['Deadlift', 2], ['Incline dumbbell press', 3], ['Lat pulldown', 3], ['Leg press', 3], ['Dumbbell curl', 2], ['Face pull', 2]])
const FULL_C = day('Full body C', [['Front squat', 3], ['Overhead press', 3], ['Seated cable row', 3], ['Leg curl', 3], ['Cable fly', 2], ['Calf raise', 3]])

const SPLITS: Record<number, { name: string; days: ReturnType<typeof day>[] }> = {
  2: { name: 'Full body', days: [FULL_A, FULL_B] },
  3: { name: 'Full body', days: [FULL_A, FULL_B, FULL_C] },
  4: { name: 'Upper lower', days: [UPPER_A, LOWER_A, UPPER_B, LOWER_B] },
  5: { name: 'Push pull legs plus', days: [PUSH_A, PULL_A, LEGS_A, UPPER_B, LOWER_B] },
  6: { name: 'Push pull legs', days: [PUSH_A, PULL_A, LEGS_A, PUSH_B, PULL_B, LEGS_B] },
}

const FOCUS_WORDS: Array<[RegExp, string[]]> = [
  [/\b(balanced|everything|general|overall|no focus|nothing in particular)\b/, []],
  [/\b(chest|pecs?)\b/, ['chest']],
  [/\b(back|lats?)\b/, ['back']],
  [/\b(legs?|lower body)\b/, ['quads', 'hamstrings']],
  [/\bquads?\b/, ['quads']],
  [/\bglutes?\b/, ['glutes']],
  [/\b(shoulders?|delts?)\b/, ['shoulders']],
  [/\barms?\b/, ['biceps', 'triceps']],
  [/\bbiceps?\b/, ['biceps']],
  [/\btriceps?\b/, ['triceps']],
]

const BLOCK_INTENT =
  /\b(block|program|programme|mesocycle)\b|\b(build|make|write|design|create|new)\b.*\b(plan|routine|split)\b|\btraining plan\b/
/** "Make me a plan for today" is about the day, not a block. */
const ABOUT_THE_DAY = /\b(today|tonight|my day|this (morning|afternoon|evening))\b/
const wantsBlock = (t: string) => BLOCK_INTENT.test(t) && !ABOUT_THE_DAY.test(t)
/** In the opening request a muscle is a focus only when it is asked for as
 * one: "get back into lifting" is not a back block. */
const FOCUS_CUE = /\b(focus|prioriti[sz]|emphasi[sz]|bigger|grow|bring up|build (up )?my)/
const LEAVES_INTERVIEW =
  /\b(never ?mind|cancel|forget it|stop|not now|no thanks)\b|^\s*(thanks|thank you|cheers|ok|okay)[.! ]*$/

function blockFlow(convo: Array<{ role: string; text: string }>): AgentReply | null {
  // The flow starts at the last message that asked for a block
  let start = -1
  for (let i = convo.length - 1; i >= 0; i--) {
    if (convo[i].role === 'user' && wantsBlock(norm(convo[i].text))) {
      start = i
      break
    }
  }
  if (start === -1) return null
  const since = convo.slice(start)
  // Once a block has been proposed the flow is over
  if (since.some((m) => m.role === 'assistant' && /^Proposed a block|^Here is the block|block is up/i.test(m.text))) {
    return null
  }
  // Only follow the thread while the coach's last line was one of its questions
  const lastCoach = [...since].reverse().find((m) => m.role === 'assistant')
  if (lastCoach && ![Q_DAYS, Q_FOCUS, Q_WEEKS].some((q) => lastCoach.text.includes(q))) {
    return null
  }
  // A way out: "never mind", a thanks, or a question about today hands the
  // message back to the router, and its answer ends the interview.
  const latest = norm(convo.at(-1)?.text ?? '')
  if (since.length > 1 && (LEAVES_INTERVIEW.test(latest) || ABOUT_THE_DAY.test(latest))) {
    return null
  }

  let days: number | undefined
  let focus: string[] | undefined
  let weeks: number | undefined
  since.forEach((m, i) => {
    if (m.role !== 'user') return
    const t = norm(m.text)
    const asked = i > 0 ? since[i - 1].text : ''
    const d = t.match(/\b([2-6])\s*(?:x|days?|times|sessions)\b/) ?? (asked.includes(Q_DAYS) ? t.match(/\b([2-6])\b/) : null)
    if (d) days = Number(d[1])
    const w = t.match(/\b([4-6])\s*(?:weeks?|wks?)\b/) ?? (asked.includes(Q_WEEKS) ? t.match(/\b([4-6])\b/) : null)
    if (w) weeks = Number(w[1])
    const opening = i === 0 && FOCUS_CUE.test(t) && !PAIN.test(t)
    if (opening || asked.includes(Q_FOCUS)) {
      const found = FOCUS_WORDS.find(([re]) => re.test(t))
      if (found) focus = found[1]
      else if (asked.includes(Q_FOCUS)) focus = []
    }
  })

  if (days === undefined) {
    // Asked already and the answer was not a number it can use
    const again = since.some((m) => m.role === 'assistant' && m.text.includes(Q_DAYS))
    return reply(
      say(again ? `Between 2 and 6 days works. ${Q_DAYS}` : Q_DAYS),
      call('offer_choices', { options: ['3 days', '4 days', '5 days', '6 days'] }),
    )
  }
  if (focus === undefined) {
    return reply(say(Q_FOCUS), call('offer_choices', { options: ['Balanced', 'Chest', 'Back', 'Legs', 'Arms'] }))
  }
  if (weeks === undefined) {
    return reply(say(Q_WEEKS), call('offer_choices', { options: ['4 weeks', '5 weeks', '6 weeks'] }))
  }

  const split = SPLITS[days] ?? SPLITS[4]
  const focusName = focus.length ? `${focus[0][0].toUpperCase()}${focus[0].slice(1)} focus` : split.name
  return reply(
    say(`${days} days, ${weeks} weeks${focus.length ? `, ${focus.join(' and ')} first` : ''}. Volume opens near the minimum effective dose so there is room to build.`),
    call('propose_block', {
      name: focusName,
      weeks,
      focus_muscles: focus.slice(0, 3),
      days: split.days,
      rationale: `${split.name} trains each muscle about twice a week on ${days} days. Sets start low on purpose: focus muscles gain a set a week and the last week is a deload.`,
    }),
  )
}

// ---- lookups, notes ----

const LIFT_WORDS: Array<[RegExp, string]> = [
  [/\bbench\b/, 'Bench press'],
  [/\bsquats?\b/, 'Back squat'],
  [/\bdeadlifts?\b/, 'Deadlift'],
  [/\b(ohp|overhead press)\b/, 'Overhead press'],
  [/\brows?\b/, 'Barbell row'],
  [/\bpull[- ]?ups?\b/, 'Pull-up'],
]

function mentionedLift(t: string, state: State): string | undefined {
  const names = Object.values(state.catalog ?? {}).flat()
  const hit = names
    .filter((n) => t.includes(n.toLowerCase()))
    .sort((a, b) => b.length - a.length)[0]
  if (hit) return hit
  const word = LIFT_WORDS.find(([re]) => re.test(t))
  return word && names.includes(word[1]) ? word[1] : undefined
}

// Short tokens are closed with a word boundary: an open "pr" matched the
// start of "press", which sent every message naming a press to a lookup.
const ASKS_HISTORY =
  /\b(how('?s| is| are| has| have)\b|progress|trend(ing)?\b|prs?\b|records?\b|best\b|max\b|1rm\b|history|last time|stall(ed|ing)?\b|plateau|going up|improv)/

/** "I don't have a barbell" → "No barbell": notes read as facts about them. */
function thirdPerson(text: string): string {
  const rules: Array<[RegExp, string]> = [
    [/^i (?:do ?n[o'’]?t|dont) have (?:an? |any )?(.+)$/i, 'No $1'],
    [/^i (?:only |just )have (.+)$/i, 'Only has $1'],
    [/^i have (.+)$/i, 'Has $1'],
    [/^i train (.+)$/i, 'Trains $1'],
    [/^i (?:can ?not|can[’']t) (.+)$/i, 'Cannot $1'],
    [/^my goal is (?:to )?(.+)$/i, 'Goal: $1'],
    [/^i want to (.+)$/i, 'Wants to $1'],
    [/^my (.+)$/i, 'Their $1'],
  ]
  for (const [re, to] of rules) {
    if (re.test(text)) return text.replace(re, to)
  }
  return text
}

function noteFrom(t: string, raw: string): { category: string; note: string } | null {
  const text = thirdPerson(
    raw.replace(/^\s*(please\s+)?remember( that)?\s*/i, '').trim(),
  )
  if (!text) return null
  let category = 'preference'
  if (PAIN.test(t) || /\b(avoid|bad (knee|shoulder|back|hip|elbow))\b/.test(t)) category = 'injury'
  else if (/\b(barbell|rack|bench|machine|cable|dumbbell|kettlebell|band|gym|home|equipment)\b/.test(t)) category = 'equipment'
  else if (/\b(goal|want to|aiming|trying to)\b/.test(t)) category = 'goal'
  else if (/\b(mon|tue|wed|thu|fri|sat|sun|morning|evening|weekday|weekend|days a week)\w*\b/.test(t)) category = 'schedule'
  const note = text[0].toUpperCase() + text.slice(1)
  return { category, note: note.endsWith('.') ? note : `${note}.` }
}

const REMEMBER =
  /^\s*(please\s+)?remember\b|\bi (only |just )?have (a|an|only|no)\b|\bi do ?n[o']?t have\b|\bno (barbell|rack|bench|machines?|cables?|dumbbells?)\b|\bi train at home\b|\bmy goal is\b/

// ---- after a tool ran ----

function afterTools(messages: WireMessage[], state: State): AgentReply {
  const last = messages.at(-1)!
  const results = blocksOf(last).filter(
    (b): b is ToolResultBlock => b.type === 'tool_result',
  )
  const prior = messages.at(-2)
  const calls = prior
    ? blocksOf(prior).filter(
        (b): b is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } =>
          b.type === 'tool_use',
      )
    : []
  const nameOf = (r: ToolResultBlock) => calls.find((c) => c.id === r.tool_use_id)?.name
  const parse = (r: ToolResultBlock): Record<string, unknown> => {
    try {
      return JSON.parse(r.content) as Record<string, unknown>
    } catch {
      return {}
    }
  }

  const failed = results.find((r) => r.is_error)
  if (failed) {
    const errors = parse(failed).errors
    const first = Array.isArray(errors) && typeof errors[0] === 'string' ? errors[0] : null
    return reply(say(first ? `That did not pass the engine: ${first}` : 'That did not go through. Try it another way.'))
  }

  for (const r of results) {
    const name = nameOf(r)
    const body = parse(r)
    if (name === 'get_exercise_history') {
      const sessions = (body.sessions as Array<{ date: string; sets: string }>) ?? []
      if (sessions.length === 0) {
        return reply(say(`Nothing logged for ${String(body.exercise)} yet.`))
      }
      const best = body.best_estimated_1rm as { value: number; from: string; date: string } | null
      const unit = String(body.unit ?? state.units ?? 'lb')
      const day = (iso: string) =>
        new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
        })
      const newest = sessions[0]
      const oldest = sessions.at(-1)!
      const top = (s: string) => Number(s.split('×')[0])
      const delta = top(newest.sets) - top(oldest.sets)
      const trend =
        sessions.length < 2 || !Number.isFinite(delta)
          ? ''
          : delta > 0
            ? ` Top set is up ${delta} ${unit} over the last ${sessions.length} sessions.`
            : delta < 0
              ? ` Top set is down ${-delta} ${unit} over the last ${sessions.length} sessions.`
              : ` Top set has held over the last ${sessions.length} sessions.`
      return reply(
        say(
          `${String(body.exercise)}: last session ${day(newest.date)} was ${newest.sets}.${trend}${best ? ` Best estimated max ${best.value} ${unit}, from ${best.from} on ${day(best.date)}.` : ''}`,
        ),
      )
    }
    if (name === 'get_training_log') {
      const weekly = (body.avg_weekly_sets_by_muscle as Record<string, number>) ?? {}
      const top = Object.entries(weekly).slice(0, 4).map(([m, n]) => `${m} ${n}`)
      const count = Array.isArray(body.sessions) ? body.sessions.length : 0
      return reply(
        say(`${count} sessions in the last ${String(body.days)} days.${top.length ? ` Weekly sets: ${top.join(', ')}.` : ''}`),
      )
    }
    if (name === 'log_checkin' && !calls.some((c) => c.name === 'set_day_plan')) {
      // The check-in was the input; now plan with it
      const said = [...transcript(messages)].reverse().find((m) => m.role === 'user')?.text ?? ''
      const mods = readMods(norm(said), state)
      const planned = planDay(state, mods)
      return planned
    }
    if (name === 'set_day_plan' && Array.isArray(body.engine_changes)) {
      return reply(say(`Set. The engine made one change: ${String(body.engine_changes[0])}`))
    }
    if (name === 'propose_block') {
      const notes = [
        ...(Array.isArray(body.engine_changes) ? body.engine_changes : []),
        ...(Array.isArray(body.warnings) ? body.warnings : []),
      ]
      return reply(say(notes.length ? `Block is up. Engine note: ${String(notes[0])}` : 'Block is up.'))
    }
  }
  return reply(say('Done.'))
}

// ---- the router ----

export function builtinReply(messages: WireMessage[]): AgentReply {
  const state = findState(messages)
  const last = messages.at(-1)
  if (!state || !last) {
    return reply(say('I cannot see your training right now. Close this and open it again.'))
  }
  if (last.role === 'user' && blocksOf(last).some((b) => b.type === 'tool_result')) {
    return afterTools(messages, state)
  }

  const convo = transcript(messages)
  const raw = convo.at(-1)?.text ?? ''
  const t = norm(raw)

  const building = blockFlow(convo)
  if (building) return building

  const lift = mentionedLift(t, state)
  if (lift && ASKS_HISTORY.test(t)) {
    return reply(call('get_exercise_history', { exercise: lift, sessions: 5 }))
  }

  // An explicit "remember ..." always wins. Otherwise a statement is only
  // kept when it reads as a standing fact: not about today, how they feel,
  // or how long they have.
  const explicit = /^\s*(please\s+)?remember\b/.test(t)
  const passing =
    readMinutes(t) !== undefined || hit(TIRED, t) || hit(SORE, t) || TODAYISH.test(t)
  if (explicit || (REMEMBER.test(t) && !PAIN.test(t) && !passing)) {
    const note = noteFrom(t, raw)
    if (note) return reply(say('Noted. I will plan around that.'), call('remember', note))
  }

  if (/^\s*(thanks|thank you|cheers|ok|okay|got it|great|perfect|nice)[.! ]*$/.test(t)) {
    return reply(say('Go get it.'))
  }

  const mods = readMods(t, state)
  const aboutToday =
    /\b(today|plan|session|train|training|workout|lift|gym|as planned|looks good|run it|what should i|what('?s| is) (on|next)|ready)\b/.test(t) ||
    Object.keys(mods).length > 0 ||
    hit(GREAT, t)
  if (aboutToday) {
    const checkin = checkinFrom(t)
    const planned = planDay(state, mods)
    // What they said about how they feel goes on the record first
    return checkin
      ? { ...planned, content: [call('log_checkin', checkin), ...planned.content] }
      : planned
  }

  return reply(
    say('I can plan today, reshape it for time or how you feel, build a training block, or look up a lift.'),
    call('offer_choices', { options: ['Plan my day', 'Short on time', 'Build a block'] }),
  )
}
