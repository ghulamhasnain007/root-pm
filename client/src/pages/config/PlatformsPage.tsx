import { useState } from 'react'
import { useConfig } from '../../store/ConfigContext'
import { useToast } from '../../components/ui/Toast'
import { api } from '../../lib/configApi'
import { ConfigCard, CardHeader, CardBody, ConfigField, Btn, Alert, Grid2, PageHeader, Badge } from '../../components/ui/index'

const COMM_PLATFORMS = [
  { id: 'discord', label: 'Discord',  icon: 'brand-discord', color: '#5865F2', bg: 'rgba(88,101,242,.12)',  desc: '@mention & role triggers',       live: true  },
  { id: 'slack',   label: 'Slack',    icon: 'brand-slack',   color: '#4A154B', bg: 'rgba(74,21,75,.12)',    desc: 'Slash commands & app mentions',  live: false },
  { id: 'teams',   label: 'MS Teams', icon: 'brand-teams',   color: '#6264A7', bg: 'rgba(98,100,167,.12)',  desc: 'Bot Framework adaptive cards',   live: false },
  { id: 'telegram',label: 'Telegram', icon: 'brand-telegram',color: '#2AABEE', bg: 'rgba(42,171,238,.12)',  desc: 'Bot API webhook integration',    live: false },
]
const PM_PLATFORMS = [
  { id: 'taiga',  label: 'Taiga',   icon: 'leaf',        color: '#10B981', bg: 'rgba(16,185,129,.12)',  desc: 'Open-source agile PM',         live: true  },
  { id: 'jira',   label: 'Jira',    icon: 'brand-jira',  color: '#0052CC', bg: 'rgba(0,82,204,.12)',    desc: 'Atlassian issue tracker',      live: false },
  { id: 'linear', label: 'Linear',  icon: 'line',        color: '#5E6AD2', bg: 'rgba(94,106,210,.12)',  desc: 'Modern project tracking',      live: false },
  { id: 'asana',  label: 'Asana',   icon: 'brand-asana', color: '#F06A6A', bg: 'rgba(240,106,106,.12)', desc: 'Team work management',         live: false },
]

function PlatCard({ p, selected, onSelect }) {
  return (
    <div onClick={() => p.live && onSelect(p.id)}
      style={{
        position: 'relative', padding: 16, borderRadius: 10, cursor: p.live ? 'pointer' : 'not-allowed',
        border: `1px solid ${selected ? 'var(--c-blue)' : 'var(--c-border)'}`,
        background: selected ? 'var(--c-blue-lo)' : 'var(--c-raised)',
        opacity: p.live ? 1 : 0.5,
        transition: 'border-color .15s, background .15s, box-shadow .15s',
        boxShadow: selected ? '0 0 0 1px var(--c-blue)' : 'none',
      }}
      onMouseEnter={e => { if (p.live && !selected) e.currentTarget.style.borderColor = 'var(--c-border2)' }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.borderColor = 'var(--c-border)' }}
    >
      {selected && (
        <i className="ti ti-circle-check-filled"
          style={{ position: 'absolute', top: 10, right: 10, color: 'var(--c-blue)', fontSize: 16 }} />
      )}
      {!p.live && (
        <span style={{
          position: 'absolute', top: 10, right: 10,
          fontSize: 9, fontWeight: 600, letterSpacing: '.06em',
          background: 'var(--c-raised)', border: '1px solid var(--c-border2)',
          color: 'var(--t-lo)', borderRadius: 4, padding: '2px 6px',
        }}>SOON</span>
      )}
      <div style={{
        width: 36, height: 36, borderRadius: 8,
        background: p.bg, display: 'grid', placeItems: 'center', marginBottom: 10,
      }}>
        <i className={`ti ti-${p.icon}`} style={{ color: p.color, fontSize: 18 }} />
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 3 }}>{p.label}</div>
      <div style={{ fontSize: 11, color: 'var(--t-lo)' }}>{p.desc}</div>
    </div>
  )
}

function TestResult({ result }) {
  if (!result) return null
  return (
    <Alert type={result.success ? 'success' : 'error'}>
      <strong>{result.success ? 'Connected:' : 'Failed:'}</strong> {result.message}
      {result.detail && <><br /><span style={{ color: 'var(--t-lo)' }}>{result.detail}</span></>}
    </Alert>
  )
}

