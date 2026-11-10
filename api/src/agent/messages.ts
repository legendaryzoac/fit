// The browser sends the conversation; this rebuilds it block by block so
// only the shapes the coach needs ever reach the model. Nothing a client
// adds (cache markers, images, documents, server-tool blocks, extra keys)
// survives. The size caps sit a little above the largest request the app
// itself builds (a state block, a dozen short turns, one long lookup) and
// keep a padded request under the 100K-token mark where the model's rate
// card steps up; the per-day token budget in the handler bounds the rest.

import type Anthropic from '@anthropic-ai/sdk'

const MAX_MESSAGES = 40
const MAX_BLOCKS = 40
const MAX_TEXT = 40_000
const MAX_TOTAL = 80_000

export type Sanitized =
  | { ok: true; messages: Anthropic.MessageParam[] }
  | { ok: false; error: string }

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isText = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= MAX_TEXT

function toolResultContent(
  v: unknown,
): string | Anthropic.TextBlockParam[] | null {
  if (typeof v === 'string') return v.length <= MAX_TEXT ? v : null
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_BLOCKS) return null
  const out: Anthropic.TextBlockParam[] = []
  for (const b of v) {
    if (!isObject(b) || b.type !== 'text' || !isText(b.text)) return null
    out.push({ type: 'text', text: b.text })
  }
  return out
}

function userBlock(b: unknown): Anthropic.ContentBlockParam | null {
  if (!isObject(b)) return null
  if (b.type === 'text') {
    return isText(b.text) ? { type: 'text', text: b.text } : null
  }
  if (b.type === 'tool_result') {
    if (typeof b.tool_use_id !== 'string' || !b.tool_use_id) return null
    const content = toolResultContent(b.content)
    if (content === null) return null
    return {
      type: 'tool_result',
      tool_use_id: b.tool_use_id,
      content,
      ...(b.is_error === true && { is_error: true }),
    }
  }
  return null
}

function assistantBlock(b: unknown): Anthropic.ContentBlockParam | null {
  if (!isObject(b)) return null
  if (b.type === 'text') {
    return isText(b.text) ? { type: 'text', text: b.text } : null
  }
  if (b.type === 'tool_use') {
    if (typeof b.id !== 'string' || !b.id) return null
    if (typeof b.name !== 'string' || !b.name) return null
    if (!isObject(b.input)) return null
    return { type: 'tool_use', id: b.id, name: b.name, input: b.input }
  }
  // Thinking blocks go back exactly as they came: the signature covers the
  // text, and an empty text is normal (display defaults to omitted).
  if (b.type === 'thinking') {
    if (typeof b.thinking !== 'string' || typeof b.signature !== 'string') {
      return null
    }
    return { type: 'thinking', thinking: b.thinking, signature: b.signature }
  }
  if (b.type === 'redacted_thinking') {
    return typeof b.data === 'string'
      ? { type: 'redacted_thinking', data: b.data }
      : null
  }
  return null
}

export function sanitizeMessages(raw: unknown): Sanitized {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: 'messages must be a non-empty array' }
  }
  if (raw.length > MAX_MESSAGES) {
    return { ok: false, error: 'too many messages' }
  }
  const messages: Anthropic.MessageParam[] = []
  for (const m of raw) {
    if (!isObject(m) || (m.role !== 'user' && m.role !== 'assistant')) {
      return { ok: false, error: 'bad message role' }
    }
    if (typeof m.content === 'string') {
      if (!isText(m.content)) return { ok: false, error: 'bad message text' }
      messages.push({ role: m.role, content: m.content })
      continue
    }
    if (
      !Array.isArray(m.content) ||
      m.content.length === 0 ||
      m.content.length > MAX_BLOCKS
    ) {
      return { ok: false, error: 'bad message content' }
    }
    const blocks: Anthropic.ContentBlockParam[] = []
    for (const b of m.content) {
      const clean = m.role === 'user' ? userBlock(b) : assistantBlock(b)
      if (!clean) return { ok: false, error: `bad ${m.role} block` }
      blocks.push(clean)
    }
    messages.push({ role: m.role, content: blocks })
  }
  if (messages[0].role !== 'user' || messages.at(-1)!.role !== 'user') {
    return { ok: false, error: 'conversation must start and end with the user' }
  }
  if (JSON.stringify(messages).length > MAX_TOTAL) {
    return { ok: false, error: 'conversation too long' }
  }
  return { ok: true, messages }
}
