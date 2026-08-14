/**
 * meeting/MeetingEventPublisher.ts
 * ────────────────────────────────
 * Hooks into the voice bot's existing transcript/meeting lifecycle
 * and publishes Kafka events. Wired in setupAmbient.ts alongside the
 * existing GeminiAmbientService callbacks.
 *
 * Design: purely additive — the existing meeting flow is unchanged.
 * All Kafka publishes are fire-and-forget with error logging.
 */
import type { KafkaBridgeProducer } from '../kafka/KafkaProducer.js';
import { TOPICS, SCHEMA_VERSION } from '../kafka/events.js';
import type {
  MeetingStartedEvent,
  MeetingTranscriptEvent,
  MeetingEndedEvent,
} from '../kafka/events.js';

export interface TranscriptLine {
  role: 'user' | 'assistant';
  speakerName?: string;
  text: string;
  timestamp: number;
}

export class MeetingEventPublisher {
  private currentMeetingId: string | undefined;
  private channelId: string;
  private channelName: string;
  private orgId: string;
  private startedAt: number = 0;
  private transcript: TranscriptLine[] = [];
  private tasksCreatedInMeeting: string[] = [];
  private tasksClosedInMeeting: string[] = [];

  constructor(
    private readonly producer: KafkaBridgeProducer,
    opts: { channelId: string; channelName: string; orgId: string },
  ) {
    this.channelId   = opts.channelId;
    this.channelName = opts.channelName;
    this.orgId       = opts.orgId;
  }

  // ── Called when a new ambient session starts (voice bot joins) ─────────────

  onMeetingStarted(meetingId: string, participants: Array<{ id: string; name: string }>): void {
    this.currentMeetingId = meetingId;
    this.startedAt = Date.now();
    this.transcript = [];
    this.tasksCreatedInMeeting = [];
    this.tasksClosedInMeeting = [];

    const event: MeetingStartedEvent = {
      schemaVersion: SCHEMA_VERSION,
      eventType:     'meeting.started',
      sourceSystem:  'scrum-master-ai',
      publishedAt:   Date.now(),
      meetingId,
      orgId:         this.orgId,
      channelId:     this.channelId,
      channelName:   this.channelName,
      participants,
      startedAt:     this.startedAt,
    };
    this.safePublish(TOPICS.MEETING_EVENTS, event);
  }

  // ── Called on every GeminiAmbientService onTranscript callback ─────────────

  onTranscript(role: 'user' | 'assistant', text: string, speakerName?: string): void {
    if (!this.currentMeetingId || !text.trim()) return;

    const line: TranscriptLine = { role, speakerName, text: text.trim(), timestamp: Date.now() };
    this.transcript.push(line);

    const event: MeetingTranscriptEvent = {
      schemaVersion: SCHEMA_VERSION,
      eventType:     'meeting.transcript',
      sourceSystem:  'scrum-master-ai',
      publishedAt:   Date.now(),
      meetingId:     this.currentMeetingId,
      orgId:         this.orgId,
      channelId:     this.channelId,
      role,
      speakerName,
      text:          text.trim(),
      timestamp:     line.timestamp,
    };
    this.safePublish(TOPICS.MEETING_EVENTS, event);
  }

  // ── Called when a task event is created/closed in this session ─────────────

  onTaskCreated(taskId: string): void {
    if (this.currentMeetingId) this.tasksCreatedInMeeting.push(taskId);
  }

  onTaskClosed(taskId: string): void {
    if (this.currentMeetingId) this.tasksClosedInMeeting.push(taskId);
  }

  // ── Called when the ambient session ends (voice bot leaves) ───────────────

  onMeetingEnded(participants: Array<{ id: string; name: string }>): void {
    if (!this.currentMeetingId) return;
    const endedAt = Date.now();

    const event: MeetingEndedEvent = {
      schemaVersion: SCHEMA_VERSION,
      eventType:     'meeting.ended',
      sourceSystem:  'scrum-master-ai',
      publishedAt:   endedAt,
      meetingId:     this.currentMeetingId,
      orgId:         this.orgId,
      channelId:     this.channelId,
      endedAt,
      durationMs:    endedAt - this.startedAt,
      summary: {
        participantCount:    participants.length,
        participants,
        transcriptLineCount: this.transcript.length,
        tasksCreated:        [...this.tasksCreatedInMeeting],
        tasksClosed:         [...this.tasksClosedInMeeting],
        fullTranscript:      this.transcript.map(l => ({
          role:        l.role,
          speakerName: l.speakerName,
          text:        l.text,
          timestamp:   l.timestamp,
        })),
      },
    };
    this.safePublish(TOPICS.MEETING_EVENTS, event);
    this.currentMeetingId = undefined;
  }

  /** Expose meetingId so KafkaTaskStore can tag tasks with it */
  getMeetingId(): string | undefined { return this.currentMeetingId; }

  private safePublish(topic: string, event: MeetingStartedEvent | MeetingTranscriptEvent | MeetingEndedEvent): void {
    const key = `${this.orgId}:${this.channelId}`;
    this.producer.publish(topic, event, key).catch(err => {
      console.error('[MeetingEventPublisher] Failed to publish', event.eventType, err?.message);
    });
  }
}
