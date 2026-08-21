import { NavLink, Outlet, useLocation, Navigate } from 'react-router-dom'
import { useConfig } from '../store/ConfigContext'
import { useAuth } from '../store/AuthContext'

const NAV = [
  // ── Agent-bridge (config dashboard) sections — unchanged ──
  { section: 'System', to: '/overview', label: 'Overview', icon: 'layout-dashboard' },
  { section: 'Setup', to: '/platforms', label: 'Platforms', icon: 'plug-connected' },
  { section: 'Setup', to: '/tools', label: 'Tools', icon: 'wrench' },
  { section: 'Setup', to: '/channels', label: 'Channel map', icon: 'map-2' },
  { section: 'Setup', to: '/permissions', label: 'Permissions', icon: 'shield-half' },
  { section: 'Agent', to: '/llm', label: 'LLM & Models', icon: 'brain' },
  { section: 'Agent', to: '/advanced', label: 'Advanced', icon: 'adjustments-horizontal' },
  { section: 'System', to: '/logs', label: 'Activity log', icon: 'activity' },
  { section: 'System', to: '/staff', label: 'Staff', icon: 'users' },
  // ── Voice bot section — new ──
  { section: 'Voice', to: '/voice/schedule', label: 'Schedule', icon: 'calendar-event' },
  { section: 'Voice', to: '/voice/ambient', label: 'Ambient', icon: 'microphone' },
  { section: 'Voice', to: '/voice/integrations', label: 'Integrations', icon: 'plug' },
]

const SECTIONS = ['System', 'Setup', 'Agent', 'Voice']

const STATUS_MAP: Record<string, { color: string; label: string }> = {
  ready: { color: 'var(--c-green)', label: 'Ready' },
  partial: { color: 'var(--c-amber)', label: 'Setup incomplete' },
  unconfigured: { color: 'var(--c-red)', label: 'Not configured' },
}

// Which nav items have readiness tied to them (config dashboard only —
// voice nav items don't currently have a readiness flag wired up).
const ITEM_FLAG: Record<string, string[]> = {
  '/platforms': ['discord', 'taiga'],
  '/channels': ['channels'],
  '/permissions': ['roles'],
  '/llm': ['llm'],
}

const BREADCRUMB_MAP: Record<string, string> = {
  '/overview': 'Overview',
  '/platforms': 'Platforms',
  '/tools': 'Tool Configuration',
  '/channels': 'Channel map',
  '/permissions': 'Permissions',
  '/llm': 'LLM & Models',
  '/advanced': 'Advanced',
  '/logs': 'Activity log',
  '/staff': 'Staff',
  '/voice/schedule': 'Voice · Schedule',
  '/voice/ambient': 'Voice · Ambient',
  '/voice/integrations': 'Voice · Integrations',
}

