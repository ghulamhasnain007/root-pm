import { useCallback, useEffect, useState } from 'react';
import { scheduleApi, discordMeetingApi, ApiError } from '../../lib/voiceApi.js';
import type { DiscordGuild } from '../../lib/voiceApi.js';
import type { ScheduledMeeting, ScheduledMeetingInput, ScheduleRecurrence, WeekdayShort } from '../../types/integrations.js';
import {
  Button, Card, PageHeader, Field, SelectField, Switch, Pill, EmptyState, Spinner, Chip,
} from '../../components/ui/index.js';

const WEEKDAYS: WeekdayShort[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DURATIONS = [
  { label: '5 min', ms: 5 * 60_000 },
  { label: '10 min', ms: 10 * 60_000 },
  { label: '15 min', ms: 15 * 60_000 },
];
const COMMON_TIMEZONES = [
  Intl.DateTimeFormat().resolvedOptions().timeZone,
  'UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London',
  'Europe/Berlin', 'Asia/Karachi', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney',
].filter((tz, i, arr) => arr.indexOf(tz) === i);

function describeRecurrence(s: ScheduledMeeting): string {
  const time = `${s.time} (${s.timezone})`;
  switch (s.recurrence) {
    case 'once': return `Once on ${s.date} at ${time}`;
    case 'daily': return `Every day at ${time}`;
    case 'weekdays': return `Every weekday (Mon–Fri) at ${time}`;
    case 'weekly': return `Every ${(s.daysOfWeek ?? []).join(', ')} at ${time}`;
  }
}

function ScheduleForm({ guilds, onCreated, onCancel }: {
  guilds: DiscordGuild[];
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('Daily Standup');
  const [guildId, setGuildId] = useState('');
  const [channelId, setChannelId] = useState('');
  const [recurrence, setRecurrence] = useState<ScheduleRecurrence>('weekdays');
  const [days, setDays] = useState<WeekdayShort[]>(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('09:30');
  const [timezone, setTimezone] = useState(COMMON_TIMEZONES[0]);
  const [duration, setDuration] = useState(DURATIONS[0].ms);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedGuild = guilds.find((g) => g.guildId === guildId);

  const toggleDay = (d: WeekdayShort) => {
    setDays((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]);
  };

  const submit = async () => {
    setError(null);
    if (!title.trim() || !guildId || !channelId || !time || !timezone) {
      setError('Fill in every field before saving.');
      return;
    }
    if (recurrence === 'weekly' && days.length === 0) {
      setError('Pick at least one day of the week.');
      return;
    }
    if (recurrence === 'once' && !date) {
      setError('Pick a date for a one-time meeting.');
      return;
    }

    const input: ScheduledMeetingInput = {
      title: title.trim(),
      provider: 'discord',
      guildId,
      channelId,
      guildName: selectedGuild?.guildName,
      channelName: selectedGuild?.voiceChannels.find((c) => c.id === channelId)?.name,
      recurrence,
      time,
      timezone,
      daysOfWeek: recurrence === 'weekly' ? days : undefined,
      date: recurrence === 'once' ? date : undefined,
      durationMs: duration,
      enabled: true,
    };

    setSaving(true);
    try {
      await scheduleApi.create(input);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create this schedule.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="space-y-4">
      <h3 className="font-display text-[14px] font-semibold text-gray-100">New scheduled standup</h3>

      <Field label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />

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

      <div className="space-y-1.5">
        <label className="text-[11px] font-medium text-gray-400">Repeats</label>
        <div className="flex gap-2 flex-wrap">
          {(['once', 'daily', 'weekdays', 'weekly'] as ScheduleRecurrence[]).map((r) => (
            <Chip key={r} selected={recurrence === r} onClick={() => setRecurrence(r)} className="px-3 py-1.5 capitalize">
              {r === 'once' ? 'One time' : r}
            </Chip>
          ))}
        </div>
      </div>

      {recurrence === 'weekly' && (
        <div className="flex gap-1.5 flex-wrap">
          {WEEKDAYS.map((d) => (
            <Chip key={d} selected={days.includes(d)} onClick={() => toggleDay(d)} className="w-10 h-8">
              {d}
            </Chip>
          ))}
        </div>
      )}

      {recurrence === 'once' && (
        <Field label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        <SelectField label="Timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
          {COMMON_TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
        </SelectField>
      </div>

      <div className="space-y-1.5">
        <label className="text-[11px] font-medium text-gray-400">Meeting length</label>
        <div className="flex gap-2">
          {DURATIONS.map((d) => (
            <Chip key={d.ms} selected={duration === d.ms} onClick={() => setDuration(d.ms)} className="flex-1 py-1.5 text-center">
              {d.label}
            </Chip>
          ))}
        </div>
      </div>

      {error && <p className="text-[12px] text-red-400">{error}</p>}

      <div className="flex gap-2 pt-1">
        <Button variant="primary" fullWidth onClick={submit} disabled={saving}>
          {saving ? 'Saving…' : 'Save schedule'}
        </Button>
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </Card>
  );
}

function ScheduleCard({ schedule, onChanged }: { schedule: ScheduledMeeting; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);

  const toggle = async (enabled: boolean) => {
    setBusy(true);
    try { await scheduleApi.update(schedule.id, { enabled }); onChanged(); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true);
    try { await scheduleApi.remove(schedule.id); onChanged(); }
    finally { setBusy(false); }
  };

  return (
    <Card className="!p-4 flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h4 className="text-[13px] font-semibold text-gray-100 truncate">{schedule.title}</h4>
          {!schedule.enabled && <Pill>Paused</Pill>}
        </div>
        <p className="text-[12px] text-gray-400 mt-0.5">{describeRecurrence(schedule)}</p>
        <p className="text-[11px] text-gray-600 mt-0.5">
          {schedule.guildName ?? schedule.guildId} → #{schedule.channelName ?? schedule.channelId}
        </p>
        {schedule.lastRunAt && (
          <p className={`text-[10px] font-mono mt-1 ${schedule.lastStatus === 'error' ? 'text-red-400' : 'text-gray-600'}`}>
            Last run {new Date(schedule.lastRunAt).toLocaleString()}
            {schedule.lastStatus === 'error' && schedule.lastError ? ` — ${schedule.lastError}` : ''}
          </p>
        )}
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <Switch checked={schedule.enabled} onChange={toggle} disabled={busy} />
        <Button variant="ghost" size="sm" onClick={remove} disabled={busy} className="!px-0 hover:text-red-400">
          Delete
        </Button>
      </div>
    </Card>
  );
}

export function SchedulePage() {
  const [schedules, setSchedules] = useState<ScheduledMeeting[] | null>(null);
  const [guilds, setGuilds] = useState<DiscordGuild[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const refresh = useCallback(() => {
    scheduleApi.list()
      .then(setSchedules)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) setUnavailable(true);
        else setError(err instanceof Error ? err.message : "Couldn't load your schedules.");
      });
  }, []);

  useEffect(() => {
    refresh();
    discordMeetingApi.listGuilds().then(setGuilds).catch(() => setGuilds([]));
  }, [refresh]);

  if (unavailable) {
    return (
      <main className="max-w-3xl mx-auto w-full px-4 py-6">
        <EmptyState
          icon="🗓️"
          title="Scheduling isn't set up yet"
          description={<>This feature needs MongoDB configured — set <code className="text-gray-400">MONGODB_URI</code> in the backend's .env file.</>}
        />
      </main>
    );
  }

  const canSchedule = guilds && guilds.length > 0;

  return (
    <main className="max-w-3xl mx-auto w-full px-4 py-6 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <PageHeader
          title="Scheduled standups"
          description="Pick a day and time — the bot joins your Discord voice channel on its own and runs the standup."
        />
        {!showForm && canSchedule && (
          <Button variant="primary" size="sm" onClick={() => setShowForm(true)} className="flex-shrink-0">
            + New schedule
          </Button>
        )}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {showForm && guilds && (
        <ScheduleForm guilds={guilds} onCreated={() => { setShowForm(false); refresh(); }} onCancel={() => setShowForm(false)} />
      )}

      {guilds && guilds.length === 0 && !showForm && (
        <EmptyState
          icon="🔌"
          title="Connect Discord first"
          description="Add the bot to a server on the Integrations tab, then come back here to schedule a standup."
        />
      )}

      {!schedules ? (
        <Spinner label="Loading schedules…" />
      ) : schedules.length === 0 && !showForm && canSchedule ? (
        <EmptyState
          icon="✨"
          title="No standups scheduled"
          description="Set a day and time and the bot will show up on its own — no manual starting needed."
          action={<Button variant="primary" size="sm" onClick={() => setShowForm(true)}>+ New schedule</Button>}
        />
      ) : (
        <div className="space-y-3">
          {schedules?.map((s) => <ScheduleCard key={s.id} schedule={s} onChanged={refresh} />)}
        </div>
      )}
    </main>
  );
}
