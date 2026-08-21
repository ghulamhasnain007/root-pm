/**
 * pages/config/ToolConfigPage.tsx — Per-org tool configuration via auth-service.
 * Admins configure tool credentials; connection status is shown per tool.
 */
import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../../store/AuthContext';
import { authApi } from '../../lib/authApi';
import { PageHeader } from '../../components/ui/index';

interface ToolConfig {
  toolId: string;
  category: string;
  credentials: Record<string, string>;
  configuredAt?: string;
}

interface ConnectionStatus {
  toolId: string;
  connected: boolean;
  lastChecked: string;
  error?: string;
}

const TOOL_DEFINITIONS = [
  { id: 'discord', label: 'Discord', icon: 'brand-discord', color: '#5865F2', bg: 'rgba(88,101,242,.12)', fields: [
    { key: 'bot_token', label: 'Bot token', type: 'password', placeholder: 'MTxxxx.xxxxx.xxxxxxxxxx', hint: 'Discord Developer Portal > Bot > Token' },
    { key: 'trigger_role', label: 'Trigger role', type: 'text', placeholder: 'FYP', hint: 'Role name that activates the bot' },
  ]},
  { id: 'taiga', label: 'Taiga', icon: 'leaf', color: '#10B981', bg: 'rgba(16,185,129,.12)', fields: [
    { key: 'url', label: 'Instance URL', type: 'url', placeholder: 'https://taiga.example.com/api/v1', hint: 'Taiga REST API base URL' },
    { key: 'username', label: 'Username', type: 'text', placeholder: 'bot_user' },
    { key: 'password', label: 'Password', type: 'password', placeholder: '••••••••' },
  ]},
];

export default function ToolConfigPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'owner' || user?.role === 'admin';

  const [configs, setConfigs] = useState<ToolConfig[]>([]);
  const [statuses, setStatuses] = useState<ConnectionStatus[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadConfigs = useCallback(async () => {
    if (!user?.orgId) return;
    try {
      const data = await authApi.listTools(user.orgId);
      setConfigs(data?.tools || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [user?.orgId]);

  const loadStatuses = useCallback(async () => {
    if (!user?.orgId) return;
    try {
      const resp = await fetch(`http://localhost:3001/integrations/status`, {
        headers: { 'Authorization': `Bearer ${authApi.getAccessToken()}` },
      });
      if (resp.ok) {
        const data = await resp.json();
        setStatuses(data?.connections || []);
      }
    } catch { /* ignore */ }
  }, [user?.orgId]);

  useEffect(() => { loadConfigs(); loadStatuses(); }, [loadConfigs, loadStatuses]);

  // Poll status every 30s
  useEffect(() => {
    const interval = setInterval(loadStatuses, 30000);
    return () => clearInterval(interval);
  }, [loadStatuses]);

  const startEdit = (toolId: string) => {
    const existing = configs.find(c => c.toolId === toolId);
    setEditing(toolId);
    setCredentials(existing?.credentials || {});
  };

  const handleSave = async () => {
    if (!user?.orgId || !editing) return;
    setSaving(true);
    try {
      await authApi.setTool(user.orgId, editing, TOOL_DEFINITIONS.find(t => t.id === editing)?.category || 'integration', credentials);
      await loadConfigs();
      await loadStatuses();
      setEditing(null);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (toolId: string) => {
    if (!user?.orgId) return;
    if (!confirm(`Remove ${toolId} configuration?`)) return;
    try {
      await authApi.removeTool(user?.orgId, toolId);
      await loadConfigs();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const getStatus = (toolId: string) => statuses.find(s => s.toolId === toolId);

  if (loading) return <p style={{ color: 'var(--t-mid)', fontSize: 14 }}>Loading tools...</p>;

  return (
    <div>
      <PageHeader
        title="Tool Configuration"
        description="Configure credentials for each tool. Settings are stored per-org."
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {TOOL_DEFINITIONS.map(tool => {
          const config = configs.find(c => c.toolId === tool.id);
          const status = getStatus(tool.id);
          const isEditing = editing === tool.id;

          return (
            <div key={tool.id} style={{
              borderRadius: 10, border: '1px solid var(--c-border)',
              background: 'var(--c-raised)', overflow: 'hidden',
            }}>
              {/* Tool header */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px',
                borderBottom: editing === tool.id ? '1px solid var(--c-border)' : 'none',
              }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 8,
                  background: tool.bg, display: 'grid', placeItems: 'center', flexShrink: 0,
                }}>
                  <i className={`ti ti-${tool.icon}`} style={{ color: tool.color, fontSize: 18 }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{tool.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--t-lo)' }}>
                    {config ? 'Configured' : 'Not configured'}
                  </div>
                </div>

                {/* Status indicator */}
                {status && (
                  <span style={{
                    display: 'flex', alignItems: 'center', gap: 6, fontSize: 12,
                    color: status.connected ? 'var(--c-green)' : 'var(--c-red)',
                  }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />
                    {status.connected ? 'Connected' : 'Disconnected'}
                  </span>
                )}

                {/* Actions */}
                {isAdmin && !isEditing && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => startEdit(tool.id)} style={{
                      padding: '6px 12px', borderRadius: 6, border: '1px solid var(--c-border2)',
                      background: 'transparent', color: 'var(--t-mid)', fontSize: 12, cursor: 'pointer',
                    }}>
                      {config ? 'Edit' : 'Configure'}
                    </button>
                    {config && (
                      <button onClick={() => handleRemove(tool.id)} style={{
                        padding: '6px 12px', borderRadius: 6, border: '1px solid var(--c-border)',
                        background: 'transparent', color: '#ef4444', fontSize: 12, cursor: 'pointer',
                      }}>
                        Remove
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Edit form */}
              {isEditing && (
                <div style={{ padding: 20 }}>
                  {tool.fields.map(field => (
                    <label key={field.key} style={{ display: 'block', marginBottom: 16 }}>
                      <span style={{ fontSize: 12, color: 'var(--t-mid)', marginBottom: 4, display: 'block' }}>
                        {field.label}
                      </span>
                      {field.hint && <span style={{ fontSize: 11, color: 'var(--t-lo)', display: 'block', marginBottom: 4 }}>{field.hint}</span>}
                      <input
                        type={field.type}
                        placeholder={field.placeholder}
                        value={credentials[field.key] || ''}
                        onChange={e => setCredentials(prev => ({ ...prev, [field.key]: e.target.value }))}
                        style={{
                          width: '100%', padding: '8px 12px', borderRadius: 6,
                          border: '1px solid var(--c-border2)', background: 'var(--c-base)',
                          color: 'var(--t-hi)', fontSize: 13, fontFamily: field.type === 'password' ? 'var(--mono)' : undefined,
                        }}
                      />
                    </label>
                  ))}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={handleSave} disabled={saving} style={{
                      padding: '8px 16px', borderRadius: 8, border: 'none',
                      background: 'var(--c-blue)', color: '#fff', fontSize: 13, fontWeight: 500,
                      cursor: saving ? 'wait' : 'pointer',
                    }}>
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                    <button onClick={() => setEditing(null)} style={{
                      padding: '8px 16px', borderRadius: 8, border: '1px solid var(--c-border2)',
                      background: 'transparent', color: 'var(--t-mid)', fontSize: 13, cursor: 'pointer',
                    }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!isAdmin && (
        <p style={{ fontSize: 12, color: 'var(--t-lo)', marginTop: 16, fontStyle: 'italic' }}>
          Only admins can configure tools.
        </p>
      )}
    </div>
  );
}
