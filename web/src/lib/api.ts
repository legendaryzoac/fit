export interface Api {
  get: (path: string) => Promise<Response>
  send: (method: 'POST' | 'DELETE', path: string, body?: unknown) => Promise<Response>
}

export function makeApi(getToken: () => Promise<string | null>): Api {
  // Refresh per request: a token captured at app start expires mid-session,
  // so the queued save would POST with a dead token. getToken() returns a
  // fresh one; when it's null (offline — refresh needs network) fall back to
  // the last known token so the request still fails with a retryable network
  // error rather than never firing.
  let lastToken: string | null = null
  // Not `Authorization`: CloudFront's OAC signing overwrites that header
  const authHeader = async (): Promise<Record<string, string>> => {
    lastToken = (await getToken()) ?? lastToken
    return { 'x-authorization': `Bearer ${lastToken}` }
  }
  return {
    get: async (path) => fetch(path, { headers: await authHeader() }),
    send: async (method, path, body) => {
      const payload = body === undefined ? '' : JSON.stringify(body)
      const headers: Record<string, string> = { ...(await authHeader()) }
      if (payload) {
        headers['content-type'] = 'application/json'
        // OAC-signed origins reject bodied requests without the payload hash
        const digest = await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(payload),
        )
        headers['x-amz-content-sha256'] = [...new Uint8Array(digest)]
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
      }
      const init: RequestInit = { method, headers }
      if (payload) init.body = payload
      return fetch(path, init)
    },
  }
}
