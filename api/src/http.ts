import type { LambdaFunctionURLResult } from 'aws-lambda'

export function json(
  statusCode: number,
  body: unknown,
): LambdaFunctionURLResult {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }
}

export function redirect(location: string): LambdaFunctionURLResult {
  return { statusCode: 302, headers: { location }, body: '' }
}
