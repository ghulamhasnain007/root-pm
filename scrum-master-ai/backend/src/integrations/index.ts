import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import { providerRegistry } from './ProviderRegistry.js';
import { allProviderFactories } from './adapters/factories.js';
import { TokenCipher } from './crypto/TokenCipher.js';
import type { IntegrationStore } from './store/IntegrationStore.js';
import type { CredentialsStore } from './store/CredentialsStore.js';
import { FileIntegrationStore } from './store/FileIntegrationStore.js';
import { FileCredentialsStore } from './store/FileCredentialsStore.js';
import { connectMongo } from './store/mongo/connection.js';
import { MongoIntegrationStore } from './store/mongo/MongoIntegrationStore.js';
import { MongoCredentialsStore } from './store/mongo/MongoCredentialsStore.js';
import { AuthServiceClient } from './store/AuthServiceClient.js';
import { AuthServiceCredentialsStore } from './store/AuthServiceCredentialsStore.js';
import { OAuthService } from './OAuthService.js';
import registerIntegrationRoutes from './routes/integrations.js';
import registerDiscordMeetingRoutes from './routes/discordMeetings.js';
import registerScheduleRoutes from './routes/schedules.js';
import { MongoScheduledMeetingStore } from './store/mongo/MongoScheduledMeetingStore.js';
import { SchedulerService } from './scheduling/SchedulerService.js';
import { DiscordLauncher } from './scheduling/launchers/DiscordLauncher.js';
import { getDiscordClient } from './discord/DiscordBotClient.js';
import { setupAmbientAssistant } from './discord/ambient/setupAmbient.js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required env var ${name} for the integrations module. See backend/.env.example.`
    );
  }
  return value;
}

/**
 * Builds the two storage backends (credentials + connections/tokens) behind
 * their respective interfaces. Two independent driver knobs on purpose:
 * INTEGRATIONS_STORAGE_DRIVER controls the OAuth token store (`store`) —
 * still always local (Mongo/file), since those are per-connection runtime
 * tokens resulting from a completed OAuth flow, not admin-entered config.
 * CREDENTIALS_STORE_DRIVER controls `credentialsStore` — defaults to the
 * same value as INTEGRATIONS_STORAGE_DRIVER (fully backward compatible),
 * but can be set independently to "auth-service" once org tool credentials
 * are managed centrally (see AuthServiceCredentialsStore) instead of in
 * this app's own local storage.
 *
 * This is the pluggability seam for persistence: both CredentialsStore and
 * IntegrationStore are interfaces, so adding a new backend means writing a
 * class that implements the interface and adding one branch here — nothing
 * in routes.ts, OAuthService, or the adapters needs to change.
 */
async function createStores(cipher: TokenCipher): Promise<{ store: IntegrationStore; credentialsStore: CredentialsStore }> {
  const driver = (process.env.INTEGRATIONS_STORAGE_DRIVER ?? 'mongo').toLowerCase();
  const credentialsDriver = (process.env.CREDENTIALS_STORE_DRIVER ?? driver).toLowerCase();

  let mongoConnected = false;
  const ensureMongo = async () => {
    if (!mongoConnected) {
      await connectMongo(requireEnv('MONGODB_URI'));
      mongoConnected = true;
    }
  };

  let store: IntegrationStore;
  if (driver === 'mongo') {
    await ensureMongo();
    store = new MongoIntegrationStore(cipher);
  } else if (driver === 'file') {
    const dataDir = process.env.INTEGRATIONS_DATA_DIR ?? path.join(process.cwd(), 'data');
    store = new FileIntegrationStore(cipher, path.join(dataDir, 'integration-connections.enc.json'));
  } else {
    throw new Error(`Unknown INTEGRATIONS_STORAGE_DRIVER "${driver}" — expected "mongo" or "file"`);
  }

  let credentialsStore: CredentialsStore;
  if (credentialsDriver === 'auth-service') {
    const baseUrl = requireEnv('AUTH_SERVICE_URL');
    const internalKey = requireEnv('AUTH_SERVICE_INTERNAL_KEY');
    const cacheTtlMs = Number(process.env.AUTH_SERVICE_CACHE_TTL_MS ?? 30_000);
    credentialsStore = new AuthServiceCredentialsStore(new AuthServiceClient(baseUrl, internalKey, cacheTtlMs));
  } else if (credentialsDriver === 'mongo') {
    await ensureMongo();
    credentialsStore = new MongoCredentialsStore(cipher);
  } else if (credentialsDriver === 'file') {
    const dataDir = process.env.INTEGRATIONS_DATA_DIR ?? path.join(process.cwd(), 'data');
    credentialsStore = new FileCredentialsStore(cipher, path.join(dataDir, 'integration-credentials.enc.json'));
  } else {
    throw new Error(`Unknown CREDENTIALS_STORE_DRIVER "${credentialsDriver}" — expected "mongo", "file", or "auth-service"`);
  }

  return { store, credentialsStore };
}

