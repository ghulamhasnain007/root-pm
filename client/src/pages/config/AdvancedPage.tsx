import { useConfig } from '../../store/ConfigContext'
import { useToast } from '../../components/ui/Toast'
import { ConfigCard, CardHeader, CardBody, ConfigField, Btn, PageHeader, Grid2, Divider } from '../../components/ui/index'

function NumberField({ label, hint, value, min, max, onChange }) {
  return (
    <ConfigField label={label} hint={hint}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={() => onChange(Math.max(min, value - 1))} style={{
          width: 32, height: 36, borderRadius: 'var(--r)',
          border: '1px solid var(--c-border2)', background: 'var(--c-raised)',
          color: 'var(--t-hi)', cursor: 'pointer', fontSize: 16, flexShrink: 0,
          display: 'grid', placeItems: 'center',
        }}>−</button>
        <input type="number" value={value} min={min} max={max}
          onChange={e => onChange(parseInt(e.target.value) || min)}
          style={{ textAlign: 'center', fontFamily: 'var(--mono)', fontWeight: 600 }} />
        <button onClick={() => onChange(Math.min(max, value + 1))} style={{
          width: 32, height: 36, borderRadius: 'var(--r)',
          border: '1px solid var(--c-border2)', background: 'var(--c-raised)',
          color: 'var(--t-hi)', cursor: 'pointer', fontSize: 16, flexShrink: 0,
          display: 'grid', placeItems: 'center',
        }}>+</button>
      </div>
    </ConfigField>
  )
}

function ConfigRow({ icon, label, description, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 20px', borderBottom: '1px solid var(--c-border)' }}>
      <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--c-raised)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
        <i className={`ti ti-${icon}`} style={{ fontSize: 15, color: 'var(--t-lo)' }} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--t-lo)', marginTop: 2 }}>{description}</div>
      </div>
      <div style={{ flexShrink: 0, minWidth: 140 }}>{children}</div>
    </div>
  )
}

export default function AdvancedPage() {
  const { config, setNested, save } = useConfig()
  const toast = useToast()
  const adv = config.advanced

  const set = (k, v) => setNested('advanced', k, v)

  const handleSave = async () => {
    const r = await save()
    toast(r.local ? 'Saved locally' : 'Advanced settings saved')
  }

  const handleReset = () => {
    setNested('advanced', 'max_iterations', 8)
    setNested('advanced', 'context_cache_ttl', 60)
    setNested('advanced', 'memory_max_tokens', 2000)
    toast('Reset to defaults')
  }

  return (
    <div>
      <PageHeader
        title="Advanced"
        description="Fine-tune agent behaviour, memory limits, and context caching."
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn variant="ghost" onClick={handleReset}><i className="ti ti-refresh" />Restore defaults</Btn>
            <Btn variant="primary" onClick={handleSave}><i className="ti ti-check" />Save changes</Btn>
          </div>
        }
      />

      {/* Agent loop */}
      <ConfigCard>
        <CardHeader>
          <i className="ti ti-adjustments" style={{ color: 'var(--t-lo)' }} />
          Agent loop
        </CardHeader>
        <div>
          <ConfigRow icon="repeat" label="Max tool iterations"
            description="Agent stops after this many tool calls. Prevents runaway loops.">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="range" min={1} max={20} value={adv.max_iterations}
                onChange={e => set('max_iterations', parseInt(e.target.value))}
                style={{ width: 90, accentColor: 'var(--c-blue)', height: 4 }} />
              <span style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600, color: 'var(--c-blue)', minWidth: 20, textAlign: 'right' }}>
                {adv.max_iterations}
              </span>
            </div>
          </ConfigRow>
          <ConfigRow icon="database" label="Context cache TTL"
            description="How long project data is cached before re-fetching from Taiga.">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="range" min={5} max={600} step={5} value={adv.context_cache_ttl}
                onChange={e => set('context_cache_ttl', parseInt(e.target.value))}
                style={{ width: 90, accentColor: 'var(--c-blue)', height: 4 }} />
              <span style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600, color: 'var(--c-blue)', minWidth: 36, textAlign: 'right' }}>
                {adv.context_cache_ttl}s
              </span>
            </div>
          </ConfigRow>
        </div>
      </ConfigCard>

      {/* Memory */}
      <ConfigCard>
        <CardHeader>
          <i className="ti ti-history" style={{ color: 'var(--t-lo)' }} />
          Conversation memory
        </CardHeader>
        <div>
          <ConfigRow icon="messages" label="Max token buffer per channel"
            description="Older messages are summarised by Gemini Flash when the buffer exceeds this limit.">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="range" min={500} max={8000} step={500} value={adv.memory_max_tokens}
                onChange={e => set('memory_max_tokens', parseInt(e.target.value))}
                style={{ width: 90, accentColor: 'var(--c-blue)', height: 4 }} />
              <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600, color: 'var(--c-blue)', minWidth: 46, textAlign: 'right' }}>
                {adv.memory_max_tokens.toLocaleString()}
              </span>
            </div>
          </ConfigRow>
        </div>
      </ConfigCard>

      {/* Current values summary */}
      <ConfigCard>
        <CardHeader>
          <i className="ti ti-code" style={{ color: 'var(--t-lo)' }} />
          Effective configuration
        </CardHeader>
        <CardBody>
          <div style={{
            background: 'var(--c-void)', border: '1px solid var(--c-border)',
            borderRadius: 'var(--r)', padding: '14px 16px',
            fontFamily: 'var(--mono)', fontSize: 11, lineHeight: 2, color: 'var(--t-mid)',
          }}>
            <span style={{ color: '#7dd3fc' }}>advanced</span>{': {'}<br />
            {'  '}<span style={{ color: '#a78bfa' }}>max_iterations</span>{': '}<span style={{ color: '#6ee7b7' }}>{adv.max_iterations}</span>{','}<br />
            {'  '}<span style={{ color: '#a78bfa' }}>context_cache_ttl</span>{': '}<span style={{ color: '#6ee7b7' }}>{adv.context_cache_ttl}</span>{',  '}<span style={{ color: 'var(--t-lo)' }}>// seconds</span><br />
            {'  '}<span style={{ color: '#a78bfa' }}>memory_max_tokens</span>{': '}<span style={{ color: '#6ee7b7' }}>{adv.memory_max_tokens}</span><br />
            {'}'}
          </div>
        </CardBody>
      </ConfigCard>
    </div>
  )
}
