import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useConfig } from '../../store/ConfigContext'
import { api } from '../../lib/configApi'
import { useToast } from '../../components/ui/Toast'
import { ConfigCard, CardHeader, CardBody, PageHeader, Btn, Badge } from '../../components/ui/index'

const COMM = [
  { id: 'discord', label: 'Discord',  icon: 'brand-discord', color: '#5865F2', bg: 'rgba(88,101,242,.15)'  },
  { id: 'slack',   label: 'Slack',    icon: 'brand-slack',   color: '#4A154B', bg: 'rgba(74,21,75,.15)'    },
  { id: 'teams',   label: 'Teams',    icon: 'brand-teams',   color: '#6264A7', bg: 'rgba(98,100,167,.15)'  },
]
const PM = [
  { id: 'taiga',  label: 'Taiga',  icon: 'leaf',       color: '#10B981', bg: 'rgba(16,185,129,.15)' },
  { id: 'jira',   label: 'Jira',   icon: 'brand-jira', color: '#0052CC', bg: 'rgba(0,82,204,.15)'   },
  { id: 'linear', label: 'Linear', icon: 'line',       color: '#5E6AD2', bg: 'rgba(94,106,210,.15)' },
]

function BridgeViz({ comm, pm, active }) {
  const cp = COMM.find(p => p.id === comm) || COMM[0]
  const pp = PM.find(p => p.id === pm) || PM[0]
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setTick(n => n + 1), 50)
    return () => clearInterval(t)
  }, [active])

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0, padding: '28px 0 20px' }}>
      {/* Comm platform pill */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 20px', borderRadius: 10,
        background: 'var(--c-raised)', border: '1px solid var(--c-border2)',
        minWidth: 150, justifyContent: 'center',
        boxShadow: active ? `0 0 20px ${cp.color}22` : 'none',
        transition: 'box-shadow .5s',
      }}>
        <div style={{ width: 30, height: 30, borderRadius: 7, background: cp.bg, display: 'grid', placeItems: 'center' }}>
          <i className={`ti ti-${cp.icon}`} style={{ color: cp.color, fontSize: 16 }} />
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{cp.label}</div>
          <div style={{ fontSize: 10, color: 'var(--t-lo)' }}>Communication</div>
        </div>
      </div>

      {/* Animated connector */}
      <div style={{ flex: 1, maxWidth: 160, height: 40, position: 'relative', margin: '0 -1px' }}>
        <svg width="100%" height="40" viewBox="0 0 160 40" style={{ overflow: 'visible' }}>
          <defs>
            <linearGradient id="bridgeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={cp.color} />
              <stop offset="100%" stopColor={pp.color} />
            </linearGradient>
          </defs>
          {/* Track line */}
          <line x1="0" y1="20" x2="160" y2="20" stroke="var(--c-border2)" strokeWidth="1.5" />
          {/* Active gradient line */}
          {active && (
            <line x1="0" y1="20" x2="160" y2="20" stroke="url(#bridgeGrad)" strokeWidth="1.5" opacity="0.6" />
          )}
          {/* Travelling packets */}
          {active && [0, 1, 2].map(i => {
            const pos = ((tick / 40 + i / 3) % 1)
            return (
              <circle key={i} cx={pos * 160} cy="20" r="3.5"
                fill={pos < 0.5 ? cp.color : pp.color}
                opacity={Math.sin(pos * Math.PI) * 0.9 + 0.1}
              />
            )
          })}
          {/* Arrow tip */}
          <polygon points="155,15 160,20 155,25" fill={pp.color} opacity={active ? 1 : 0.3} />
        </svg>
        {/* Label */}
        {active && (
          <div style={{
            position: 'absolute', top: -14, left: '50%', transform: 'translateX(-50%)',
            fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--t-lo)',
            whiteSpace: 'nowrap', letterSpacing: '.04em',
          }}>
            LIVE
          </div>
        )}
      </div>

      {/* PM platform pill */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 20px', borderRadius: 10,
        background: 'var(--c-raised)', border: '1px solid var(--c-border2)',
        minWidth: 150, justifyContent: 'center',
        boxShadow: active ? `0 0 20px ${pp.color}22` : 'none',
        transition: 'box-shadow .5s',
      }}>
        <div style={{ width: 30, height: 30, borderRadius: 7, background: pp.bg, display: 'grid', placeItems: 'center' }}>
          <i className={`ti ti-${pp.icon}`} style={{ color: pp.color, fontSize: 16 }} />
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{pp.label}</div>
          <div style={{ fontSize: 10, color: 'var(--t-lo)' }}>Project management</div>
        </div>
      </div>
    </div>
  )
}

