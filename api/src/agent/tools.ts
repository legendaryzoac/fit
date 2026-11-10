// The coach's tools. Every one of them runs in the browser, where the
// athlete's data and the progression engine already live: this Lambda only
// relays the calls. The list renders ahead of the system prompt in the
// cached prefix, so its order and wording must stay stable.
//
// Schemas are strict (every object closed, every property required) so a
// small model cannot emit a malformed call; "not applicable" is a neutral
// value (empty string, 0, empty list, null) rather than a missing key. The
// browser still validates everything against the engine before acting.

import type Anthropic from '@anthropic-ai/sdk'

// The muscles the block editor can show as a focus (its FOCUS_CHOICES);
// anything else would be saved but could never be untoggled there.
const FOCUS_MUSCLES = [
  'chest',
  'back',
  'shoulders',
  'biceps',
  'triceps',
  'quads',
  'hamstrings',
  'glutes',
  'calves',
  'core',
]

// Exercises and set counts are the model's to choose. Rep windows, loads
// and effort are not: the engine derives them from the lift and the log.
const EXERCISE_ROW = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'sets'],
  properties: {
    name: {
      type: 'string',
      description: 'Exercise name exactly as it appears in state.catalog.',
    },
    sets: { type: 'integer', description: 'Working sets, 1 to 6.' },
  },
} as const