export default function PlatformsPage() {
  const { config, setField, setNested, save } = useConfig()
  const toast = useToast()
  const [testing, setTesting] = useState(null)
  const [results, setResults] = useState<Record<string, any>>({})
  const [showToken, setShowToken] = useState(false)
  const [showPass, setShowPass] = useState(false)

  const testConn = async (platform) => {
    setTesting(platform)
    const payload =
      platform === 'discord' ? { platform: 'discord', config: { bot_token: config.discord.bot_token } }
      : { platform: 'taiga', config: { url: config.taiga.url, username: config.taiga.username, password: config.taiga.password } }
    try {
      const res = await api.testConnection(payload)
      setResults(r => ({ ...r, [platform]: res }))
      toast(res.success ? res.message : `Test failed: ${res.message}`, res.success ? 'success' : 'error')
    } catch {
      toast('Backend offline — cannot test connection', 'warn')
    } finally { setTesting(null) }
  }

  const handleSave = async () => {
    const r = await save()
    toast(r.local ? 'Saved locally (backend offline)' : 'Settings saved')
  }

  return (
    <div>
      <PageHeader
        title="Platforms"
        description="Choose your communication and project management platforms, then enter credentials."
        action={<Btn variant="primary" onClick={handleSave}><i className="ti ti-check" />Save changes</Btn>}
      />

      {/* Communication platform */}
      <ConfigCard>
        <CardHeader>
          <i className="ti ti-message-circle" style={{ color: 'var(--t-lo)' }} />
          Communication platform
        </CardHeader>
        <CardBody>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 20 }}>
            {COMM_PLATFORMS.map(p => (
              <PlatCard key={p.id} p={p} selected={config.comm_platform === p.id}
                onSelect={id => setField('comm_platform', id)} />
            ))}
          </div>

          {/* Discord credentials */}
          {config.comm_platform === 'discord' && (
            <div style={{ borderTop: '1px solid var(--c-border)', paddingTop: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--t-lo)', marginBottom: 14, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                Discord credentials
              </div>
              <TestResult result={results.discord} />
              <Grid2>
                <ConfigField label="Bot token" required hint="Discord Developer Portal → Bot → Token">
                  <div style={{ position: 'relative' }}>
                    <input
                      type={showToken ? 'text' : 'password'}
                      placeholder="MTxxxx.xxxxx.xxxxxxxxxx"
                      value={config.discord.bot_token}
                      onChange={e => setNested('discord', 'bot_token', e.target.value)}
                      style={{ fontFamily: 'var(--mono)', fontSize: 12, paddingRight: 36 }}
                    />
                    <button onClick={() => setShowToken(v => !v)} style={{
                      position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                      background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t-lo)', padding: 2,
                    }}>
                      <i className={`ti ti-${showToken ? 'eye-off' : 'eye'}`} style={{ fontSize: 14 }} />
                    </button>
                  </div>
                </ConfigField>
                <ConfigField label="Trigger role name" hint="Role name that activates the bot">
                  <input type="text" placeholder="FYP"
                    value={config.discord.trigger_role}
                    onChange={e => setNested('discord', 'trigger_role', e.target.value)} />
                </ConfigField>
              </Grid2>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Btn variant="ghost" size="sm" loading={testing === 'discord'} onClick={() => testConn('discord')}>
                  <i className="ti ti-plug" />Test Discord connection
                </Btn>
              </div>
            </div>
          )}
        </CardBody>
      </ConfigCard>

      {/* PM platform */}
      <ConfigCard>
        <CardHeader>
          <i className="ti ti-checklist" style={{ color: 'var(--t-lo)' }} />
          Project management platform
        </CardHeader>
        <CardBody>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 20 }}>
            {PM_PLATFORMS.map(p => (
              <PlatCard key={p.id} p={p} selected={config.pm_platform === p.id}
                onSelect={id => setField('pm_platform', id)} />
            ))}
          </div>

          {/* Taiga credentials */}
          {config.pm_platform === 'taiga' && (
            <div style={{ borderTop: '1px solid var(--c-border)', paddingTop: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--t-lo)', marginBottom: 14, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                Taiga credentials
              </div>
              <TestResult result={results.taiga} />
              <ConfigField label="Instance URL" required hint="Your Taiga REST API base URL">
                <input type="url" placeholder="https://taiga.example.com/api/v1"
                  value={config.taiga.url}
                  onChange={e => setNested('taiga', 'url', e.target.value)}
                  style={{ fontFamily: 'var(--mono)', fontSize: 12 }} />
              </ConfigField>
              <Grid2>
                <ConfigField label="Username" required>
                  <input type="text" placeholder="bot_user"
                    value={config.taiga.username}
                    onChange={e => setNested('taiga', 'username', e.target.value)} />
                </ConfigField>
                <ConfigField label="Password" required>
                  <div style={{ position: 'relative' }}>
                    <input
                      type={showPass ? 'text' : 'password'}
                      placeholder="••••••••"
                      value={config.taiga.password}
                      onChange={e => setNested('taiga', 'password', e.target.value)}
                      style={{ paddingRight: 36 }}
                    />
                    <button onClick={() => setShowPass(v => !v)} style={{
                      position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                      background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t-lo)', padding: 2,
                    }}>
                      <i className={`ti ti-${showPass ? 'eye-off' : 'eye'}`} style={{ fontSize: 14 }} />
                    </button>
                  </div>
                </ConfigField>
              </Grid2>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Btn variant="ghost" size="sm" loading={testing === 'taiga'} onClick={() => testConn('taiga')}>
                  <i className="ti ti-plug" />Test Taiga connection
                </Btn>
              </div>
            </div>
          )}
        </CardBody>
      </ConfigCard>
    </div>
  )
}
