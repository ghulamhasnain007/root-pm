import Fastify from 'fastify';
import FastifyCors from '@fastify/cors';
import FastifyRawBody from 'fastify-raw-body';
import { config } from './config/index.js';
import { setupIntegrations } from './integrations/index.js';
import { BotConnectionManager } from './integrations/discord/BotConnectionManager.js';
import { startConfigConsumer, onConfigEvent } from './kafka/consumer.js';
import { registerToolConfigHandlers } from './kafka/consumers/ToolConfigConsumer.js';
import registerStatusRoutes from './integrations/routes/status.js';

const fastify = Fastify({
  logger: {
    level: 'info',
    transport: { target: 'pino-pretty', options: { colorize: true } },
  },
});

async function bootstrap() {
  await fastify.register(FastifyCors, {
    origin: config.corsOrigin,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // Needed for provider webhook signature verification (Zoom/Discord hash
  // the exact raw bytes received) — only applied to routes that opt in via
  // `{ config: { rawBody: true } }`, so it doesn't affect anything else.
  await fastify.register(FastifyRawBody, {
    field: 'rawBody',
    global: false,
    runFirst: true,
    encoding: false,
  });

  fastify.get('/health', async () => ({ status: 'ok', timestamp: Date.now() }));

  // ── Multi-org bot connection manager ──────────────────────────────────
  const connectionManager = new BotConnectionManager();

  // Discover orgs and establish connections on startup
  const authServiceUrl = process.env.AUTH_SERVICE_URL;
  const internalKey = process.env.AUTH_SERVICE_INTERNAL_KEY;
  if (authServiceUrl && internalKey) {
    try {
      await connectionManager.discoverAndConnect(authServiceUrl, internalKey);
      console.log(`[scrum-master-ai] Bot connection manager: ${connectionManager.getStatus().length} org(s) connected`);
    } catch (err) {
      console.error('[scrum-master-ai] Failed to discover orgs from auth-service:', err);
    }
  } else {
    console.warn('[scrum-master-ai] AUTH_SERVICE_URL not set — multi-org discovery disabled');
  }

  // Register config event handlers for live updates
  if (process.env.KAFKA_BROKERS && authServiceUrl && internalKey) {
    registerToolConfigHandlers(connectionManager, authServiceUrl, internalKey);
    startConfigConsumer(process.env.KAFKA_BROKERS.split(',').map(b => b.trim()))
      .catch(err => console.warn('[scrum-master-ai] Kafka config consumer failed:', err));
  }

  // Register status routes
  registerStatusRoutes(fastify, { connectionManager });

  await setupIntegrations(fastify);

  await fastify.listen({ port: config.port, host: config.host });

//   console.log(`
// 🤖  AI Scrum Master — Gemini Live Backend
//     HTTP  → http://${config.host}:${config.port}
//     Model → ${config.geminiModel}
//     Integrations → http://${config.host}:${config.port}/integrations/providers

//     Meetings run through Discord (on-demand or scheduled) — see /integrations.
// `);
}

bootstrap().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
