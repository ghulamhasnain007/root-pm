/**
 * kafka/events.ts — Canonical Kafka event schema shared by both systems.
 *
 * Topics:
 *   agent-bridge.task-events     task created / closed / updated
 *   agent-bridge.meeting-events  meeting started / transcript / ended
 */

export const SCHEMA_VERSION = '1.0' as const;
export type SourceSystem = 'scrum-master-ai' | 'agent-bridge';

// ── Task events ───────────────────────────────────────────────────────────────

export interface TaskCreatedEvent {
  schemaVersion: typeof SCHEMA_VERSION;
  eventType: 'task.created';
  sourceSystem: SourceSystem;
  publishedAt: number;
  taskId: string;
  orgId: string;
  title: string;
  description?: string;
  assignee?: string;
  createdBy: string;
  sourceChannelId: string;
  meetingId?: string;
}

export interface TaskClosedEvent {
  schemaVersion: typeof SCHEMA_VERSION;
  eventType: 'task.closed';
  sourceSystem: SourceSystem;
  publishedAt: number;
  taskId: string;
  orgId: string;
  title: string;
  closedBy: string;
  closedAt: number;
  sourceChannelId: string;
  meetingId?: string;
}

export interface TaskUpdatedEvent {
  schemaVersion: typeof SCHEMA_VERSION;
  eventType: 'task.updated';
  sourceSystem: SourceSystem;
  publishedAt: number;
  taskId: string;
  orgId: string;
  /** Current title (after the change). Consumers use this to locate the
   *  mirrored item when only assignee/description/status changed. */
  title?: string;
  /** Title before the change — required for consumers to find the item
   *  when it was renamed (the old title still exists in Taiga). */
  previousTitle?: string;
  changes: Partial<{ title: string; description: string; assignee: string; status: 'open' | 'closed' }>;
  updatedBy: string;
  sourceChannelId: string;
}

// ── Meeting events ─────────────────────────────────────────────────────────────

export interface MeetingStartedEvent {
  schemaVersion: typeof SCHEMA_VERSION;
  eventType: 'meeting.started';
  sourceSystem: SourceSystem;
  publishedAt: number;
  meetingId: string;
  orgId: string;
  channelId: string;
  channelName: string;
  participants: Array<{ id: string; name: string }>;
  startedAt: number;
}

export interface MeetingTranscriptEvent {
  schemaVersion: typeof SCHEMA_VERSION;
  eventType: 'meeting.transcript';
  sourceSystem: SourceSystem;
  publishedAt: number;
  meetingId: string;
  orgId: string;
  channelId: string;
  role: 'user' | 'assistant';
  speakerName?: string;
  text: string;
  timestamp: number;
}

export interface MeetingEndedEvent {
  schemaVersion: typeof SCHEMA_VERSION;
  eventType: 'meeting.ended';
  sourceSystem: SourceSystem;
  publishedAt: number;
  meetingId: string;
  orgId: string;
  channelId: string;
  endedAt: number;
  durationMs: number;
  summary: {
    participantCount: number;
    participants: Array<{ id: string; name: string }>;
    transcriptLineCount: number;
    tasksCreated: string[];
    tasksClosed: string[];
    fullTranscript: Array<{ role: 'user' | 'assistant'; speakerName?: string; text: string; timestamp: number }>;
  };
}

export type TaskEvent = TaskCreatedEvent | TaskClosedEvent | TaskUpdatedEvent;
export type MeetingEvent = MeetingStartedEvent | MeetingTranscriptEvent | MeetingEndedEvent;
export type AnyBridgeEvent = TaskEvent | MeetingEvent;

// ── Config events (auth-service → bot managers) ──────────────────────────────

export interface ToolConfigUpdatedEvent {
  schemaVersion: typeof SCHEMA_VERSION;
  eventType: 'tool-config.updated';
  sourceSystem: 'auth-service';
  publishedAt: number;
  orgId: string;
  toolId: string;
  status: 'connected' | 'failed' | 'pending' | 'configured';
}

export interface ToolConfigRemovedEvent {
  schemaVersion: typeof SCHEMA_VERSION;
  eventType: 'tool-config.removed';
  sourceSystem: 'auth-service';
  publishedAt: number;
  orgId: string;
  toolId: string;
}

export type ToolConfigEvent = ToolConfigUpdatedEvent | ToolConfigRemovedEvent;

export const TOPICS = {
  TASK_EVENTS:    'agent-bridge.task-events',
  MEETING_EVENTS: 'agent-bridge.meeting-events',
  CONFIG_EVENTS:  'agent-bridge.config-events',
} as const;
