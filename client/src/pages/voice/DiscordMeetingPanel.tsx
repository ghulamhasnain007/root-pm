import { useCallback, useEffect, useRef, useState } from 'react';
import { discordMeetingApi, type DiscordGuild } from '../../lib/voiceApi.js';
import { StandupPanel } from '../../components/StandupPanel.js';
import { TranscriptPanel } from '../../components/TranscriptPanel.js';
import type { MeetingState } from '../../types/voice.js';
import { Card, Button, SelectField, Chip, StatusBadge } from '../../components/ui/index.js';

const POLL_MS = 2_000;
const DURATIONS = [
  { label: '5 min', ms: 5 * 60_000 },
  { label: '10 min', ms: 10 * 60_000 },
  { label: '15 min', ms: 15 * 60_000 },
];

export function DiscordMeetingPanel() {
  const [guilds, setGuilds] = useState<DiscordGuild[] | null>(null);
  const [guildId, setGuildId] = useState('');
  const [channelId, setChannelId] = useState('');
  const [duration, setDuration] = useState(DURATIONS[0].ms);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [meeting, setMeeting] = useState<MeetingState | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadGuilds = useCallback(() => {
    discordMeetingApi.listGuilds().then(setGuilds).catch((err) => setError(err.message));
  }, []);

  useEffect(() => { loadGuilds(); }, [loadGuilds]);

  const stopPolling = () => { if (pollRef.current) clearInterval(pollRef.current); pollRef.current = null; };

  const poll = useCallback((gId: string) => {
    stopPolling();
    pollRef.current = setInterval(() => {
      discordMeetingApi.status(gId).then(setMeeting).catch(() => {
        setMeeting(null);
        stopPolling();
      });
    }, POLL_MS);
  }, []);

  // On load, check whether a meeting is already running in any of the bot's
  // servers — e.g. one launched by a schedule rather than from this panel —
  // and pick it up automatically so there's always a way to see/stop it.
  useEffect(() => {
    discordMeetingApi.listActive().then(({ guildIds }) => {
      if (guildIds.length > 0) {
        setGuildId(guildIds[0]);
        discordMeetingApi.status(guildIds[0]).then(setMeeting).catch(() => {});
        poll(guildIds[0]);
      }
    }).catch(() => {});
  }, [poll]);

  useEffect(() => () => stopPolling(), []);

  const selectedGuild = guilds?.find((g) => g.guildId === guildId);

  const start = async () => {
    if (!guildId || !channelId) return;
    setBusy(true);
    setError(null);
    try {
      await discordMeetingApi.start(guildId, channelId, duration);
      poll(guildId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start the meeting.");
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (!guildId) return;
    setBusy(true);
    try {
      await discordMeetingApi.stop(guildId);
      stopPolling();
      setMeeting(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="space-y-4">
        <div>
          <h2 className="font-display text-[14px] font-semibold text-gray-100">Run a standup in Discord</h2>
          <p className="text-[12px] text-gray-500 mt-1 leading-relaxed">
            Pick a server and voice channel your team is already in, then start — the bot joins that channel
            and runs the standup live.
          </p>
        </div>

        {error && (
          <p className="text-[12px] text-red-400 bg-red-950/30 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
        )}

        {!guilds ? (
          <p className="text-[12px] text-gray-600">Loading your servers…</p>
        ) : guilds.length === 0 ? (
          <p className="text-[12px] text-gray-600">
            The bot isn't in any servers yet — connect Discord above, then invite it to a server.
          </p>
        ) : !meeting?.isActive ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <SelectField label="Server" value={guildId} onChange={(e) => { setGuildId(e.target.value); setChannelId(''); }}>
                <option value="">Select a server…</option>
                {guilds.map((g) => <option key={g.guildId} value={g.guildId}>{g.guildName}</option>)}
              </SelectField>
              <SelectField label="Voice channel" value={channelId} onChange={(e) => setChannelId(e.target.value)} disabled={!selectedGuild}>
                <option value="">Select a channel…</option>
                {selectedGuild?.voiceChannels.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} ({c.memberCount} in call)</option>
                ))}
              </SelectField>
            </div>

            <div className="flex gap-2">
              {DURATIONS.map((d) => (
                <Chip key={d.ms} selected={duration === d.ms} onClick={() => setDuration(d.ms)} className="flex-1 py-1.5 text-center">
                  {d.label}
                </Chip>
              ))}
            </div>

            <Button variant="primary" fullWidth onClick={start} disabled={busy || !guildId || !channelId}>
              {busy ? 'Starting…' : '▶ Start standup in Discord'}
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between px-3 py-2 bg-live-subtle border border-live/25 rounded-lg">
            <div className="flex items-center gap-2">
              <StatusBadge tone="live" label={`Live in ${selectedGuild?.guildName ?? 'Discord'} — ${meeting.phase}`} />
            </div>
            <Button variant="danger" size="sm" onClick={stop} disabled={busy}>■ Stop</Button>
          </div>
        )}
      </Card>

      {meeting?.isActive && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <StandupPanel
            participants={meeting.participants}
            standups={meeting.standups}
            phase={meeting.phase}
            currentSpeakerId={meeting.currentSpeakerId}
          />
          <div className="h-[420px]">
            <TranscriptPanel entries={meeting.transcript} isAiSpeaking={false} participants={meeting.participants} />
          </div>
        </div>
      )}

      {meeting?.diagnostics && (
        <details className="text-[11px] text-gray-600 border border-gray-800 rounded-lg px-3 py-2">
          <summary className="cursor-pointer text-gray-500 hover:text-gray-300 font-medium">
            Audio diagnostics
          </summary>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
            <span>Decoded: {meeting.diagnostics.packetsDecoded}</span>
            <span>Peak level: {meeting.diagnostics.peakLevel.toFixed(3)}</span>
            <span>To Gemini: {meeting.diagnostics.chunksSentToGemini}</span>
            <span>Dropped (gate): {meeting.diagnostics.chunksDroppedByGate}</span>
            <span>To Discord: {meeting.diagnostics.chunksSentToDiscord}</span>
            <span>Resubscribes: {meeting.diagnostics.resubscribes}</span>
            <span>AI speaking: {meeting.diagnostics.aiSpeaking ? 'yes' : 'no'}</span>
            <span>Silence: {meeting.diagnostics.silenceSeconds}s</span>
          </div>
        </details>
      )}
    </div>
  );
}
