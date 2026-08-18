// TypeScript port of agent-bridge/frontend/src/lib/api.js — talks to the
// agent-bridge config/memory dashboard API (proxied at /api, see
// vite.config.ts and nginx.conf). Kept as a separate client from voiceApi.ts
// deliberately: these two are different backends and must never be confused.

const BASE = '/api'

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const opts: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  }
  if (body !== undefined) opts.body = JSON.stringify(body)
  const res = await fetch(BASE + path, opts)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  if (res.status === 204) return null as T
  return res.json() as Promise<T>
}

// Loosely typed for now (see client/README migration note) — tighten these
// to mirror agent-bridge/backend/models/schemas.py as pages are migrated.
export type AppConfig = Record<string, any>
export type ChannelMapping = Record<string, any>

export const configApi = {
  // Config
  getConfig: () => req<AppConfig>('GET', '/config'),
  saveConfig: (cfg: AppConfig) => req<AppConfig>('PUT', '/config', cfg),
  exportConfig: () => req<any>('GET', '/config/export'),
  testConnection: (body: any) => req<any>('POST', '/config/test-connection', body),

  // Platforms
  getCommPlatforms: () => req<any[]>('GET', '/platforms/comm'),
  getPMPlatforms: () => req<any[]>('GET', '/platforms/pm'),

  // Channels
  getChannels: () => req<ChannelMapping[]>('GET', '/channels'),
  createChannel: (body: ChannelMapping) => req<ChannelMapping>('POST', '/channels', body),
  updateChannel: (id: string, b: ChannelMapping) => req<ChannelMapping>('PUT', `/channels/${id}`, b),
  deleteChannel: (id: string) => req<null>('DELETE', `/channels/${id}`),

  // Status
  getStatus: () => req<any>('GET', '/status'),

  // Logs
  getLogs: (limit = 200) => req<any[]>('GET', `/logs?limit=${limit}`),
  clearLogs: () => req<null>('DELETE', '/logs'),
}

export default configApi

// Back-compat alias — the ported agent-bridge pages (moved from
// agent-bridge/frontend/src/pages/*.jsx) all import `{ api }`. Keeping this
// alias avoids touching every page's import line for the initial merge;
// new code should prefer `configApi` for clarity against `voiceApi`.
export { configApi as api }
