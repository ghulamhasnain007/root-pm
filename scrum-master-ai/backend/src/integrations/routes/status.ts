/**
 * integrations/routes/status.ts — Per-org connection status endpoint.
 * Returns the status of all Discord connections managed by BotConnectionManager.
 */
import type { FastifyInstance } from 'fastify';
import type { BotConnectionManager } from '../discord/BotConnectionManager.js';

export default function registerStatusRoutes(
  fastify: FastifyInstance,
  deps: { connectionManager: BotConnectionManager }
): void {
  fastify.get('/integrations/status', async () => {
    return { connections: deps.connectionManager.getStatus() };
  });
}
