import { useCallback, useEffect, useState } from 'react';
import { integrationsApi } from '../../lib/voiceApi.js';
import { DiscordMeetingPanel } from './DiscordMeetingPanel.js';
import type { ProviderInfo, CredentialField } from '../../types/integrations.js';
import {
  Button, StatusBadge, Pill, Card, PageHeader, Field, Switch, Banner, Spinner,
} from '../../components/ui/index.js';

const CAPABILITY_LABEL: Record<string, string> = {
  oauth_connect: 'OAuth connect',
  webhook_events: 'Webhook events',
  realtime_audio: 'Real-time audio',
  transcript_fetch: 'Transcripts',
  bot_join: 'Bot join',
};

const STATUS_TONE: Record<ProviderInfo['status'], { tone: 'success' | 'warning' | 'danger' | 'neutral'; label: string }> = {
  connected: { tone: 'success', label: 'Connected' },
  pending: { tone: 'warning', label: 'Pending' },
  error: { tone: 'danger', label: 'Error' },
  disconnected: { tone: 'neutral', label: 'Not connected' },
};

function CredentialForm({
  provider, fields, onSaved,
}: {
  provider: ProviderInfo;
  fields: CredentialField[];
  onSaved: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secretsSet, setSecretsSet] = useState<string[]>([]);

  useEffect(() => {
    integrationsApi.getCredentials(provider.id).then((res) => {
      setValues(res.values);
      setSecretsSet(res.secretsSet ?? []);
    }).catch(() => {});
  }, [provider.id]);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await integrationsApi.saveCredentials(provider.id, values);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save these credentials.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 pt-4 mt-1 border-t border-gray-800">
      {fields.map((f) => {
        const alreadySet = f.secret && secretsSet.includes(f.key);
        return (
          <Field
            key={f.key}
            label={f.label}
            required={f.required}
            type={f.secret ? 'password' : 'text'}
            value={values[f.key] ?? ''}
            onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            placeholder={alreadySet ? 'Already set — leave blank to keep it' : f.placeholder}
            helpText={f.helpText}
          />
        );
      })}

      {error && <p className="text-[12px] text-red-400">{error}</p>}

      <Button variant="primary" fullWidth onClick={submit} disabled={saving}>
        {saving ? 'Saving…' : 'Save credentials'}
      </Button>
    </div>
  );
}

function ProviderCard({ provider, onChange }: { provider: ProviderInfo; onChange: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const status = STATUS_TONE[provider.status];

  const toggle = async (enabled: boolean) => {
    setBusy(true);
    try { await integrationsApi.toggle(provider.id, enabled); onChange(); }
    finally { setBusy(false); }
  };

  const disconnect = async () => {
    setBusy(true);
    try { await integrationsApi.disconnect(provider.id); onChange(); }
    finally { setBusy(false); }
  };

  const clearCredentials = async () => {
    setBusy(true);
    try { await integrationsApi.clearCredentials(provider.id); onChange(); }
    finally { setBusy(false); }
  };

  const connect = async () => {
    setBusy(true);
    try {
      const { url } = await integrationsApi.connect(provider.id);
      window.location.href = url; // hand off to the provider's OAuth consent screen
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-display text-[14px] font-semibold text-gray-100">{provider.displayName}</h3>
            {provider.requiresAdvancedSetup && <Pill tone="warning">Advanced setup</Pill>}
          </div>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {provider.capabilities.map((c) => <Pill key={c}>{CAPABILITY_LABEL[c] ?? c}</Pill>)}
          </div>
        </div>
        <StatusBadge tone={status.tone} label={status.label} />
      </div>

      {provider.notes && <p className="text-[11px] text-gray-500 leading-relaxed">{provider.notes}</p>}

      {provider.lastError && (
        <p className="text-[11px] text-red-400 bg-red-950/30 border border-red-500/20 rounded-lg px-2.5 py-1.5">
          {provider.lastError}
        </p>
      )}

      {provider.docsUrl && (
        <a href={provider.docsUrl} target="_blank" rel="noreferrer"
          className="text-[11px] text-brand hover:text-brand-hover inline-block transition-colors">
          View setup docs →
        </a>
      )}

      <div className="flex items-center gap-2 flex-wrap pt-1">
        {provider.status === 'connected' ? (
          <>
            <Switch checked={provider.enabled} onChange={toggle} disabled={busy} label="Enabled for meetings" />
            <Button variant="danger" size="sm" onClick={disconnect} disabled={busy} className="ml-auto">
              Disconnect
            </Button>
          </>
        ) : provider.configured ? (
          <>
            <Button variant="primary" size="sm" onClick={connect} disabled={busy}>
              Connect via OAuth
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setExpanded((v) => !v)}>
              {expanded ? 'Hide credentials' : 'Edit credentials'}
            </Button>
            <Button variant="ghost" size="sm" onClick={clearCredentials} disabled={busy} className="ml-auto">
              Clear
            </Button>
          </>
        ) : (
          <Button variant="primary" size="sm" onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Hide setup' : 'Configure'}
          </Button>
        )}
      </div>

      {expanded && provider.status !== 'connected' && (
        <CredentialForm
          provider={provider}
          fields={provider.credentialFields}
          onSaved={() => { setExpanded(false); onChange(); }}
        />
      )}
    </Card>
  );
}

export function IntegrationsPage() {
  const [providers, setProviders] = useState<ProviderInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ status: string; provider: string; message?: string } | null>(null);

  const refresh = useCallback(() => {
    integrationsApi.listProviders().then(setProviders).catch((err) => setError(err.message));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Pick up ?integration=zoom&status=connected|error redirected back from the OAuth callback.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const integration = params.get('integration');
    const status = params.get('status');
    if (integration && status) {
      setBanner({ provider: integration, status, message: params.get('message') ?? undefined });
      window.history.replaceState({}, '', window.location.pathname);
      refresh();
    }
  }, [refresh]);

  const discordConnected = providers?.some((p) => p.id === 'discord' && p.status === 'connected');

  return (
    <main className="max-w-5xl mx-auto w-full px-4 py-6 space-y-5">
      <PageHeader
        title="Meeting platforms"
        description="Connect the platforms your team already meets on. Add each platform's app credentials, then connect your workspace through OAuth."
      />

      {banner && (
        <Banner tone={banner.status === 'connected' ? 'success' : 'danger'} icon={banner.status === 'connected' ? '✓' : '⚠'} onDismiss={() => setBanner(null)}>
          {banner.status === 'connected'
            ? `${banner.provider} is connected.`
            : `Couldn't connect ${banner.provider}${banner.message ? ` — ${banner.message}` : '.'}`}
        </Banner>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      {!providers ? (
        <Spinner label="Loading platforms…" />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {providers.map((p) => (
            <ProviderCard key={p.id} provider={p} onChange={refresh} />
          ))}
        </div>
      )}

      {discordConnected && <DiscordMeetingPanel />}
    </main>
  );
}
