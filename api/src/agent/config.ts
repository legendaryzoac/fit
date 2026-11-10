import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm'

const ssm = new SSMClient({})
const prefix = process.env.AGENT_SSM_PREFIX ?? '/fit/agent'

/** The cheapest current Claude. Override per environment, not per request:
 * the prompt cache is model-scoped. */
export const AGENT_MODEL = process.env.AGENT_MODEL ?? 'claude-haiku-5-5'

const EFFORTS = ['low', 'medium', 'high'] as const
export type AgentEffort = (typeof EFFORTS)[number]

/** Pinned per deployment: changing effort between requests drops the cache. */
export const AGENT_EFFORT: AgentEffort = EFFORTS.includes(
  process.env.AGENT_EFFORT as AgentEffort,
)
  ? (process.env.AGENT_EFFORT as AgentEffort)
  : 'medium'

/** Model calls one account may make per UTC day. A tool loop spends one per
 * round, so this is roughly 40 to 80 conversations' worth. */
export const AGENT_DAILY_CALLS = (() => {
  const n = Number(process.env.AGENT_DAILY_CALLS)
  return Number.isInteger(n) && n > 0 ? n : 150
})()

/** Escape hatch: set AGENT_STRICT_TOOLS=0 if strict schemas ever get in the
 * way. The browser validates every tool call either way. */
export const AGENT_STRICT_TOOLS = process.env.AGENT_STRICT_TOOLS !== '0'

let cachedKey: string | null = null
let missingUntil = 0

/**
 * The Anthropic API key is a hand-written SSM SecureString, never in the
 * repo or the Lambda environment. Returns null until it exists; a miss is
 * remembered for a minute so an unconfigured stack does not call SSM on
 * every message.
 */
export async function getAnthropicKey(): Promise<string | null> {
  if (cachedKey) return cachedKey
  if (Date.now() < missingUntil) return null
  try {
    const res = await ssm.send(
      new GetParameterCommand({
        Name: `${prefix}/anthropic-api-key`,
        WithDecryption: true,
      }),
    )
    const value = res.Parameter?.Value?.trim()
    if (value) {
      cachedKey = value
      return value
    }
  } catch {
    // ParameterNotFound → not configured yet
  }
  missingUntil = Date.now() + 60_000
  return null
}