export function agentTools(strict: boolean): Anthropic.Tool[] {
  const tools: Anthropic.Tool[] = [
    {
      name: 'get_exercise_history',
      description:
        'Look up the logged history of one exercise: recent sessions with every set (weight, reps, effort), the best estimated one-rep max and when it was set. Call this before answering any question about progress, stalls or records on a specific lift, and before proposing a weight for a lift that is not in state.lifts.',
      input_schema: {
        type: 'object',
        additionalProperties: false,
        required: ['exercise', 'sessions'],
        properties: {
          exercise: {
            type: 'string',
            description: 'Exercise name, as in state.catalog.',
          },
          sessions: {
            type: 'integer',
            description: 'How many of the most recent sessions to return, 1 to 12.',
          },
        },
      },
    },
    {
      name: 'get_training_log',
      description:
        'List the sessions logged in the last N days, oldest first: date, title, kind, minutes, session effort, and working sets per muscle. state.recent already holds the last 7 days; call this for longer windows, for example to judge what volume the athlete has tolerated over the past month before building a block.',
      input_schema: {
        type: 'object',
        additionalProperties: false,
        required: ['days'],
        properties: {
          days: { type: 'integer', description: 'Window length in days, 8 to 60.' },
        },
      },
    },
    {
      name: 'set_day_plan',
      description:
        "Set today's plan on the home screen. Call it whenever the athlete asks what to do today, asks to change today's plan, or reports something that changes it (time, energy, pain, equipment). It replaces the saved plan. Items are shown and started in the order given. The engine checks ids, exercise names and the per-session set cap and reports anything it changed or could not use.",
      input_schema: {
        type: 'object',
        additionalProperties: false,
        required: ['headline', 'rationale', 'items', 'custom_session'],
        properties: {
          headline: {
            type: 'string',
            description:
              'Names the day in at most 6 words, for example "Push A, trimmed to 40 min" or "Rest day".',
          },
          rationale: {
            type: 'string',
            description:
              'One or two sentences on why this is the plan, citing the facts from state that decided it.',
          },
          items: {
            type: 'array',
            description:
              'What to do today, in order. An empty list means a pure rest day.',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['option_id', 'note', 'trim'],
              properties: {
                option_id: {
                  type: 'string',
                  description:
                    'An id from state.options, or "custom" to place custom_session here.',
                },
                note: {
                  type: 'string',
                  description:
                    'Optional cue shown under the item, at most 12 words. Empty string for none.',
                },
                trim: {
                  type: 'object',
                  description:
                    'Adjustments to a planned or template strength session. Use the neutral values (0, false, empty list) when nothing changes, and for every non-strength item.',
                  additionalProperties: false,
                  required: [
                    'keep_first_exercises',
                    'drop_sets_per_exercise',
                    'hold_load',
                    'swaps',
                  ],
                  properties: {
                    keep_first_exercises: {
                      type: 'integer',
                      description:
                        'Keep only the first N exercises to fit the time available. 0 keeps all.',
                    },
                    drop_sets_per_exercise: {
                      type: 'integer',
                      description:
                        'Sets to take off each exercise: 0, 1 or 2. No exercise goes below one set.',
                    },
                    hold_load: {
                      type: 'boolean',
                      description:
                        "True to repeat last session's weights and reps instead of progressing today. Never in a deload week: the engine ignores it there.",
                    },
                    swaps: {
                      type: 'array',
                      description:
                        'Exercises to replace, for example around pain or missing equipment.',
                      items: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['from', 'to'],
                        properties: {
                          from: {
                            type: 'string',
                            description: 'Exercise in the session to replace.',
                          },
                          to: {
                            type: 'string',
                            description:
                              'Replacement from state.catalog, same muscle. Empty string removes the exercise.',
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          custom_session: {
            description:
              'A strength session you composed for today, or null. Only when nothing in state.options fits. It is placed by an item whose option_id is "custom"; without that item the call is rejected.',
            anyOf: [
              { type: 'null' },
              {
                type: 'object',
                additionalProperties: false,
                required: ['title', 'exercises'],
                properties: {
                  title: { type: 'string', description: 'Short session name.' },
                  exercises: { type: 'array', items: EXERCISE_ROW },
                },
              },
            ],
          },
        },
      },
    },
    {
      name: 'propose_block',
      description:
        'Propose a training block (mesocycle) once you know the days per week, session length, equipment and priorities. The engine validates it against the weekly volume landmarks, the 8-set per-session cap and the exercise catalog, and returns weekly sets per muscle with their zones plus anything it clamped or rejected. If it reports errors, correct them and call again. The athlete sees the passing version as a card they can save or open in the editor.',
      input_schema: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'weeks', 'focus_muscles', 'days', 'rationale'],
        properties: {
          name: { type: 'string', description: 'Block name, at most 4 words.' },
          weeks: {
            type: 'integer',
            description: 'Total length including the final deload week: 4, 5 or 6.',
          },
          focus_muscles: {
            type: 'array',
            description:
              'Up to 3 muscles that gain volume across the block. Empty when nothing is prioritised.',
            items: { type: 'string', enum: FOCUS_MUSCLES },
          },
          days: {
            type: 'array',
            description: 'Training days in weekly order, 2 to 6.',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['label', 'weekday', 'exercises'],
              properties: {
                label: {
                  type: 'string',
                  description: 'Day name, for example "Upper A".',
                },
                weekday: {
                  type: 'string',
                  enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun', 'any'],
                  description:
                    'Fixed weekday when the athlete gave a schedule, otherwise "any".',
                },
                exercises: { type: 'array', items: EXERCISE_ROW },
              },
            },
          },
          rationale: {
            type: 'string',
            description:
              'Two sentences at most: the split, and why volume starts where it does.',
          },
        },
      },
    },
    {
      name: 'offer_choices',
      description:
        'Show tappable replies under your message. Call it whenever you ask the athlete a question that has a few likely answers (days per week, session length, equipment, yes or no). Write the question in your message first; they can always type something else instead.',
      input_schema: {
        type: 'object',
        additionalProperties: false,
        required: ['options'],
        properties: {
          options: {
            type: 'array',
            description: '2 to 5 short answers, at most 4 words each.',
            items: { type: 'string' },
          },
        },
      },
    },
    {
      name: 'log_checkin',
      description:
        "Record today's check-in from what the athlete said about how they feel. Call it when they describe sleep, energy, soreness, stress or overall readiness in words. Set only the scales they actually spoke to.",
      input_schema: {
        type: 'object',
        additionalProperties: false,
        required: ['sleep', 'energy', 'soreness', 'stress', 'prs'],
        properties: {
          sleep: {
            type: 'integer',
            description: 'Sleep quality 1 (terrible) to 5 (great). 0 when not mentioned.',
          },
          energy: {
            type: 'integer',
            description: 'Energy 1 (flat) to 5 (high). 0 when not mentioned.',
          },
          soreness: {
            type: 'integer',
            description:
              'Soreness, higher is better: 1 (very sore) to 5 (fresh). 0 when not mentioned.',
          },
          stress: {
            type: 'integer',
            description:
              'Stress, higher is better: 1 (very stressed) to 5 (calm). 0 when not mentioned.',
          },
          prs: {
            type: 'integer',
            description:
              'Perceived Recovery Status 0 (not recovered) to 10 (fully). -1 when not mentioned.',
          },
        },
      },
    },
    {
      name: 'remember',
      description:
        'Save a durable fact about the athlete so it appears in state.notes from now on: a goal, a weekly schedule, equipment they have or lack, an injury or a movement to avoid, a standing preference. Call it when they state such a fact, not for how they feel today.',
      input_schema: {
        type: 'object',
        additionalProperties: false,
        required: ['category', 'note'],
        properties: {
          category: {
            type: 'string',
            enum: ['goal', 'schedule', 'equipment', 'injury', 'preference'],
          },
          note: {
            type: 'string',
            description: 'The fact in one short sentence, written in third person.',
          },
        },
      },
    },
  ]
  return strict ? tools.map((t) => ({ ...t, strict: true })) : tools
}
