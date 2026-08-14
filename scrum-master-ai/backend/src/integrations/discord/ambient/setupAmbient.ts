import type { FastifyInstance } from 'fastify';
import type { Client } from 'discord.js';
import { MongoAmbientChannelStore } from './store/MongoAmbientChannelStore.js';
import { AmbientPresenceManager } from './AmbientPresenceManager.js';
import registerAmbientChannelRoutes from './routes/ambientChannels.js';
import registerAmbientTaskRoutes from './routes/ambientTasks.js';

import { MongoTaskStore } from '../../../services/tasks/MongoTaskStore.js';
import {
  AMBIENT_TASK_TOOLS,
  handleAmbientFunctionCall,
} from './taskActions.js';

// ── Kafka integration ────────────────────────────────────────────────────────
import { getOrCreateProducer } from '../../../kafka/setupKafka.js';
import { KafkaTaskStore } from '../../../tasks/KafkaTaskStore.js';
import { MeetingEventPublisher } from '../../../meeting/MeetingEventPublisher.js';
import { v4 as uuidv4 } from 'uuid';

// Matches the single-org simplification used throughout the integrations
// module.
const ORG_ID = 'default';

/**
 * Wires the ambient-assistant module into the existing Fastify app.
 *
 * Features:
 * - Discord voice presence
 * - Speaking-trigger detection
 * - Per-speaker subscriptions
 * - Gemini AUDIO-mode session
 * - Ambient task actions
 * - MongoDB task persistence
 * - Optional Kafka task events
 * - Optional Kafka meeting lifecycle/transcript events
 *
 * Kafka is optional:
 * - If KAFKA_BROKERS is configured, KafkaTaskStore is used and meeting
 *   events are published to Kafka.
 * - If KAFKA_BROKERS is not configured, the existing MongoTaskStore is used
 *   and the ambient assistant continues to work without Kafka.
 */
export async function setupAmbientAssistant(
  fastify: FastifyInstance,
  deps: { discordClient: Client }
): Promise<void> {
  const channelStore = new MongoAmbientChannelStore();

  // ── Kafka setup ───────────────────────────────────────────────────────────
  //
  // getOrCreateProducer() should return null when KAFKA_BROKERS is not
  // configured, allowing the existing Mongo-only behavior to continue.
  const kafkaProducer = await getOrCreateProducer();

  // ── Meeting event publisher ───────────────────────────────────────────────
  //
  // Publishes:
  //   meeting.started
  //   meeting.transcript
  //   meeting.ended
  //
  // The initial channel values are placeholders. They are updated when an
  // ambient session actually starts.
  const meetingPublisher = kafkaProducer
    ? new MeetingEventPublisher(kafkaProducer, {
        channelId: 'ambient',
        channelName: 'ambient',
        orgId: ORG_ID,
      })
    : null;

  // ── Task store ────────────────────────────────────────────────────────────
  //
  // KafkaTaskStore is intended to be a drop-in replacement for
  // MongoTaskStore:
  //
  //   create/update/close -> MongoDB
  //                         +
  //                         Kafka event
  //
  // Without Kafka, preserve the original Mongo-only behavior.
  const taskStore = kafkaProducer
    ? new KafkaTaskStore(
        kafkaProducer,
        ORG_ID,
        () => meetingPublisher?.getMeetingId()
      )
    : new MongoTaskStore();

  // ── Task action handler ───────────────────────────────────────────────────
  //
  // Keep the existing taskActions implementation as the source of truth.
  // We only wrap it so task-created/task-closed events can be associated
  // with the current meeting.
  const originalHandle = (call: any, ctx: any) =>
    handleAmbientFunctionCall(
      taskStore,
      ORG_ID,
      ctx.channelId,
      ctx.speakerName,
      call
    );

  const instrumentedHandle = async (call: any, ctx: any) => {
    const result = await originalHandle(call, ctx);

    if (meetingPublisher && 'task' in result && result.task) {
      if (call.name === 'create_task') {
        meetingPublisher.onTaskCreated(result.task.id);
      }

      if (call.name === 'close_task') {
        meetingPublisher.onTaskClosed(result.task.id);
      }
    }

    return result;
  };

  // ── Ambient presence manager ──────────────────────────────────────────────
  const presence = new AmbientPresenceManager(
    deps.discordClient,
    channelStore,
    {
      declarations: AMBIENT_TASK_TOOLS,

      handle: instrumentedHandle,

      // ── Transcript → Kafka ──────────────────────────────────────────────
      onTranscript: (
        role: 'user' | 'assistant',
        text: string,
        speakerName?: string
      ) => {
        meetingPublisher?.onTranscript(role, text, speakerName);
      },

      // ── Session started → meeting.started ───────────────────────────────
      onSessionStarted: (
        channelId: string,
        channelName: string,
        participants: Array<{ id: string; name: string }>
      ) => {
        if (!meetingPublisher) {
          return;
        }

        // MeetingEventPublisher was created before the actual Discord
        // session existed, so update the channel context for this session.
        //
        // If MeetingEventPublisher exposes a public setter in the future,
        // use that instead of this assignment.
        (meetingPublisher as any).channelId = channelId;
        (meetingPublisher as any).channelName = channelName;

        const meetingId = uuidv4();

        meetingPublisher.onMeetingStarted(
          meetingId,
          participants
        );
      },

      // ── Session ended → meeting.ended ──────────────────────────────────
      onSessionEnded: (
        participants: Array<{ id: string; name: string }>
      ) => {
        meetingPublisher?.onMeetingEnded(participants);
      },
    }
  );

  // ── Start Discord/Gemini presence ─────────────────────────────────────────
  await presence.start();

  // ── HTTP routes ────────────────────────────────────────────────────────────
  registerAmbientChannelRoutes(fastify, {
    store: channelStore,
    presence,
  });

  registerAmbientTaskRoutes(fastify, {
    store: taskStore,
  });

  // ── Startup logging ────────────────────────────────────────────────────────
  fastify.log.info(
    kafkaProducer
      ? '[integrations] ambient assistant enabled (presence + Gemini + task actions + Kafka events)'
      : '[integrations] ambient assistant enabled (presence + Gemini + task actions, Kafka disabled)'
  );
}