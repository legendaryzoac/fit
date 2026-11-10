// POST /api/agent — one model call for the coach. The browser owns the
// conversation and runs the tools (the athlete's data and the progression
// engine live there), so this stays a thin, stateless relay that pins the
// things a client must not choose: the model, the system prompt, the tool
// list, the output cap and a per-account daily budget.

import { createHash } from 'node:crypto'
import Anthropic from '@anthropic-ai/sdk'
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb'
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import type {
  LambdaFunctionURLEvent,
  LambdaFunctionURLResult,
} from 'aws-lambda'
import { TABLE_NAME, ddb } from '../db'
import { json } from '../http'
import {
  AGENT_DAILY_CALLS,
  AGENT_DAILY_INPUT_TOKENS,
  AGENT_EFFORT,
  AGENT_MODEL,
  AGENT_STRICT_TOOLS,
  forgetAnthropicKey,
  getAnthropicKey,
} from './config'
import { sanitizeMessages } from './messages'
import { SYSTEM_PROMPT } from './prompt'
import { agentTools } from './tools'

/** Room for adaptive thinking plus a full block proposal; well under the
 * size where a non-streaming request risks an HTTP timeout. */
const MAX_TOKENS = 6000

const TOOLS = agentTools(AGENT_STRICT_TOOLS)

/** Identifies the cached prefix. Logged with each call so a drop in cache
 * reads can be tied to the deploy that changed the prompt or the tools. */
const PROMPT_VERSION = createHash('sha256')
  .update(AGENT_MODEL)
  .update(SYSTEM_PROMPT)
  .update(JSON.stringify(TOOLS))
  .digest('hex')
  .slice(0, 12)

let client: Anthropic | null = null
let clientKey = ''

function clientFor(apiKey: string): Anthropic {
  if (!client || clientKey !== apiKey) {
    // One attempt, bounded under the function's 60 s. The SDK's own retry
    // would sleep for whatever retry-after the API names, with no ceiling,
    // and a slow reply would be regenerated from scratch; the browser
    // retries once or falls back to its built-in coach instead.
    client = new Anthropic({ apiKey, timeout: 50_000, maxRetries: 0 })
    clientKey = apiKey
  }
  return client
}

const usageKey = (userId: string, day: string) => ({
  pk: `USER#${userId}`,
  sk: `AGENTUSE#${day}`,
})

const today = () => new Date().toISOString().slice(0, 10)

/** Counts the call against today's budget; false when the budget is spent. */
async function spendCall(userId: string): Promise<boolean> {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: usageKey(userId, today()),
        UpdateExpression:
          'ADD #calls :one SET #type = if_not_exists(#type, :type), #ttl = if_not_exists(#ttl, :ttl)',
        ConditionExpression:
          '(attribute_not_exists(#calls) OR #calls < :max) AND ' +
          '(attribute_not_exists(inputTokens) OR inputTokens < :maxIn)',
        // Placeholders throughout: type and ttl are reserved words, and
        // nothing is lost by not betting on calls staying off that list
        ExpressionAttributeNames: {
          '#calls': 'calls',
          '#type': 'type',
          '#ttl': 'ttl',
        },
        ExpressionAttributeValues: {
          ':one': 1,
          ':max': AGENT_DAILY_CALLS,
          ':maxIn': AGENT_DAILY_INPUT_TOKENS,
          ':type': 'agentUsage',
          // The table expires rows by this attribute; keep a month of history
          ':ttl': Math.floor(Date.now() / 1000) + 35 * 86_400,
        },
      }),
    )
    return true
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return false
    throw err
  }
}

/** Token totals per day, for the bill. Best effort: never fails a reply. */
async function recordUsage(
  userId: string,
  usage: Anthropic.Usage,
): Promise<void> {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: usageKey(userId, today()),
        UpdateExpression:
          'ADD inputTokens :i, outputTokens :o, cacheReadTokens :r, cacheWriteTokens :w',
        ExpressionAttributeValues: {
          ':i': usage.input_tokens,
          ':o': usage.output_tokens,
          ':r': usage.cache_read_input_tokens ?? 0,
          ':w': usage.cache_creation_input_tokens ?? 0,
        },
      }),
    )
  } catch (err) {
    console.warn('agent usage not recorded', err)
  }
}

