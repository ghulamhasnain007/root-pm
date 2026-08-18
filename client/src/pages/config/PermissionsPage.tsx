import { useConfig } from '../../store/ConfigContext'
import { useToast } from '../../components/ui/Toast'
import { ConfigCard, CardHeader, CardBody, Btn, PageHeader, TierBadge, Empty } from '../../components/ui/index'

const TIERS = ['admin', 'write', 'read', 'none']
const TIER_DESC = {
  admin:  'All operations including bulk actions and epics',
  write:  'Create, update, and close items',
  read:   'Query and list items only',
  none:   'No bot access — messages are ignored',
}
const TIER_COLOR = {
  admin: 'var(--c-violet)', write: 'var(--c-blue)', read: 'var(--c-green)', none: 'var(--t-lo)',
}

export default function PermissionsPage() {
  const { config, setField, save } = useConfig()
  const toast = useToast()
  const roles = config.role_permissions || []

  const update = (rows) => setField('role_permissions', rows)
  const addRole = () => update([...roles, { id: crypto.randomUUID(), role_name: '', tier: 'read' }])
  const updateRole = (id, key, val) => update(roles.map(r => r.id === id ? { ...r, [key]: val } : r))
  const removeRole = (id) => { update(roles.filter(r => r.id !== id)); toast('Role removed') }

  const handleSave = async () => {
    const r = await save()
    toast(r.local ? 'Saved locally' : 'Permissions saved')
  }

  return (
    <div>
      <PageHeader
        title="Permissions"
        description="Map Discord role names to access tiers. Roles not listed are denied bot access."
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn variant="ghost" onClick={addRole}><i className="ti ti-plus" />Add role</Btn>
            <Btn variant="primary" onClick={handleSave}><i className="ti ti-check" />Save changes</Btn>
          </div>
        }
      />

      {/* Role mapping table */}
      <ConfigCard>
        <CardHeader>
          <i className="ti ti-shield-half" style={{ color: 'var(--t-lo)' }} />
          Role → tier mapping
          <span style={{ fontSize: 11, color: 'var(--t-lo)', fontWeight: 400 }}>({roles.length} roles)</span>
        </CardHeader>

        {roles.length === 0 ? (
          <CardBody>
            <Empty
              icon="shield-off"
              title="No roles defined"
              description="Add roles to control who can use the bot and what they can do."
              action={<Btn variant="primary" onClick={addRole}><i className="ti ti-plus" />Add first role</Btn>}
            />
          </CardBody>
        ) : (
          <div>
            {/* Table header */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 160px 1fr 40px',
              padding: '8px 20px', borderBottom: '1px solid var(--c-border)',
              background: 'var(--c-raised)',
            }}>
              {['Discord role name', 'Access tier', 'Capabilities', ''].map((h, i) => (
                <div key={i} style={{ fontSize: 11, fontWeight: 500, color: 'var(--t-lo)' }}>{h}</div>
              ))}
            </div>

            {/* Rows */}
            {roles.map((r, idx) => (
              <div key={r.id} style={{
                display: 'grid', gridTemplateColumns: '1fr 160px 1fr 40px',
                alignItems: 'center', padding: '10px 20px',
                borderBottom: idx < roles.length - 1 ? '1px solid var(--c-border)' : 'none',
                transition: 'background .12s',
              }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--c-raised)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <div style={{ paddingRight: 12 }}>
                  <input
                    type="text"
                    placeholder="Enter Discord role name…"
                    value={r.role_name}
                    onChange={e => updateRole(r.id, 'role_name', e.target.value)}
                    style={{ height: 30, fontSize: 13 }}
                  />
                </div>

                <div style={{ paddingRight: 12 }}>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {TIERS.map(t => (
                      <button key={t} onClick={() => updateRole(r.id, 'tier', t)} style={{
                        padding: '3px 10px', borderRadius: 4, fontSize: 11, fontWeight: 500,
                        cursor: 'pointer', border: '1px solid',
                        transition: 'all .12s',
                        background: r.tier === t ? `${TIER_COLOR[t]}18` : 'transparent',
                        borderColor: r.tier === t ? TIER_COLOR[t] : 'var(--c-border2)',
                        color: r.tier === t ? TIER_COLOR[t] : 'var(--t-lo)',
                      }}>
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ fontSize: 12, color: 'var(--t-lo)' }}>
                  {TIER_DESC[r.tier]}
                </div>

                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <button onClick={() => removeRole(r.id)} style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--t-lo)', padding: 4, borderRadius: 4, transition: 'color .12s',
                  }}
                    onMouseEnter={e => e.currentTarget.style.color = 'var(--c-red)'}
                    onMouseLeave={e => e.currentTarget.style.color = 'var(--t-lo)'}
                  >
                    <i className="ti ti-trash" style={{ fontSize: 14 }} />
                  </button>
                </div>
              </div>
            ))}

            <div style={{ padding: '10px 20px', borderTop: '1px solid var(--c-border)' }}>
              <Btn variant="subtle" size="sm" onClick={addRole}><i className="ti ti-plus" />Add role</Btn>
            </div>
          </div>
        )}
      </ConfigCard>

      {/* Tier reference */}
      <ConfigCard>
        <CardHeader>
          <i className="ti ti-layers-intersect" style={{ color: 'var(--t-lo)' }} />
          Tier capabilities reference
        </CardHeader>
        <CardBody style={{ padding: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--c-border)' }}>
                {['Tier', 'List & query', 'Create / update / close', 'Bulk ops & epics', 'Admin commands'].map((h, i) => (
                  <th key={i} style={{ padding: '10px 20px', textAlign: 'left', fontWeight: 500, color: 'var(--t-lo)', fontSize: 11 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                ['admin', '✓', '✓', '✓', '✓'],
                ['write', '✓', '✓', '✗', '✗'],
                ['read',  '✓', '✗', '✗', '✗'],
                ['none',  '✗', '✗', '✗', '✗'],
              ].map(([tier, ...caps]) => (
                <tr key={tier} style={{ borderBottom: '1px solid var(--c-border)' }}>
                  <td style={{ padding: '10px 20px' }}><TierBadge tier={tier} /></td>
                  {caps.map((c, i) => (
                    <td key={i} style={{ padding: '10px 20px', color: c === '✓' ? 'var(--c-green)' : 'var(--t-lo)' }}>
                      <i className={`ti ti-${c === '✓' ? 'check' : 'x'}`} style={{ fontSize: 14 }} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </ConfigCard>
    </div>
  )
}
