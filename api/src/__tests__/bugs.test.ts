import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb'
import type { LambdaFunctionURLEvent } from 'aws-lambda'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// No AWS and no network: the table, SSM and fetch are all stubbed.
const send = vi.fn()
vi.mock('../db', () => ({ TABLE_NAME: 'test', ddb: { send: (c: unknown) => send(c) } }))
const ssmSend = vi.fn()
vi.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: class {
    send = (c: unknown) => ssmSend(c)
  },
  GetParameterCommand: class {
    input: unknown
    constructor(input: unknown) {
      this.input = input
    }
  },
}))

const { handleBugReport, sanitizeReport, issueBody } = await import('../bugs')

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const event = (body: unknown): LambdaFunctionURLEvent =>
  ({ body: JSON.stringify(body), isBase64Encoded: false }) as LambdaFunctionURLEvent

const valid = {
  title: 'Timer skipped\nthe last rest',
  kind: 'crash',
  area: 'timer',
  what: 'It jumped to cool-down. Ping @someone',
  steps: '1. Start\n2. Wait',
  email: 'a@b.co',
  context: { Version: 'abc1234', Browser: 'Safari | iOS' },
}

beforeEach(() => {
  send.mockReset().mockResolvedValue({})
  ssmSend.mockReset().mockResolvedValue({ Parameter: { Value: 'ghp_test' } })
  fetchMock.mockReset()
})

describe('sanitizeReport', () => {
  it('requires a summary and what happened', () => {
    expect(sanitizeReport({ what: 'x' }).ok).toBe(false)
    expect(sanitizeReport({ title: 'x' }).ok).toBe(false)
  })

  it('folds unknown choices into other and keeps titles on one line', () => {
    const r = sanitizeReport({ ...valid, kind: 'nope', area: '__proto__' })
    if (!r.ok) throw new Error(r.error)
    expect(r.report.kind).toBe('other')
    expect(r.report.area).toBe('other')
    expect(r.report.title).toBe('Timer skipped the last rest')
  })

  it('drops a malformed email', () => {
    const r = sanitizeReport({ ...valid, email: 'not an email' })
    if (!r.ok) throw new Error(r.error)
    expect(r.report.email).toBeUndefined()
  })
})

describe('issueBody', () => {
  it('defangs mentions and escapes table pipes', () => {
    const r = sanitizeReport(valid)
    if (!r.ok) throw new Error(r.error)
    const body = issueBody(r.report, 'ref12345')
    expect(body).not.toMatch(/@someone/)
    expect(body).toContain('@​someone')
    expect(body).toContain('Safari \\| iOS')
    expect(body).toContain('**Area:** Interval timer')
    expect(body).toContain('_Not given_') // expected + extra left blank
  })
})

describe('handleBugReport', () => {
  it('files an issue with labels and returns its number', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ number: 7, html_url: 'https://x/7' }), { status: 201 }),
    )
    const res = await handleBugReport('user-1', event(valid))
    expect(res).toMatchObject({ statusCode: 201 })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.github.com/repos/legendaryzoac/fit/issues')
    const sent = JSON.parse(init.body)
    expect(sent.title).toBe('[Bug] Timer skipped the last rest')
    expect(sent.labels).toEqual(['bug', 'user-report', 'area: timer'])
  })

  it('retries without labels on a 422', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('{}', { status: 422 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ number: 8, html_url: 'u' }), { status: 201 }),
      )
    const res = await handleBugReport('user-1', event(valid))
    expect(res).toMatchObject({ statusCode: 201 })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).labels).toBeUndefined()
  })

  it('answers 429 once the daily limit is spent', async () => {
    send.mockRejectedValue(
      new ConditionalCheckFailedException({ message: 'no', $metadata: {} }),
    )
    const res = await handleBugReport('user-1', event(valid))
    expect(res).toMatchObject({ statusCode: 429 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects an incomplete report before touching GitHub', async () => {
    const res = await handleBugReport('user-1', event({ title: 'x' }))
    expect(res).toMatchObject({ statusCode: 400 })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
