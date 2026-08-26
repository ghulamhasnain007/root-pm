import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { TaskStore } from '../../../../services/tasks/TaskStore.js';
import { requireAuth } from '../../../../auth/requireAuth.js';

/** Read-only for now — tasks are created/closed by voice, not through the
 *  API. Gives the admin UI (and manual testing) a way to see task history. */
export default function registerAmbientTaskRoutes(fastify: FastifyInstance, deps: { store: TaskStore }): void {
  fastify.get('/integrations/ambient/tasks', { preHandler: requireAuth }, async (req: FastifyRequest) => {
    const { status } = req.query as { status?: 'open' | 'closed' };
    return deps.store.list(req.orgId!, status);
  });
}
