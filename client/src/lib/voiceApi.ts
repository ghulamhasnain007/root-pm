import type {
  ProviderInfo, CredentialsResponse, ScheduledMeeting, ScheduledMeetingInput,
  AmbientChannelConfig, AmbientChannelInput, AmbientRoomStatus, AmbientTask,
} from '../types/integrations.js';

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

const API_BASE = import.meta.env.VITE_VOICE_API ?? '';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);

  if (init?.body != null) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.error ?? `Request to ${path} failed (${res.status})`, res.status);
  }

  return res.json() as Promise<T>;
}

export const integrationsApi = {
  listProviders: () => req<ProviderInfo[]>('/integrations/providers'),

  getCredentials: (provider: string) =>
    req<CredentialsResponse>(`/integrations/${provider}/credentials`),

  saveCredentials: (provider: string, values: Record<string, string>) =>
    req<{ provider: string; configured: boolean }>(`/integrations/${provider}/credentials`, {
      method: 'POST',
      body: JSON.stringify(values),
    }),

  clearCredentials: (provider: string) =>
    req<{ provider: string; configured: boolean }>(`/integrations/${provider}/credentials`, {
      method: 'DELETE',
    }),

  toggle: (provider: string, enabled: boolean) =>
    req<{ provider: string; enabled: boolean }>(`/integrations/${provider}/toggle`, {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }),

  disconnect: (provider: string) =>
    req<{ provider: string; disconnected: boolean }>(`/integrations/${provider}`, {
      method: 'DELETE',
    }),

  /** Not a fetch — this navigates the whole page through the OAuth consent screen. */
  connectUrl: (provider: string) => `${API_BASE}/integrations/${provider}/connect`,
};

export interface DiscordVoiceChannel { id: string; name: string; memberCount: number }
export interface DiscordGuild { guildId: string; guildName: string; voiceChannels: DiscordVoiceChannel[] }

export const discordMeetingApi = {
  listGuilds: () => req<DiscordGuild[]>('/integrations/discord/guilds'),

  listActive: () => req<{ guildIds: string[] }>('/integrations/discord/meetings/active'),

  start: (guildId: string, channelId: string, durationMs?: number) =>
    req<{ started: boolean }>('/integrations/discord/meetings/start', {
      method: 'POST',
      body: JSON.stringify({ guildId, channelId, durationMs }),
    }),

  stop: (guildId: string) =>
    req<{ stopped: boolean }>('/integrations/discord/meetings/stop', {
      method: 'POST',
      body: JSON.stringify({ guildId }),
    }),

  status: (guildId: string) => req<import('../types/voice.js').MeetingState>(`/integrations/discord/meetings/${guildId}/status`),
};

export const scheduleApi = {
  list: () => req<ScheduledMeeting[]>('/integrations/schedules'),

  create: (input: ScheduledMeetingInput) =>
    req<ScheduledMeeting>('/integrations/schedules', { method: 'POST', body: JSON.stringify(input) }),

  update: (id: string, patch: Partial<ScheduledMeetingInput> & { enabled?: boolean }) =>
    req<ScheduledMeeting>(`/integrations/schedules/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  remove: (id: string) =>
    req<{ deleted: boolean }>(`/integrations/schedules/${id}`, { method: 'DELETE' }),
};

export const ambientApi = {
  listChannels: () => req<AmbientChannelConfig[]>('/integrations/ambient/channels'),

  createChannel: (input: AmbientChannelInput) =>
    req<AmbientChannelConfig>('/integrations/ambient/channels', { method: 'POST', body: JSON.stringify(input) }),

  updateChannel: (id: string, patch: Partial<AmbientChannelInput>) =>
    req<AmbientChannelConfig>(`/integrations/ambient/channels/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  removeChannel: (id: string) =>
    req<{ deleted: boolean }>(`/integrations/ambient/channels/${id}`, { method: 'DELETE' }),

  status: () => req<{ rooms: AmbientRoomStatus[] }>('/integrations/ambient/status'),

  listTasks: (status?: 'open' | 'closed') =>
    req<AmbientTask[]>(`/integrations/ambient/tasks${status ? `?status=${status}` : ''}`),
};
