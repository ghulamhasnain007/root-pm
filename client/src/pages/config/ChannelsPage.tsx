import { useState } from 'react'
import { useConfig } from '../../store/ConfigContext'
import { useToast } from '../../components/ui/Toast'
import { ConfigCard, CardHeader, CardBody, ConfigField, Btn, PageHeader, Empty, Mono, Alert } from '../../components/ui/index'

function newRow() {
  return { id: crypto.randomUUID(), guild_id: '', channel_id: '', project_slug: '', active: true }
}

export default function ChannelsPage() {
  const { config, setField, save } = useConfig()
  const toast = useToast()
  const mappings = config.channel_mappings || []
  const [editingId, setEditingId] = useState(null)

  const update = (rows) => setField('channel_mappings', rows)

  const addRow = () => {
    const row = newRow()
    update([...mappings, row])
    setEditingId(row.id)
  }

  const updateRow = (id, key, val) => {
    update(mappings.map(m => m.id === id ? { ...m, [key]: val } : m))
  }

  const removeRow = (id) => {
    update(mappings.filter(m => m.id !== id))
    toast('Mapping removed')
  }

  const handleSave = async () => {
    const r = await save()
    toast(r.local ? 'Saved locally' : 'Channel mappings saved')
  }

  const validCount = mappings.filter(m => m.guild_id && m.channel_id && m.project_slug).length

  return (
    <div>
      <PageHeader
        title="Channel map"
        description="Link each Discord channel to a Taiga project slug. Multiple channels can share one project."
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn variant="ghost" onClick={addRow}><i className="ti ti-plus" />Add mapping</Btn>
            <Btn variant="primary" onClick={handleSave}><i className="ti ti-check" />Save changes</Btn>
          </div>
        }
      />

      {mappings.length > 0 && (
        <Alert type="info">
          <strong>{validCount}</strong> of {mappings.length} mapping(s) are complete and will be active.
          Rows with empty fields are saved but inactive.
        </Alert>
      )}

      <ConfigCard>
        <CardHeader>
          <i className="ti ti-map-pin" style={{ color: 'var(--t-lo)' }} />
          Channel → project mappings
          <span style={{ fontSize: 11, color: 'var(--t-lo)', fontWeight: 400 }}>({mappings.length})</span>
        </CardHeader>

        {mappings.length === 0 ? (
          <CardBody>
            <Empty
              icon="map-off"
              title="No mappings yet"
              description="Add a mapping to link a Discord channel to a Taiga project."
              action={<Btn variant="primary" onClick={addRow}><i className="ti ti-plus" />Add first mapping</Btn>}
            />
          </CardBody>
        ) : (
          <div>
            {/* Header row */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 40px',
              gap: 0, padding: '8px 20px 8px',
              borderBottom: '1px solid var(--c-border)',
              background: 'var(--c-raised)',
            }}>
              {['Server ID', 'Channel ID', 'Project slug', ''].map((h, i) => (
                <div key={i} style={{ fontSize: 11, fontWeight: 500, color: 'var(--t-lo)', padding: '0 6px' }}>{h}</div>
              ))}
            </div>

            {/* Data rows */}
            {mappings.map((m, idx) => {
              const isValid = m.guild_id && m.channel_id && m.project_slug
              const isEditing = editingId === m.id
              return (
                <div key={m.id} style={{
                  display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 40px',
                  borderBottom: idx < mappings.length - 1 ? '1px solid var(--c-border)' : 'none',
                  transition: 'background .12s',
                  background: isEditing ? 'var(--c-raised)' : 'transparent',
                }}
                  onMouseEnter={e => { if (!isEditing) e.currentTarget.style.background = 'var(--c-raised)' }}
                  onMouseLeave={e => { if (!isEditing) e.currentTarget.style.background = 'transparent' }}
                >
                  {[
                    { key: 'guild_id',     placeholder: '1234567890123456789', label: 'Server ID'     },
                    { key: 'channel_id',   placeholder: '9876543210987654321', label: 'Channel ID'    },
                    { key: 'project_slug', placeholder: 'my-project-slug',     label: 'Project slug'  },
                  ].map(col => (
                    <div key={col.key} style={{ padding: '10px 14px', display: 'flex', alignItems: 'center' }}>
                      {isEditing ? (
                        <input
                          type="text"
                          placeholder={col.placeholder}
                          value={m[col.key]}
                          onChange={e => updateRow(m.id, col.key, e.target.value)}
                          style={{ height: 30, fontSize: 12, fontFamily: 'var(--mono)' }}
                          autoFocus={col.key === 'guild_id' && idx === mappings.length - 1}
                        />
                      ) : (
                        <div onClick={() => setEditingId(m.id)} style={{ cursor: 'text', width: '100%' }}>
                          {m[col.key]
                            ? <Mono style={{ color: isValid ? 'var(--t-hi)' : 'var(--t-mid)' }}>{m[col.key]}</Mono>
                            : <span style={{ fontSize: 11, color: 'var(--t-lo)', fontStyle: 'italic' }}>{col.placeholder}</span>
                          }
                        </div>
                      )}
                    </div>
                  ))}

                  {/* Status + delete */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '10px 8px', gap: 4 }}>
                    <button onClick={() => removeRow(m.id)} style={{
                      background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t-lo)',
                      padding: 4, borderRadius: 4, transition: 'color .12s',
                    }}
                      onMouseEnter={e => e.currentTarget.style.color = 'var(--c-red)'}
                      onMouseLeave={e => e.currentTarget.style.color = 'var(--t-lo)'}
                    >
                      <i className="ti ti-trash" style={{ fontSize: 14 }} />
                    </button>
                  </div>
                </div>
              )
            })}

            <div style={{ padding: '12px 20px', borderTop: '1px solid var(--c-border)', display: 'flex', gap: 8 }}>
              <Btn variant="subtle" size="sm" onClick={addRow}>
                <i className="ti ti-plus" />Add row
              </Btn>
              {editingId && (
                <Btn variant="subtle" size="sm" onClick={() => setEditingId(null)}>
                  <i className="ti ti-check" />Done editing
                </Btn>
              )}
            </div>
          </div>
        )}
      </ConfigCard>

      {/* How-to guide */}
      <ConfigCard>
        <CardHeader>
          <i className="ti ti-help-circle" style={{ color: 'var(--t-lo)' }} />
          How to find Discord IDs
        </CardHeader>
        <CardBody>
          <ol style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              { n: 1, text: 'In Discord, go to Settings → Advanced and enable', code: 'Developer Mode' },
              { n: 2, text: 'Right-click your server name in the sidebar → Copy Server ID', code: null },
              { n: 3, text: 'Right-click the channel → Copy Channel ID', code: null },
              { n: 4, text: 'The project slug comes from the Taiga URL:', code: 'taiga.io/project/YOUR-SLUG/' },
            ].map(step => (
              <li key={step.n} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span style={{
                  width: 22, height: 22, borderRadius: '50%',
                  background: 'var(--c-raised)', border: '1px solid var(--c-border2)',
                  display: 'grid', placeItems: 'center',
                  fontSize: 11, fontWeight: 600, color: 'var(--c-blue)', flexShrink: 0,
                }}>{step.n}</span>
                <span style={{ fontSize: 12, color: 'var(--t-mid)', lineHeight: 1.8 }}>
                  {step.text}{' '}
                  {step.code && <Mono style={{ background: 'var(--c-raised)', padding: '1px 6px', borderRadius: 4 }}>{step.code}</Mono>}
                </span>
              </li>
            ))}
          </ol>
        </CardBody>
      </ConfigCard>
    </div>
  )
}
