export interface Api {
  get: (path: string) => Promise<Response>
  send: (method: 'POST' | 'DELETE', path: string, body?: unknown) => Promise<Response>
}

export function makeApi(token: string): Api {
  // Not `Authorization`: CloudFront's OAC signing overwrites that header
  const auth = { 'x-authorization': `Bearer ${token}` }
  return {
    get: (path) => fetch(path, { headers: auth }),
    send: async (method, path, body) => {
      const payload = body === undefined ? '' : JSON.stringify(body)
      const headers: Record<string, string> = { ...auth }
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