async function callsToday(userId: string): Promise<number> {
  const res = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: usageKey(userId, today()) }),
  )
  return typeof res.Item?.calls === 'number' ? res.Item.calls : 0
}

/** GET /api/agent — is the live coach configured, and what is left today. */
export async function handleAgentStatus(
  userId: string,
): Promise<LambdaFunctionURLResult> {
  const [key, used] = await Promise.all([getAnthropicKey(), callsToday(userId)])
  return json(200, {
    available: key !== null,
    model: AGENT_MODEL,
    remaining: Math.max(0, AGENT_DAILY_CALLS - used),
  })
}

export async function handleAgent(
  userId: string,
  event: LambdaFunctionURLEvent,
): Promise<LambdaFunctionURLResult> {
  let parsed: unknown
  try {
    const body = event.isBase64Encoded
      ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
      : (event.body ?? '')
    parsed = JSON.parse(body)
  } catch {
    return json(400, { error: 'invalid JSON' })
  }
  const clean = sanitizeMessages(
    (parsed as { messages?: unknown } | null)?.messages,
  )
  if (!clean.ok) return json(400, { error: clean.error })

  const apiKey = await getAnthropicKey()
  // The browser falls back to its built-in coach on 503
  if (!apiKey) return json(503, { error: 'coach not configured' })

  if (!(await spendCall(userId))) {
    return json(429, { error: 'daily coach limit reached' })
  }

  const started = Date.now()
  let response: Anthropic.Message
  try {
    response = await clientFor(apiKey).messages.create({
      model: AGENT_MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: 'adaptive' },
      output_config: { effort: AGENT_EFFORT },
      // One breakpoint on the last system block caches tools + system: the
      // whole stable prefix. The conversation after it is small and ends in
      // a fresh state snapshot, so it is left uncached.
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: TOOLS,
      messages: clean.messages,
    })
  } catch (err) {
    if (err instanceof Anthropic.BadRequestError) {
      console.error('agent bad request', PROMPT_VERSION, err.message)
      // Mid tool loop the browser replays the model's own blocks, and a
      // 400 can mean the API will not take them back: 409 tells it to stop
      // the loop. A plain-text conversation cannot be at fault, so a 400
      // there is this deployment's request (a schema, a model override):
      // answer like any other outage and let the built-in coach take over.
      const replayed = clean.messages.some(
        (m) => m.role === 'assistant' && Array.isArray(m.content),
      )
      return replayed
        ? json(409, { error: 'conversation rejected' })
        : json(503, { error: 'coach misconfigured' })
    }
    if (
      err instanceof Anthropic.AuthenticationError ||
      err instanceof Anthropic.PermissionDeniedError
    ) {
      console.error('agent credentials rejected', err.status)
      forgetAnthropicKey()
      return json(503, { error: 'coach not configured' })
    }
    if (err instanceof Anthropic.RateLimitError) {
      return json(503, { error: 'coach is busy', retry: true })
    }
    if (err instanceof Anthropic.APIConnectionError) {
      return json(504, { error: 'coach timed out', retry: true })
    }
    if (err instanceof Anthropic.APIError) {
      console.error('agent upstream error', err.status, err.message)
      return json(502, { error: 'coach unavailable', retry: true })
    }
    throw err
  }

  await recordUsage(userId, response.usage)
  console.log(
    JSON.stringify({
      at: 'agent',
      v: PROMPT_VERSION,
      model: response.model,
      stop: response.stop_reason,
      ms: Date.now() - started,
      in: response.usage.input_tokens,
      out: response.usage.output_tokens,
      cacheRead: response.usage.cache_read_input_tokens ?? 0,
      cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
    }),
  )

  // A safety decline carries no usable content; the browser words it.
  if (response.stop_reason === 'refusal') {
    return json(200, { content: [], stopReason: 'refusal' })
  }

  // Only the blocks the browser knows how to replay: text, tool calls, and
  // thinking (returned so a tool loop can send it back unmodified).
  const content = response.content.filter(
    (b) =>
      b.type === 'text' ||
      b.type === 'tool_use' ||
      b.type === 'thinking' ||
      b.type === 'redacted_thinking',
  )
  return json(200, { content, stopReason: response.stop_reason })
}
