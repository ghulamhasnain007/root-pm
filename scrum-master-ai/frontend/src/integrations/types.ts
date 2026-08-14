export type IntegrationCapability =
  | 'oauth_connect' | 'webhook_events' | 'realtime_audio' | 'transcript_fetch' | 'bot_join';

export interface CredentialField {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  placeholder?: string;
  helpText?: string;
}

export interface ProviderInfo {
  id: string;
  displayName: string;
  capabilities: IntegrationCapability[];
  docsUrl?: string;
  notes?: string;
  requiresAdvancedSetup: boolean;
  credentialFields: CredentialField[];
  configured: boolean;
  status: 'connected' | 'disconnected' | 'error' | 'pending';
  enabled: boolean;
  connectedAt: number | null;
  lastError: string | null;
}

export interface CredentialsResponse {
  configured: boolean;
  values: Record<string, string>;
  secretsSet?: string[];
}

export type ScheduleRecurrence = 'once' | 'daily' | 'weekdays' | 'weekly';
export type WeekdayShort = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';

export interface ScheduledMeeting {
  id: string;
  orgId: string;
  title: string;
  provider: 'discord';
  guildId: string;
  channelId: string;
  guildName?: string;
  channelName?: string;
  recurrence: ScheduleRecurrence;
  time: string;
  timezone: string;
  daysOfWeek?: WeekdayShort[];
  date?: string;
  durationMs: number;
  enabled: boolean;
  lastRunAt: number | null;
  lastRunDateKey: string | null;
  lastStatus: 'idle' | 'launched' | 'error';
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}

export type ScheduledMeetingInput = Omit<
  ScheduledMeeting,
  'id' | 'orgId' | 'lastRunAt' | 'lastRunDateKey' | 'lastStatus' | 'lastError' | 'createdAt' | 'updatedAt'
>;

// ── Ambient assistant ──────────────────────────────────────────────────────

export interface AmbientChannelConfig {
  id: string;
  orgId: string;
  guildId: string;
  channelId: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export type AmbientChannelInput = Omit<AmbientChannelConfig, 'id' | 'orgId' | 'createdAt' | 'updatedAt'>;

export interface AmbientRoomStatus {
  guildId: string;
  channelId: string;
  connectionStatus: string;
  knownHumanCount: number;
  lastSpeakingAt: number | null;
  sessionOpen: boolean;
  currentClaimHolder: string | null;
  lastIdleClosedAt: number | null;
  taskActionsEnabled: boolean;
}

export interface AmbientTask {
  id: string;
  orgId: string;
  title: string;
  description?: string;
  assignee?: string;
  status: 'open' | 'closed';
  createdBy: string;
  createdAt: number;
  closedAt: number | null;
  sourceChannelId: string;
}
