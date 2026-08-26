import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AmbientChannelStore } from '../AmbientChannelStore.js';
import type { AmbientPresenceManager } from '../AmbientPresenceManager.js';
import type { AmbientChannelInput } from '../types.js';
import { requireAuth } from '../../../../auth/requireAuth.js';

function validate(body: Partial<AmbientChannelInput>): string[] {
  const missing: string[] = [];
  if (!body.guildId) missing.push('guildId');
  if (!body.channelId) missing.push('channelId');
  return missing;
}

export default function registerAmbientChannelRoutes(
  fastify: FastifyInstance,
  deps: { store: AmbientChannelStore; presence: AmbientPresenceManager }
): void {
  const { store, presence } = deps;

  fastify.get('/integrations/ambient/channels', { preHandler: requireAuth }, async (req: FastifyRequest) =>
    store.list(req.orgId!)
  );

  fastify.post('/integrations/ambient/channels', { preHandler: requireAuth }, async (req: FastifyRequest, reply) => {
    const body = (req.body ?? {}) as Partial<AmbientChannelInput>;
    const missing = validate(body);
    if (missing.length) return reply.code(400).send({ error: `Missing required field(s): ${missing.join(', ')}` });

    const created = await store.create(req.orgId!, {
      guildId: body.guildId!,
      channelId: body.channelId!,
      enabled: body.enabled ?? true,
    });
    await presence.syncConfig(created); // takes effect immediately, no restart needed
    return created;
  });

  fastify.patch('/integrations/ambient/channels/:id', { preHandler: requireAuth }, async (req: FastifyRequest, reply) => {
    const { id } = req.params as { id: string };
    const patch = (req.body ?? {}) as Partial<AmbientChannelInput>;
    const updated = await store.update(req.orgId!, id, patch);
    if (!updated) return reply.code(404).send({ error: 'Ambient channel config not found' });
    await presence.syncConfig(updated); // e.g. disabling leaves the channel immediately
    return updated;
  });

  fastify.delete('/integrations/ambient/channels/:id', { preHandler: requireAuth }, async (req: FastifyRequest) => {
    const { id } = req.params as { id: string };
    await presence.removeConfig(id);
    await store.delete(req.orgId!, id);
    return { deleted: true, id };
  });

  // ── Live status — which ambient rooms are actually connected right now,
  // and each room's activity/session diagnostics. ──
  fastify.get('/integrations/ambient/status', { preHandler: requireAuth }, async () => ({ rooms: presence.listActive() }));
}
