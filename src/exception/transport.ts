import type { ExcTransport } from './types'

/** H5 transport：fetch + keepalive（页面卸载时仍可发出） */
export function makeH5Transport(endpoint: string): ExcTransport {
  return async (payload, projectKey) => {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Project-Key': projectKey },
      body: JSON.stringify(payload),
      keepalive: true,
    })
    if (!res.ok)
      throw Object.assign(new Error(`monitor: 上报失败 ${res.status}`), { statusCode: res.status })
  }
}