export default function Shell() {
  const { systemStatus, flags } = useConfig()
  const { isAuthenticated, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) return null
  if (!isAuthenticated) return <Navigate to="/login" replace />

  const sm = STATUS_MAP[systemStatus]
  const isVoiceRoute = location.pathname.startsWith('/voice')

  const readyCount = Object.values(flags).filter(Boolean).length
  const totalCount = Object.keys(flags).length
  const pct = Math.round((readyCount / totalCount) * 100)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'var(--sidebar-w) 1fr', gridTemplateRows: 'var(--topbar-h) 1fr', height: '100vh', overflow: 'hidden' }}>

      {/* ── Topbar ──────────────────────────────────────────────────────── */}
      <header style={{
        gridColumn: '1 / -1',
        background: 'var(--c-base)',
        borderBottom: '1px solid var(--c-border)',
        display: 'flex', alignItems: 'center',
        padding: '0 24px', gap: 14, zIndex: 20,
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: 'linear-gradient(135deg, var(--c-blue), var(--c-violet))',
            display: 'grid', placeItems: 'center', flexShrink: 0,
          }}>
            <i className="ti ti-circuit-switchboard" style={{ color: '#fff', fontSize: 16 }} />
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-.02em', lineHeight: 1.2 }}>
              Root-PM Console
            </div>
            <div style={{ fontSize: 10, color: 'var(--t-lo)', fontFamily: 'var(--mono)' }}>
              v1.0.0
            </div>
          </div>
        </div>

        {/* Breadcrumb */}
        <div style={{ height: 20, width: 1, background: 'var(--c-border)', margin: '0 4px' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--t-lo)' }}>
          <span>Root-PM</span>
          <i className="ti ti-chevron-right" style={{ fontSize: 12 }} />
          <span style={{ color: 'var(--t-mid)', fontWeight: 500 }}>{BREADCRUMB_MAP[location.pathname] || 'Dashboard'}</span>
        </div>

        <div style={{ flex: 1 }} />

        {/* Setup progress bar — config dashboard readiness only */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--t-lo)', whiteSpace: 'nowrap' }}>
            Setup {readyCount}/{totalCount}
          </div>
          <div style={{ width: 80, height: 4, background: 'var(--c-border2)', borderRadius: 99, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 99,
              width: `${pct}%`,
              background: pct === 100 ? 'var(--c-green)' : pct > 40 ? 'var(--c-blue)' : 'var(--c-amber)',
              transition: 'width .4s ease',
            }} />
          </div>
        </div>

        {/* Status pill */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 7,
          padding: '5px 12px', borderRadius: 99,
          background: 'var(--c-raised)', border: '1px solid var(--c-border2)',
          fontSize: 12, color: sm.color, fontWeight: 500, flexShrink: 0,
        }}>
          <span style={{
            width: 7, height: 7, borderRadius: '50%',
            background: sm.color, flexShrink: 0,
            animation: systemStatus === 'ready' ? 'statusPulse 2.5s ease infinite' : 'none',
          }} />
          {sm.label}
        </div>

        <style>{`
          @keyframes statusPulse {
            0%,100%{box-shadow:0 0 0 0 rgba(16,185,129,.5)}
            60%{box-shadow:0 0 0 6px rgba(16,185,129,0)}
          }
        `}</style>
      </header>

      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <nav style={{
        background: 'var(--c-base)',
        borderRight: '1px solid var(--c-border)',
        display: 'flex', flexDirection: 'column',
        overflowY: 'auto', padding: '12px 0',
      }}>
        {SECTIONS.map(sec => (
          <div key={sec} style={{ marginBottom: 4 }}>
            <div style={{
              fontSize: 10, fontWeight: 600, letterSpacing: '.08em',
              textTransform: 'uppercase', color: 'var(--t-lo)',
              padding: '10px 16px 4px',
            }}>
              {sec}
            </div>
            {NAV.filter(n => n.section === sec).map(n => {
              const flagKeys = ITEM_FLAG[n.to] || []
              const itemOk = flagKeys.length > 0 && flagKeys.every(k => flags[k])
              const itemPartial = flagKeys.length > 0 && flagKeys.some(k => flags[k]) && !itemOk
              return (
                <NavLink key={n.to} to={n.to}
                  style={({ isActive }) => ({
                    display: 'flex', alignItems: 'center', gap: 9,
                    padding: '7px 14px', margin: '1px 8px',
                    borderRadius: 7, fontSize: 13, fontWeight: 450,
                    textDecoration: 'none',
                    color: isActive ? 'var(--t-hi)' : 'var(--t-mid)',
                    background: isActive ? 'var(--c-active)' : 'transparent',
                    border: `1px solid ${isActive ? 'var(--c-border2)' : 'transparent'}`,
                    transition: 'all .12s',
                  })}
                >
                  {({ isActive }: { isActive: boolean }) => (<>
                    <i className={`ti ti-${n.icon}`} style={{
                      fontSize: 16, width: 18, flexShrink: 0,
                      color: isActive ? 'var(--c-blue)' : 'var(--t-lo)',
                    }} />
                    <span style={{ flex: 1 }}>{n.label}</span>
                    {flagKeys.length > 0 && (
                      <span style={{
                        width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                        background: itemOk ? 'var(--c-green)' : itemPartial ? 'var(--c-amber)' : 'var(--c-border2)',
                        transition: 'background .3s',
                      }} />
                    )}
                  </>)}
                </NavLink>
              )
            })}
          </div>
        ))}

        <div style={{ flex: 1 }} />

        {/* Sidebar footer */}
        <div style={{ padding: '12px 8px 4px', borderTop: '1px solid var(--c-border)', marginTop: 8 }}>
          <a href="/api/docs" target="_blank" rel="noreferrer"
            style={{
              display: 'flex', alignItems: 'center', gap: 9,
              padding: '7px 14px', borderRadius: 7, fontSize: 12,
              color: 'var(--t-lo)', textDecoration: 'none',
            }}
          >
            <i className="ti ti-api" style={{ fontSize: 15 }} />
            API docs
            <i className="ti ti-external-link" style={{ fontSize: 11, marginLeft: 'auto' }} />
          </a>
        </div>
      </nav>

      {/* ── Content ─────────────────────────────────────────────────────────
          Config pages get `.config-scope` (agent-bridge's CSS-var element
          resets, see index.css) and an 860px reading width, matching their
          original layout. Voice pages already manage their own width via
          Tailwind (`max-w-3xl/5xl mx-auto` inside each page's own <main>),
          so they're rendered unconstrained here to avoid double-nesting a
          width cap around their own. */}
      {isVoiceRoute ? (
        <div style={{ overflowY: 'auto', background: '#030712' /* tailwind gray-950 */ }}>
          <Outlet />
        </div>
      ) : (
        <div className="config-scope" style={{ overflowY: 'auto', padding: '32px 36px', background: 'var(--c-void)' }}>
          <div style={{ maxWidth: 860, animation: 'fadeIn .2s ease both' }}>
            <Outlet />
          </div>
        </div>
      )}
    </div>
  )
}
