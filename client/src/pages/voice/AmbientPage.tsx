import { useCallback, useEffect, useRef, useState } from 'react';
import { ambientApi, discordMeetingApi, ApiError } from '../../lib/voiceApi.js';
import type { DiscordGuild } from '../../lib/voiceApi.js';
import type { AmbientChannelConfig, AmbientChannelInput, AmbientRoomStatus, AmbientTask } from '../../types/integrations.js';
import {
  Button, Card, PageHeader, SelectField, Switch, StatusBadge, Pill, EmptyState, Spinner, Chip,
} from '../../components/ui/index.js';

const STATUS_POLL_MS = 2_000;

function AmbientChannelForm({ guilds, onCreated, onCancel }: {
  guilds: DiscordGuild[];
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [guildId, setGuildId] = useState('');
  const [channelId, setChannelId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedGuild = guilds.find((g) => g.guildId === guildId);

  const submit = async () => {
    setError(null);
    if (!guildId || !channelId) {
      setError('Pick a server and voice channel.');
      return;
    }
    const input: AmbientChannelInput = { guildId, channelId, enabled: true };
    setSaving(true);
    try {
      await ambientApi.createChannel(input);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add this channel.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="space-y-4">
      <div>
        <h3 className="font-display text-[14px] font-semibold text-gray-100">New ambient channel</h3>
        <p className="text-[12px] text-gray-500 mt-1 leading-relaxed">
          The bot joins this voice channel and stays there — it only connects to Gemini once someone actually speaks,
          and only responds when it's directly addressed.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <SelectField label="Server" value={guildId} onChange={(e) => { setGuildId(e.target.value); setChannelId(''); }}>
          <option value="">Select a server…</option>
          {guilds.map((g) => <option key={g.guildId} value={g.guildId}>{g.guildName}</option>)}
        </SelectField>
        <SelectField label="Voice channel" value={channelId} onChange={(e) => setChannelId(e.target.value)} disabled={!selectedGuild}>
          <option value="">Select a channel…</option>
          {selectedGuild?.voiceChannels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </SelectField>
      </div>

      {error && <p className="text-[12px] text-red-400">{error}</p>}

      <div className="flex gap-2 pt-1">
        <Button variant="primary" fullWidth onClick={submit} disabled={saving}>
          {saving ? 'Adding…' : 'Add ambient channel'}
        </Button>
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </Card>
  );
}

function channelLabel(config: AmbientChannelConfig, guilds: DiscordGuild[] | null): { guildName: string; channelName: string } {
  const guild = guilds?.find((g) => g.guildId === config.guildId);
  const channel = guild?.voiceChannels.find((c) => c.id === config.channelId);
  return { guildName: guild?.guildName ?? config.guildId, channelName: channel?.name ?? config.channelId };
}

function AmbientChannelCard({ config, status, guilds, onChanged }: {
  config: AmbientChannelConfig;
  status: AmbientRoomStatus | undefined;
  guilds: DiscordGuild[] | null;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const { guildName, channelName } = channelLabel(config, guilds);

  const toggle = async (enabled: boolean) => {
    setBusy(true);
    try { await ambientApi.updateChannel(config.id, { enabled }); onChanged(); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true);
    try { await ambientApi.removeChannel(config.id); onChanged(); }
    finally { setBusy(false); }
  };

  const badge = !config.enabled
    ? { tone: 'neutral' as const, label: 'Disabled' }
    : !status
      ? { tone: 'warning' as const, label: 'Connecting…' }
      : status.sessionOpen
        ? { tone: 'live' as const, label: 'Session active' }
        : { tone: 'success' as const, label: 'Joined, listening' };

  return (
    <Card className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-[13px] font-semibold text-gray-100 truncate">{guildName}</h4>
          <p className="text-[12px] text-gray-400 mt-0.5">#{channelName}</p>
        </div>
        <StatusBadge tone={badge.tone} label={badge.label} pulse={badge.tone === 'live'} />
      </div>

      {status && (
        <div className="flex flex-wrap gap-1.5">
          <Pill>{status.knownHumanCount} in channel</Pill>
          {status.currentClaimHolder && <Pill tone="brand">Someone's speaking</Pill>}
          {status.taskActionsEnabled && <Pill>Task actions on</Pill>}
        </div>
      )}

      <div className="flex items-center gap-3 pt-1">
        <Switch checked={config.enabled} onChange={toggle} disabled={busy} label="Enabled" />
        <Button variant="ghost" size="sm" onClick={remove} disabled={busy} className="ml-auto !px-0 hover:text-red-400">
          Remove
        </Button>
      </div>
    </Card>
  );
}

function TaskHistory() {
  const [filter, setFilter] = useState<'open' | 'closed' | undefined>('open');
  const [tasks, setTasks] = useState<AmbientTask[] | null>(null);

  const refresh = useCallback(() => {
    ambientApi.listTasks(filter).then(setTasks).catch(() => setTasks([]));
  }, [filter]);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-[14px] font-semibold text-gray-100">Tasks</h3>
        <div className="flex gap-1.5">
          <Chip selected={filter === 'open'} onClick={() => setFilter('open')} className="px-2.5 py-1">Open</Chip>
          <Chip selected={filter === 'closed'} onClick={() => setFilter('closed')} className="px-2.5 py-1">Closed</Chip>
          <Chip selected={filter === undefined} onClick={() => setFilter(undefined)} className="px-2.5 py-1">All</Chip>
        </div>
      </div>

      {!tasks ? (
        <Spinner label="Loading tasks…" />
      ) : tasks.length === 0 ? (
        <EmptyState icon="✅" title="No tasks yet" description="Tasks created by voice ('create a task to…') show up here." />
      ) : (
        <div className="space-y-2">
          {tasks.map((t) => (
            <div key={t.id} className="flex items-start justify-between gap-3 px-3 py-2 bg-gray-800/50 rounded-lg">
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-gray-200 truncate">{t.title}</p>
                {t.description && <p className="text-[11px] text-gray-500 mt-0.5">{t.description}</p>}
                <p className="text-[10px] text-gray-600 mt-1">
                  by {t.createdBy}{t.assignee ? ` · for ${t.assignee}` : ''} · {new Date(t.createdAt).toLocaleString()}
                </p>
              </div>
              <Pill tone={t.status === 'open' ? 'brand' : 'neutral'}>{t.status}</Pill>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export function AmbientPage() {
  const [channels, setChannels] = useState<AmbientChannelConfig[] | null>(null);
  const [guilds, setGuilds] = useState<DiscordGuild[] | null>(null);
  const [statusByKey, setStatusByKey] = useState<Map<string, AmbientRoomStatus>>(new Map());
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshChannels = useCallback(() => {
    ambientApi.listChannels()
      .then(setChannels)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) setUnavailable(true);
        else setError(err instanceof Error ? err.message : "Couldn't load ambient channels.");
      });
  }, []);

  useEffect(() => {
    refreshChannels();
    discordMeetingApi.listGuilds().then(setGuilds).catch(() => setGuilds([]));
  }, [refreshChannels]);

  // Live status polling — same 2s cadence as the on-demand meeting panel.
  useEffect(() => {
    const poll = () => {
      ambientApi.status()
        .then(({ rooms }) => setStatusByKey(new Map(rooms.map((r) => [`${r.guildId}:${r.channelId}`, r]))))
        .catch(() => {});
    };
    poll();
    pollRef.current = setInterval(poll, STATUS_POLL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  if (unavailable) {
    return (
      <main className="max-w-3xl mx-auto w-full px-4 py-6">
        <EmptyState
          icon="🎙️"
          title="The ambient assistant isn't set up yet"
          description={<>This feature needs MongoDB and Discord configured — set <code className="text-gray-400">MONGODB_URI</code> and connect Discord on the Integrations tab.</>}
        />
      </main>
    );
  }

  const canAdd = guilds && guilds.length > 0;

  return (
    <main className="max-w-3xl mx-auto w-full px-4 py-6 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <PageHeader
          title="Ambient assistant"
          description="The bot stays in a voice channel full-time, listens for anyone speaking, and only responds when directly addressed — ask it questions, or have it create and close tasks."
        />
        {!showForm && canAdd && (
          <Button variant="primary" size="sm" onClick={() => setShowForm(true)} className="flex-shrink-0">
            + Add channel
          </Button>
        )}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {showForm && guilds && (
        <AmbientChannelForm guilds={guilds} onCreated={() => { setShowForm(false); refreshChannels(); }} onCancel={() => setShowForm(false)} />
      )}

      {guilds && guilds.length === 0 && !showForm && (
        <EmptyState
          icon="🔌"
          title="Connect Discord first"
          description="Add the bot to a server on the Integrations tab, then come back here to add an ambient channel."
        />
      )}

      {!channels ? (
        <Spinner label="Loading ambient channels…" />
      ) : channels.length === 0 && !showForm && canAdd ? (
        <EmptyState
          icon="🎙️"
          title="No ambient channel yet"
          description="Add a voice channel and the bot will join it and stay — no need to start anything manually."
          action={<Button variant="primary" size="sm" onClick={() => setShowForm(true)}>+ Add channel</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {channels?.map((c) => (
            <AmbientChannelCard
              key={c.id}
              config={c}
              status={statusByKey.get(`${c.guildId}:${c.channelId}`)}
              guilds={guilds}
              onChanged={refreshChannels}
            />
          ))}
        </div>
      )}

      {channels && channels.length > 0 && <TaskHistory />}
    </main>
  );
}
