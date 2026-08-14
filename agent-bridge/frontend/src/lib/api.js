const BASE = '/api'

async function req(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  }
  if (body !== undefined) opts.body = JSON.stringify(body)
  const res = await fetch(BASE + path, opts)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  if (res.status === 204) return null
  return res.json()
}

export const api = {
  // Config
  getConfig:       ()       => req('GET',    '/config'),
  saveConfig:      (cfg)    => req('PUT',    '/config', cfg),
  exportConfig:    ()       => req('GET',    '/config/export'),
  testConnection:  (body)   => req('POST',   '/config/test-connection', body),

  // Platforms
  getCommPlatforms: ()      => req('GET', '/platforms/comm'),
  getPMPlatforms:   ()      => req('GET', '/platforms/pm'),

  // Channels
  getChannels:    ()        => req('GET',    '/channels'),
  createChannel:  (body)    => req('POST',   '/channels', body),
  updateChannel:  (id, b)   => req('PUT',    `/channels/${id}`, b),
  deleteChannel:  (id)      => req('DELETE', `/channels/${id}`),

  // Status
  getStatus:  ()            => req('GET', '/status'),

  // Logs
  getLogs:    (limit = 200) => req('GET', `/logs?limit=${limit}`),
  clearLogs:  ()            => req('DELETE', '/logs'),
}

export default api
