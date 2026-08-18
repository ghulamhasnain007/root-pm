import { createContext, useContext, useReducer, useEffect, useCallback } from 'react'
import { api } from '../lib/configApi'

// ── Default config ─────────────────────────────────────────────────────────
const DEFAULT = {
  comm_platform: 'discord',
  pm_platform:   'taiga',
  discord:  { bot_token: '', trigger_role: 'FYP' },
  taiga:    { url: '', username: '', password: '' },
  llm: {
    gemini_api_key:   '',
    agent_model:      'gemini-1.5-pro',
    classifier_model: 'gemini-1.5-flash',
  },
  advanced: {
    max_iterations:    8,
    context_cache_ttl: 60,
    memory_max_tokens: 2000,
  },
  channel_mappings: [],
  role_permissions: [
    { id: 'r1', role_name: 'Project Manager', tier: 'admin' },
    { id: 'r2', role_name: 'Developer',        tier: 'write' },
    { id: 'r3', role_name: 'Intern',            tier: 'read'  },
  ],
}

function load() {
  try {
    const raw = localStorage.getItem('ab_config')
    return raw ? { ...DEFAULT, ...JSON.parse(raw) } : DEFAULT
  } catch { return DEFAULT }
}

// ── Reducer ────────────────────────────────────────────────────────────────
function reducer(state, action) {
  switch (action.type) {
    case 'SET_ALL':    return { ...action.payload }
    case 'SET_FIELD':  return { ...state, [action.key]: action.value }
    case 'SET_NESTED': return {
      ...state,
      [action.section]: { ...state[action.section], [action.key]: action.value }
    }
    default: return state
  }
}

// ── Context ────────────────────────────────────────────────────────────────
// Loosely typed (see client/README migration note) — the config shape
// mirrors agent-bridge/backend/models/schemas.py's AppConfig; typing it
// properly is follow-up work, not blocking for this merge.
const Ctx = createContext<any>(null)

export function ConfigProvider({ children }) {
  const [config, dispatch] = useReducer(reducer, null, load)
  const [loading, setLoading]   = [false, () => {}]  // placeholder
  const [backendOk, setBackendOk] = [true, () => {}]

  // Persist to localStorage on every change
  useEffect(() => {
    localStorage.setItem('ab_config', JSON.stringify(config))
  }, [config])

  // Try to sync with backend on mount
  useEffect(() => {
    api.getConfig()
      .then(data => dispatch({ type: 'SET_ALL', payload: data }))
      .catch(() => {/* backend offline — use local */})
  }, [])

  const setField = useCallback((key, value) =>
    dispatch({ type: 'SET_FIELD', key, value }), [])

  const setNested = useCallback((section, key, value) =>
    dispatch({ type: 'SET_NESTED', section, key, value }), [])

  const setAll = useCallback((cfg) =>
    dispatch({ type: 'SET_ALL', payload: cfg }), [])

  const save = useCallback(async () => {
    try {
      const saved = await api.saveConfig(config)
      dispatch({ type: 'SET_ALL', payload: saved })
      return { ok: true }
    } catch {
      // Backend offline — already saved to localStorage
      return { ok: true, local: true }
    }
  }, [config])

  // Computed readiness flags
  const flags = {
    discord: config.discord?.bot_token?.length > 10,
    taiga:   !!(config.taiga?.url && config.taiga?.username && config.taiga?.password),
    llm:     config.llm?.gemini_api_key?.length > 10,
    channels: config.channel_mappings?.length > 0,
    roles:    config.role_permissions?.length > 0,
  }
  const readyCount = Object.values(flags).filter(Boolean).length
  const systemStatus =
    readyCount === 5 ? 'ready' :
    readyCount > 0   ? 'partial' : 'unconfigured'

  return (
    <Ctx.Provider value={{ config, setField, setNested, setAll, save, flags, systemStatus }}>
      {children}
    </Ctx.Provider>
  )
}

export const useConfig = () => {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useConfig must be inside ConfigProvider')
  return ctx
}