function StatCard({ value, label, icon, color = 'var(--c-blue)' }) {
  return (
    <div style={{
      background: 'var(--c-base)', border: '1px solid var(--c-border)',
      borderRadius: 'var(--r-xl)', padding: '18px 20px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ width: 34, height: 34, borderRadius: 8, background: `${color}18`, display: 'grid', placeItems: 'center' }}>
          <i className={`ti ti-${icon}`} style={{ color, fontSize: 17 }} />
        </div>
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-.04em', fontVariantNumeric: 'tabular-nums', color: 'var(--t-hi)' }}>
        {value}
      </div>
      <div style={{ fontSize: 12, color: 'var(--t-mid)', marginTop: 3 }}>{label}</div>
    </div>
  )
}

export default function OverviewPage() {
  const { config, systemStatus, flags } = useConfig()
  const toast = useToast()
  const navigate = useNavigate()
  const [exporting, setExporting] = useState(false)

  const checks = [
    { label: 'Discord credentials', ok: flags.discord, detail: flags.discord ? 'Bot token configured' : 'Bot token missing', action: '/platforms' },
    { label: 'Taiga credentials',   ok: flags.taiga,   detail: flags.taiga   ? 'URL & credentials set' : 'Taiga URL, username or password missing', action: '/platforms' },
    { label: 'Gemini API key',      ok: flags.llm,     detail: flags.llm     ? 'API key is set' : 'API key missing', action: '/llm' },
    { label: 'Channel mappings',    ok: flags.channels, detail: `${config.channel_mappings?.length || 0} mapping(s) configured`, action: '/channels' },
    { label: 'Role permissions',    ok: flags.roles,   detail: `${config.role_permissions?.length || 0} role(s) defined`, action: '/permissions' },
  ]

  const readyCount = checks.filter(c => c.ok).length
  const uptime = '—'

  const handleExport = async () => {
    setExporting(true)
    try {
      let data
      try { data = await api.exportConfig() } catch {
        const channelMap = {}
        ;(config.channel_mappings || []).forEach(m => {
          if (m.guild_id && m.channel_id && m.project_slug) {
            if (!channelMap[m.guild_id]) channelMap[m.guild_id] = {}
            channelMap[m.guild_id][m.channel_id] = m.project_slug
          }
        })
        const rolePerms = {}
        ;(config.role_permissions || []).forEach(r => { if (r.role_name) rolePerms[r.role_name] = r.tier })
        data = {
          communication: { platform: config.comm_platform, config: { bot_token: '$DISCORD_TOKEN', trigger_role: config.discord.trigger_role, channel_map: channelMap, role_permissions: rolePerms } },
          project_management: { platform: config.pm_platform, config: { url: '$TAIGA_URL', username: '$TAIGA_USER', password: '$TAIGA_PASS' } },
          llm: { gemini_api_key: '$GEMINI_API_KEY', agent_model: config.llm.agent_model, classifier_model: config.llm.classifier_model },
          advanced: config.advanced,
        }
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'config.json'; a.click()
      toast('config.json exported successfully')
    } catch { toast('Export failed', 'error') }
    finally { setExporting(false) }
  }

  return (
    <div>
      <PageHeader
        title="Overview"
        description="System health and live connection status."
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn variant="ghost" onClick={() => navigate('/platforms')}>
              <i className="ti ti-settings" />Configure
            </Btn>
            <Btn variant="primary" onClick={handleExport} loading={exporting}>
              <i className="ti ti-download" />Export config
            </Btn>
          </div>
        }
      />

      {/* Bridge visual */}
      <ConfigCard>
        <CardHeader>
          <i className="ti ti-transfer" style={{ color: 'var(--c-blue)' }} />
          Bridge connection
          <Badge color={systemStatus === 'ready' ? 'green' : systemStatus === 'partial' ? 'amber' : 'red'}>
            {systemStatus}
          </Badge>
        </CardHeader>
        <CardBody>
          <BridgeViz comm={config.comm_platform} pm={config.pm_platform} active={systemStatus === 'ready'} />
        </CardBody>
      </ConfigCard>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
        <StatCard value={`${readyCount}/5`} label="Setup items complete" icon="circle-check" color="var(--c-green)" />
        <StatCard value="0" label="Messages handled today" icon="message-circle" color="var(--c-blue)" />
        <StatCard value={uptime} label="Uptime" icon="clock" color="var(--c-violet)" />
      </div>

      {/* Health checks */}
      <ConfigCard>
        <CardHeader>
          <i className="ti ti-list-check" style={{ color: 'var(--t-lo)' }} />
          Configuration checks
        </CardHeader>
        <div>
          {checks.map((c, i) => (
            <div key={i} onClick={() => navigate(c.action)} style={{
              display: 'flex', alignItems: 'center', gap: 14,
              padding: '13px 20px',
              borderBottom: i < checks.length - 1 ? '1px solid var(--c-border)' : 'none',
              cursor: 'pointer', transition: 'background .12s',
            }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--c-raised)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <i className={`ti ti-${c.ok ? 'circle-check-filled' : 'circle-x-filled'}`}
                style={{ fontSize: 19, color: c.ok ? 'var(--c-green)' : 'var(--c-red)', flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>{c.label}</div>
                <div style={{ fontSize: 12, color: 'var(--t-lo)' }}>{c.detail}</div>
              </div>
              <i className="ti ti-chevron-right" style={{ fontSize: 14, color: 'var(--t-lo)' }} />
            </div>
          ))}
        </div>
      </ConfigCard>

      {/* Launch command */}
      <ConfigCard>
        <CardHeader>
          <i className="ti ti-terminal" style={{ color: 'var(--t-lo)' }} />
          Launch command
        </CardHeader>
        <CardBody>
          <div style={{
            background: 'var(--c-void)', border: '1px solid var(--c-border)',
            borderRadius: 'var(--r)', padding: '14px 16px',
            fontFamily: 'var(--mono)', fontSize: 12,
            color: 'var(--t-mid)', lineHeight: 2,
          }}>
            <span style={{ color: '#7dd3fc' }}>python</span>{' '}
            <span>main.py</span>{' '}
            <span style={{ color: '#a78bfa' }}>--config</span>{' '}
            <span style={{ color: '#6ee7b7' }}>config/config.json</span>{' '}
            <span style={{ color: '#a78bfa' }}>--comm</span>{' '}
            <span style={{ color: '#6ee7b7' }}>{config.comm_platform}</span>{' '}
            <span style={{ color: '#a78bfa' }}>--pm</span>{' '}
            <span style={{ color: '#6ee7b7' }}>{config.pm_platform}</span>
          </div>
        </CardBody>
      </ConfigCard>
    </div>
  )
}
