import { useState } from 'react'
import { useConfig } from '../../store/ConfigContext'
import { useToast } from '../../components/ui/Toast'
import { api } from '../../lib/configApi'
import { ConfigCard, CardHeader, CardBody, ConfigField, Btn, PageHeader, Alert, Grid2, Badge } from '../../components/ui/index'

const MODELS = [
  { id: 'gemini-1.5-pro',       label: 'Gemini 1.5 Pro',        desc: 'Best reasoning, slower',     badge: 'Recommended', badgeColor: 'blue'    },
  { id: 'gemini-1.5-flash',     label: 'Gemini 1.5 Flash',      desc: 'Fast, cost-efficient',       badge: 'Fast',        badgeColor: 'green'   },
  { id: 'gemini-1.0-pro',       label: 'Gemini 1.0 Pro',        desc: 'Stable, proven',             badge: null,          badgeColor: null       },
  { id: 'gemini-2.0-flash-exp', label: 'Gemini 2.0 Flash (exp)',desc: 'Latest experimental',        badge: 'Experimental',badgeColor: 'amber'   },
]

function ModelCard({ model, selected, onSelect }) {
  return (
    <div onClick={() => onSelect(model.id)} style={{
      padding: '12px 14px', borderRadius: 8, cursor: 'pointer',
      border: `1px solid ${selected ? 'var(--c-blue)' : 'var(--c-border)'}`,
      background: selected ? 'var(--c-blue-lo)' : 'var(--c-raised)',
      transition: 'all .12s', position: 'relative',
      boxShadow: selected ? '0 0 0 1px var(--c-blue)' : 'none',
    }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.borderColor = 'var(--c-border2)' }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.borderColor = 'var(--c-border)' }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 14, height: 14, borderRadius: '50%',
            border: `2px solid ${selected ? 'var(--c-blue)' : 'var(--c-border2)'}`,
            background: selected ? 'var(--c-blue)' : 'transparent',
            flexShrink: 0, transition: 'all .12s',
            display: 'grid', placeItems: 'center',
          }}>
            {selected && <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#fff' }} />}
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, fontFamily: 'var(--mono)' }}>{model.id}</div>
            <div style={{ fontSize: 11, color: 'var(--t-lo)', marginTop: 1 }}>{model.desc}</div>
          </div>
        </div>
        {model.badge && <Badge color={model.badgeColor}>{model.badge}</Badge>}
      </div>
    </div>
  )
}

export default function LLMPage() {
  const { config, setNested, save } = useConfig()
  const toast = useToast()
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [showKey, setShowKey] = useState(false)

  const testKey = async () => {
    if (!config.llm.gemini_api_key) { toast('Enter an API key first', 'warn'); return }
    setTesting(true)
    try {
      const res = await api.testConnection({ platform: 'gemini', config: { gemini_api_key: config.llm.gemini_api_key } })
      setTestResult(res)
      toast(res.success ? res.message : res.message, res.success ? 'success' : 'error')
    } catch {
      toast('Backend offline — cannot test key', 'warn')
    } finally { setTesting(false) }
  }

  const handleSave = async () => {
    const r = await save()
    toast(r.local ? 'Saved locally' : 'LLM settings saved')
  }

  return (
    <div>
      <PageHeader
        title="LLM & Models"
        description="Configure the Gemini models that power the agent's reasoning and the fast intent classifier."
        action={<Btn variant="primary" onClick={handleSave}><i className="ti ti-check" />Save changes</Btn>}
      />

      {/* API key */}
      <ConfigCard>
        <CardHeader>
          <i className="ti ti-key" style={{ color: 'var(--t-lo)' }} />
          Gemini API key
          <Badge color={config.llm.gemini_api_key?.length > 10 ? 'green' : 'neutral'}>
            {config.llm.gemini_api_key?.length > 10 ? 'Set' : 'Not set'}
          </Badge>
        </CardHeader>
        <CardBody>
          {testResult && (
            <Alert type={testResult.success ? 'success' : 'error'}>
              <strong>{testResult.success ? 'Valid key:' : 'Invalid key:'}</strong> {testResult.message}
            </Alert>
          )}
          <ConfigField label="API key" required hint="Get your key from Google AI Studio (aistudio.google.com) → API keys">
            <div style={{ position: 'relative' }}>
              <input
                type={showKey ? 'text' : 'password'}
                placeholder="AIzaSy…"
                value={config.llm.gemini_api_key}
                onChange={e => { setNested('llm', 'gemini_api_key', e.target.value); setTestResult(null) }}
                style={{ fontFamily: 'var(--mono)', fontSize: 12, paddingRight: 80 }}
              />
              <div style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', display: 'flex', gap: 4 }}>
                <button onClick={() => setShowKey(v => !v)} style={{
                  background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t-lo)', padding: '3px 4px',
                }}>
                  <i className={`ti ti-${showKey ? 'eye-off' : 'eye'}`} style={{ fontSize: 13 }} />
                </button>
                <Btn variant="subtle" size="sm" loading={testing} onClick={testKey}>
                  Test
                </Btn>
              </div>
            </div>
          </ConfigField>
        </CardBody>
      </ConfigCard>

      {/* Agent model */}
      <ConfigCard>
        <CardHeader>
          <i className="ti ti-brain" style={{ color: 'var(--t-lo)' }} />
          Agent model
        </CardHeader>
        <CardBody>
          <p style={{ fontSize: 12, color: 'var(--t-lo)', marginBottom: 14, lineHeight: 1.6 }}>
            Used for the main ReAct reasoning loop and tool calls. Prioritise quality here — this model reads project context and decides which tools to invoke.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {MODELS.map(m => (
              <ModelCard key={m.id} model={m}
                selected={config.llm.agent_model === m.id}
                onSelect={v => setNested('llm', 'agent_model', v)}
              />
            ))}
          </div>
        </CardBody>
      </ConfigCard>

      {/* Classifier model */}
      <ConfigCard>
        <CardHeader>
          <i className="ti ti-bolt" style={{ color: 'var(--t-lo)' }} />
          Classifier model
        </CardHeader>
        <CardBody>
          <p style={{ fontSize: 12, color: 'var(--t-lo)', marginBottom: 14, lineHeight: 1.6 }}>
            Used for the fast intent router — runs before every message to classify intent and resource type. Optimise for speed and cost; Flash is ideal here.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {MODELS.map(m => (
              <ModelCard key={m.id} model={m}
                selected={config.llm.classifier_model === m.id}
                onSelect={v => setNested('llm', 'classifier_model', v)}
              />
            ))}
          </div>
        </CardBody>
      </ConfigCard>

      {/* Summary */}
      <ConfigCard>
        <CardHeader>
          <i className="ti ti-info-circle" style={{ color: 'var(--t-lo)' }} />
          Current model configuration
        </CardHeader>
        <CardBody style={{ padding: 0 }}>
          {[
            { label: 'Agent model',      value: config.llm.agent_model,      icon: 'brain' },
            { label: 'Classifier model', value: config.llm.classifier_model, icon: 'bolt'  },
          ].map((row, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px',
              borderBottom: i === 0 ? '1px solid var(--c-border)' : 'none',
            }}>
              <i className={`ti ti-${row.icon}`} style={{ color: 'var(--t-lo)', fontSize: 15, width: 16 }} />
              <span style={{ fontSize: 12, color: 'var(--t-mid)', flex: 1 }}>{row.label}</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--c-blue)' }}>{row.value}</span>
            </div>
          ))}
        </CardBody>
      </ConfigCard>
    </div>
  )
}
