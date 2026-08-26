import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { CredentialsStore } from '../store/CredentialsStore.js';
import { getDiscordClient, listGuildVoiceChannels } from '../discord/DiscordBotClient.js';
import { startDiscordMeeting, stopDiscordMeeting, getDiscordMeeting, listActiveDiscordMeetings } from '../discord/DiscordMeetingManager.js';
import { requireAuth } from '../../auth/requireAuth.js';

export default function registerDiscordMeetingRoutes(
  fastify: FastifyInstance,
  deps: { credentialsStore: CredentialsStore }
): void {
  const { credentialsStore } = deps;

  async function getBotToken(orgId: string): Promise<string> {
    const creds = await credentialsStore.get(orgId, 'discord');
    if (!creds?.botToken) {
      throw new Error('Discord is not configured yet — add its credentials on the Integrations tab first.');
    }
    return creds.botToken;
  }

  // ── List servers + voice channels the bot can join ───────────────────────────
  fastify.get('/integrations/discord/guilds', { preHandler: requireAuth }, async (req: FastifyRequest, reply) => {
    try {
      const botToken = await getBotToken(req.orgId!);
      return await listGuildVoiceChannels(botToken);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : 'Failed to list Discord servers' });
    }
  });

  // ── Start a standup in a specific server + voice channel ─────────────────────
  fastify.post('/integrations/discord/meetings/start', { preHandler: requireAuth }, async (req: FastifyRequest, reply) => {
    const { guildId, channelId, durationMs } = (req.body ?? {}) as {
      guildId?: string; channelId?: string; durationMs?: number;
    };
    if (!guildId || !channelId) return reply.code(400).send({ error: 'guildId and channelId are required' });

    try {
      const botToken = await getBotToken(req.orgId!);
      const client = await getDiscordClient(botToken);
      await startDiscordMeeting(client, guildId, channelId, durationMs);
      return { started: true, guildId, channelId };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : 'Failed to start the meeting' });
    }
  });

  // ── Stop the active standup in a server ──────────────────────────────────────
  fastify.post('/integrations/discord/meetings/stop', { preHandler: requireAuth }, async (req: FastifyRequest, reply) => {
    // NOTE: no ownership check that `guildId` actually belongs to req.orgId
    // — DiscordMeetingManager's active-meeting registry is keyed by guildId
    // globally, with no guildId→orgId mapping at that layer today. In
    // practice a caller would need to already know a specific guildId
    // (Discord's own IDs, not enumerable/guessable) to target it, but this
    // isn't the same as an explicit per-org authorization check. Worth
    // tightening if DiscordMeetingManager ever tracks which org owns each
    // active meeting — out of scope for the auth wiring done here.
    const { guildId } = (req.body ?? {}) as { guildId?: string };
    if (!guildId) return reply.code(400).send({ error: 'guildId is required' });
    await stopDiscordMeeting(guildId);
    return { stopped: true, guildId };
  });

  // ── Which servers currently have a meeting running (for UI auto-discovery) ──
  fastify.get('/integrations/discord/meetings/active', { preHandler: requireAuth }, async () => {
    // Same caveat as stopDiscordMeeting above — this returns active
    // meetings across ALL orgs' guilds, not filtered to the caller's own
    // org, since that mapping doesn't exist in DiscordMeetingManager yet.
    return { guildIds: listActiveDiscordMeetings() };
  });

  // ── Poll current meeting state (participants, phase, standup data, transcript) ─
  fastify.get('/integrations/discord/meetings/:guildId/status', { preHandler: requireAuth }, async (req: FastifyRequest, reply) => {
    const { guildId } = req.params as { guildId: string };
    const room = getDiscordMeeting(guildId);
    if (!room) return reply.code(404).send({ error: 'No active meeting in that server' });
    return room.getState();
  });
}
