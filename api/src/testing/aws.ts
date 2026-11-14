// In-memory stand-ins for the AWS clients, shared by the ingestion tests.
// State hangs off globalThis so it survives vi.resetModules(): a mock
// factory that re-imports this file after a reset must see the same table
// the test is asserting on.

type Item = Record<string, any>

interface AwsState {
  items: Map<string, Item>
  rawPuts: Array<{ Bucket: string; Key: string; Body: string }>
  invokes: Array<{ FunctionName: string; InvocationType: string; payload: Item }>
  params: Map<string, string>
}

const g = globalThis as typeof globalThis & { __fitAws?: AwsState }
export const aws: AwsState = (g.__fitAws ??= {
  items: new Map(),
  rawPuts: [],
  invokes: [],
  params: new Map(),
})

export function resetAws(): void {
  aws.items.clear()
  aws.rawPuts.length = 0
  aws.invokes.length = 0
  aws.params.clear()
}

const keyOf = (k: Item) => `${k.pk}|${k.sk}`
// The document client is configured with removeUndefinedValues
const clean = <T>(v: T): T => JSON.parse(JSON.stringify(v))

export function getItem(pk: string, sk: string): Item | undefined {
  return aws.items.get(keyOf({ pk, sk }))
}

export function putItem(item: Item): void {
  aws.items.set(keyOf(item), clean(item))
}

export function itemsWithPrefix(pk: string, skPrefix: string): Item[] {
  return [...aws.items.values()]
    .filter((i) => i.pk === pk && (i.sk as string).startsWith(skPrefix))
    .sort((a, b) => (a.sk < b.sk ? -1 : 1))
}

async function tableSend(command: { constructor: { name: string }; input: Item }): Promise<Item> {
  const input = command.input
  switch (command.constructor.name) {
    case 'GetCommand':
      return { Item: aws.items.get(keyOf(input.Key)) }
    case 'PutCommand':
      putItem(input.Item)
      return {}
    case 'DeleteCommand':
      aws.items.delete(keyOf(input.Key))
      return {}
    case 'UpdateCommand': {
      const expr = input.UpdateExpression as string
      if (!expr.startsWith('SET ')) throw new Error(`fake table: unsupported update ${expr}`)
      const item = { ...(aws.items.get(keyOf(input.Key)) ?? input.Key) }
      for (const part of expr.slice(4).split(',')) {
        const [name, value] = part.split('=').map((s) => s.trim())
        const attr = input.ExpressionAttributeNames?.[name] ?? name
        item[attr] = input.ExpressionAttributeValues[value]
      }
      putItem(item)
      return {}
    }
    case 'QueryCommand': {
      const values = input.ExpressionAttributeValues as Item
      const expr = (input.KeyConditionExpression as string).replace(/\s+/g, ' ')
      const all = [...aws.items.values()]
      if (input.IndexName === 'gsi1' && expr === 'gsi1pk = :p') {
        // KEYS_ONLY projection
        return {
          Items: all
            .filter((i) => i.gsi1pk === values[':p'])
            .map(({ pk, sk, gsi1pk, gsi1sk }) => ({ pk, sk, gsi1pk, gsi1sk })),
        }
      }
      if (expr === 'pk = :pk AND sk BETWEEN :from AND :to') {
        return {
          Items: all
            .filter(
              (i) => i.pk === values[':pk'] && i.sk >= values[':from'] && i.sk <= values[':to'],
            )
            .sort((a, b) => (a.sk < b.sk ? -1 : 1)),
        }
      }
      throw new Error(`fake table: unsupported query ${expr}`)
    }
    default:
      throw new Error(`fake table: unsupported command ${command.constructor.name}`)
  }
}

class Command {
  input: Item
  constructor(input: Item) {
    this.input = input
  }
}

// ---- vi.mock factories ----

export const dbMock = () => ({
  TABLE_NAME: 'test',
  ddb: { send: (c: Parameters<typeof tableSend>[0]) => tableSend(c) },
})

export const s3Mock = () => ({
  S3Client: class {
    async send(c: Command) {
      aws.rawPuts.push(c.input as AwsState['rawPuts'][number])
      return {}
    }
  },
  PutObjectCommand: class extends Command {},
})

export const lambdaMock = () => ({
  LambdaClient: class {
    async send(c: Command) {
      aws.invokes.push({
        FunctionName: c.input.FunctionName,
        InvocationType: c.input.InvocationType,
        payload: JSON.parse(c.input.Payload),
      })
      return {}
    }
  },
  InvokeCommand: class extends Command {},
})

export const ssmMock = () => ({
  SSMClient: class {
    async send(c: Command) {
      const value = aws.params.get(c.input.Name)
      if (value === undefined) throw new Error('ParameterNotFound')
      return { Parameter: { Value: value } }
    }
  },
  GetParameterCommand: class extends Command {},
})

/** Token is the user id; "bad" fails verification. */
export const jwtMock = () => ({
  CognitoJwtVerifier: {
    create: () => ({
      verify: async (token: string) => {
        if (token === 'bad') throw new Error('invalid')
        return { sub: token }
      },
    }),
  },
})

// ---- request helpers ----

export function apiEvent(
  method: string,
  path: string,
  opts: { user?: string; query?: Record<string, string>; body?: unknown; headers?: Record<string, string> } = {},
): any {
  return {
    rawPath: path,
    requestContext: { http: { method } },
    headers: {
      ...(opts.user && { 'x-authorization': `Bearer ${opts.user}` }),
      ...opts.headers,
    },
    queryStringParameters: opts.query,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    isBase64Encoded: false,
  }
}

export interface Result {
  statusCode: number
  headers: Record<string, string>
  body: string
}

export const asResult = (res: unknown): Result => res as Result
export const bodyOf = (res: unknown): any => JSON.parse(asResult(res).body || '{}')

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}