/**
 * Wires the integration module into the existing Fastify app. Call this
 * once from index.ts, after the raw-body plugin is registered (needed for
 * webhook signature verification — see backend/src/index.ts).
 *
 * To add a new meeting platform later: write one adapter + factory (see
 * adapters/factories.ts), add it to `allProviderFactories`, and it will
 * show up automatically in GET /integrations/providers and the settings UI.
 * No other change is needed here.
 */
export async function setupIntegrations(fastify: FastifyInstance): Promise<void> {
  for (const factory of allProviderFactories) providerRegistry.register(factory);

  const cipher = new TokenCipher(requireEnv('INTEGRATIONS_ENCRYPTION_KEY'));
  const { store, credentialsStore } = await createStores(cipher);

  const oauth = new OAuthService(
    providerRegistry,
    store,
    credentialsStore,
    requireEnv('OAUTH_STATE_SECRET'),
    process.env.INTEGRATIONS_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3001}/integrations`,
    process.env.CORS_ORIGIN ?? 'http://localhost:5173'
  );

  registerIntegrationRoutes(fastify, { oauth, store, credentialsStore });
  registerDiscordMeetingRoutes(fastify, { credentialsStore });

  // Scheduling is Mongo-only for now (per the brief: "my database for now"),
  // independent of INTEGRATIONS_STORAGE_DRIVER above — so this works even
  // when credentials/connections are on the file driver. If MONGODB_URI
  // isn't set at all, scheduling just doesn't come up (rather than crashing
  // boot) so local dev without Mongo still works for everything else.
  if (process.env.MONGODB_URI) {
    await connectMongo(process.env.MONGODB_URI); // no-op if already connected via createStores() above
    const scheduleStore = new MongoScheduledMeetingStore();

    const scheduler = new SchedulerService(scheduleStore);
    scheduler.registerLauncher(new DiscordLauncher(credentialsStore));
    scheduler.start();
    fastify.addHook('onClose', (_instance, done) => { scheduler.stop(); done(); });

    registerScheduleRoutes(fastify, { store: scheduleStore });
    fastify.log.info('[integrations] scheduling enabled (MongoDB)');
  } else {
    fastify.log.warn('[integrations] MONGODB_URI not set — meeting scheduling is disabled');
  }

    // ── Ambient assistant (Feature 2) — additive, independent of scheduling
  // and on-demand standups above. See AMBIENT_BOT_ARCHITECTURE_PLAN.md.
  // Mongo-only for now, same simplification already made for scheduling.
  //
  // AMBIENT_BOOTSTRAP_ORG_ID: setupAmbientAssistant() wires up exactly ONE
  // ambient assistant instance at boot, bound to one Discord client (see
  // its doc comment) — there is no per-request context here to derive an
  // org from, since nothing has made a request yet. Defaults to 'default'
  // for a single-tenant deployment; set this explicitly to run the ambient
  // assistant for a specific org in a multi-org deployment. True per-org
  // ambient assistants (one instance per org, each with that org's own
  // Discord client from BotConnectionManager) is a larger structural
  // change, not attempted here — see setupAmbient.ts's doc comment.
  if (process.env.MONGODB_URI) {
    const ambientOrgId = process.env.AMBIENT_BOOTSTRAP_ORG_ID || 'default';
    const discordCreds = await credentialsStore.get(ambientOrgId, 'discord');
    if (discordCreds?.botToken) {
      const discordClient = await getDiscordClient(discordCreds.botToken);
      await setupAmbientAssistant(fastify, { discordClient, orgId: ambientOrgId });
    } else {
      fastify.log.warn(`[integrations] Discord not configured for org "${ambientOrgId}" yet — ambient assistant disabled until credentials are added`);
    }
  }

  fastify.log.info(
    {
      providers: allProviderFactories.map((f) => f.id),
      storageDriver: process.env.INTEGRATIONS_STORAGE_DRIVER ?? 'mongo',
    },
    '[integrations] module ready'
  );
}

export * from './types.js';
export { providerRegistry } from './ProviderRegistry.js';
export { OAuthService } from './OAuthService.js';
export type { IntegrationStore } from './store/IntegrationStore.js';
export type { CredentialsStore } from './store/CredentialsStore.js';
