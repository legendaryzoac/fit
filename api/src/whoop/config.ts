import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm'

const ssm = new SSMClient({})
const prefix = process.env.WHOOP_SSM_PREFIX ?? '/fit/whoop'

export interface WhoopCredentials {
  clientId: string
  clientSecret: string
}

let cached: WhoopCredentials | null = null

/**
 * Client id/secret live in SSM SecureString parameters, written by hand —
 * never in the repo or the Lambda environment. Returns null until they exist.
 */
export async function getWhoopCredentials(): Promise<WhoopCredentials | null> {
  if (cached) return cached
  try {
    const [id, secret] = await Promise.all([
      ssm.send(
        new GetParameterCommand({
          Name: `${prefix}/client-id`,
          WithDecryption: true,
        }),
      ),
      ssm.send(
        new GetParameterCommand({
          Name: `${prefix}/client-secret`,
          WithDecryption: true,
        }),
      ),
    ])
    if (!id.Parameter?.Value || !secret.Parameter?.Value) return null
    cached = {
      clientId: id.Parameter.Value,
      clientSecret: secret.Parameter.Value,
    }
    return cached
  } catch {
    return null // ParameterNotFound → not configured yet
  }
}
