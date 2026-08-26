import type {
  ProviderInfo, CredentialsResponse, ScheduledMeeting, ScheduledMeetingInput,
  AmbientChannelConfig, AmbientChannelInput, AmbientRoomStatus, AmbientTask,
} from '../types/integrations.js';
import { authFetch, ApiError } from './authFetch.js';

export { ApiError };

const API_BASE = import.meta.env.VITE_VOICE_API ?? '';

// Every call here now goes through authFetch — scrum-master-ai's routes
// require a valid auth-service JWT (see backend/src/auth/requireAuth.ts).
// This previously sent no Authorization header at all, which worked only
// because those routes didn't check for one either; now that both sides
// enforce it, this needed to change to match.
const req = <T>(path: string, init?: RequestInit): Promise<T> => authFetch(API_BASE, path, init);

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

  /**
   * Starts the OAuth connect flow. This used to be a plain `<a href>` GET
   * that the backend answered with a raw HTTP redirect — but a direct
   * browser navigation can't carry an Authorization header, and the
   * backend needs to know which org is connecting (to sign the right
   * orgId into the OAuth `state` parameter it verifies on callback). So
   * this is now a two-step flow: an authenticated fetch (this function)
   * that returns the provider's OAuth URL as JSON, then the caller
   * navigates the browser there itself — see IntegrationsPage.tsx's
   * connect handler. The callback route itself still needs no
   * authentication: it derives orgId from the signed `state` value it
   * gets back from the provider, not from a token.
   */
  connect: (provider: string) => req<{ url: string }>(`/integrations/${provider}/connect`),
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
