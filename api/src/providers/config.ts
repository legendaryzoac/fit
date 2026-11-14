import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm'
import type { Credentials, StrapProvider } from './types'

const ssm = new SSMClient({})

const found = new Map<string, Credentials>()
const missingUntil = new Map<string, number>()

/**
 * Client id/secret live in SSM SecureString parameters, written by hand —
 * never in the repo or the Lambda environment. Returns null until they
 * exist. A miss is remembered for a minute so /api/me, which asks about
 * every band, does not hit SSM for an unconfigured one on each request.
 */
export async function getCredentials(
  provider: Pick<StrapProvider, 'ssmPrefix'>,
): Promise<Credentials | null> {
  const prefix = provider.ssmPrefix
  const cached = found.get(prefix)
  if (cached) return cached
  if ((missingUntil.get(prefix) ?? 0) > Date.now()) return null
  try {
    const [id, secret] = await Promise.all(
      ['client-id', 'client-secret'].map((name) =>
        ssm.send(
          new GetParameterCommand({ Name: `${prefix}/${name}`, WithDecryption: true }),
        ),
      ),
    )
    if (!id.Parameter?.Value || !secret.Parameter?.Value) throw new Error('empty')
    const creds = { clientId: id.Parameter.Value, clientSecret: secret.Parameter.Value }
    found.set(prefix, creds)
    return creds
  } catch {
    missingUntil.set(prefix, Date.now() + 60_000)
    return null // ParameterNotFound → not configured yet
  }
}
