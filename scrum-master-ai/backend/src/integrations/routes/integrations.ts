import type { FastifyInstance, FastifyRequest } from 'fastify';
import { providerRegistry } from '../ProviderRegistry.js';
import type { OAuthService } from '../OAuthService.js';
import type { IntegrationStore } from '../store/IntegrationStore.js';
import type { CredentialsStore } from '../store/CredentialsStore.js';
import { getIntegrationBaseUrl } from '../utils/getIntegrationBaseUrl.js';
import { requireAuth } from '../../auth/requireAuth.js';

export default function registerIntegrationRoutes(
  fastify: FastifyInstance,
  deps: { oauth: OAuthService; store: IntegrationStore; credentialsStore: CredentialsStore }
): void {
  const { oauth, store, credentialsStore } = deps;

  // ── List providers: schema + configuration + connection status ─────────────
  fastify.get('/integrations/providers', { preHandler: requireAuth }, async (req: FastifyRequest) => {
    const connections = await store.listConnections(req.orgId!);

    return Promise.all(providerRegistry.list().map(async (factory) => {
      const conn = connections.find((c) => c.provider === factory.id);
      const configured = await credentialsStore.isConfigured(req.orgId!, factory.id);
      return {
        id: factory.id,
        displayName: factory.displayName,
        capabilities: factory.capabilities,
        docsUrl: factory.docsUrl,
        notes: factory.notes,
        requiresAdvancedSetup: factory.requiresAdvancedSetup ?? false,
        credentialFields: factory.credentialFields,
        configured,
        status: conn?.status ?? 'disconnected',
        enabled: conn?.enabled ?? false,
        connectedAt: conn?.connectedAt ?? null,
        lastError: conn?.lastError ?? null,
      };
    }));
  });

  // ── Save app credentials (Client ID/Secret/etc) for a provider ──────────────
  fastify.post('/integrations/:provider/credentials', { preHandler: requireAuth }, async (req: FastifyRequest, reply) => {
    const { provider } = req.params as { provider: string };
    if (!providerRegistry.has(provider)) return reply.code(404).send({ error: `Unknown provider: ${provider}` });

    const factory = providerRegistry.getFactory(provider);
    const body = (req.body ?? {}) as Record<string, string>;

    const missing = factory.credentialFields.filter((f) => f.required && !body[f.key]?.trim());
    if (missing.length) {
      return reply.code(400).send({ error: `Missing required field(s): ${missing.map((f) => f.label).join(', ')}` });
    }

    await credentialsStore.save(req.orgId!, provider, body);
    return { provider, configured: true };
  });

  // ── Read back saved credentials (non-secret fields only) ────────────────────
  fastify.get('/integrations/:provider/credentials', { preHandler: requireAuth }, async (req: FastifyRequest, reply) => {
    const { provider } = req.params as { provider: string };
    if (!providerRegistry.has(provider)) return reply.code(404).send({ error: `Unknown provider: ${provider}` });

    const factory = providerRegistry.getFactory(provider);
    const creds = await credentialsStore.get(req.orgId!, provider);
    if (!creds) return { configured: false, values: {} };

    // Secret fields are never echoed back once saved — the settings form
    // shows them as already-set placeholders instead of the real value.
    const values: Record<string, string> = {};
    for (const field of factory.credentialFields) {
      if (!field.secret) values[field.key] = creds[field.key] ?? '';
    }
    const secretsSet = factory.credentialFields.filter((f) => f.secret).map((f) => f.key);
    return { configured: true, values, secretsSet };
  });

  // ── Clear saved credentials (also drops any live connection) ────────────────
  fastify.delete('/integrations/:provider/credentials', { preHandler: requireAuth }, async (req: FastifyRequest, reply) => {
    const { provider } = req.params as { provider: string };
    if (!providerRegistry.has(provider)) return reply.code(404).send({ error: `Unknown provider: ${provider}` });

    await credentialsStore.delete(req.orgId!, provider);
    await store.deleteConnection(req.orgId!, provider);
    return { provider, configured: false };
  });

  // ── Start OAuth connect flow ────────────────────────────────────────────────
  // Returns the provider's OAuth URL as JSON rather than answering with a
  // raw HTTP redirect. A plain browser navigation (which a redirect
  // response is meant to be followed by, via a plain <a href>) can't carry
  // an Authorization header — there'd be no way to know which org is
  // connecting, and thus no way to sign the right orgId into the OAuth
  // `state` parameter this verifies on callback. The client now does an
  // authenticated fetch here first, then navigates the browser to the
  // returned URL itself — see client/src/pages/voice/IntegrationsPage.tsx's
  // connect handler and client/src/lib/voiceApi.ts's connect().
  fastify.get('/integrations/:provider/connect', { preHandler: requireAuth }, async (req: FastifyRequest, reply) => {
    const { provider } = req.params as { provider: string };
    if (!providerRegistry.has(provider)) return reply.code(404).send({ error: `Unknown provider: ${provider}` });

    try {
      const baseUrl = getIntegrationBaseUrl(req);
      const url = await oauth.startConnect(provider, req.orgId!, baseUrl);
      return { url };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : 'Failed to start OAuth flow' });
    }
  });

  // ── OAuth callback — redirects back into the app's UI either way ────────────
  // Deliberately NOT gated by requireAuth: the OAuth provider (Discord,
  // Zoom, ...) redirects the user's browser back here directly, and has no
  // way to attach our JWT to that redirect — this route was never supposed
  // to need one. Its actual authorization mechanism is the `state`
  // parameter, which OAuthService.startConnect signs (HMAC) with the real
  // orgId embedded in it above, and which handleCallback verifies
  // (signature + short TTL) before trusting anything in it — so this
  // route already derives orgId correctly, from the one place a
  // provider-initiated redirect actually can carry authenticated context.
  fastify.get('/integrations/:provider/callback', async (req, reply) => {
    const { provider } = req.params as { provider: string };
    const { code, state, error } = req.query as { code?: string; state?: string; error?: string };

    if (error) return reply.redirect(`${process.env.CORS_ORIGIN}/?integration=${provider}&status=error&message=${encodeURIComponent(error)}`);
    if (!code || !state) return reply.code(400).send({ error: 'Missing code or state' });

    try {
      const baseUrl = getIntegrationBaseUrl(req);
      const { redirectTo } = await oauth.handleCallback(baseUrl, provider, code, state);
      return reply.redirect(redirectTo);
    } catch (err) {
      const message = encodeURIComponent(err instanceof Error ? err.message : 'OAuth callback failed');
      return reply.redirect(`${process.env.CORS_ORIGIN}/?integration=${provider}&status=error&message=${message}`);
    }
  });

  // ── Toggle enabled/disabled without disconnecting ────────────────────────────
  fastify.post('/integrations/:provider/toggle', { preHandler: requireAuth }, async (req: FastifyRequest, reply) => {
    const { provider } = req.params as { provider: string };
    const { enabled } = (req.body ?? {}) as { enabled: boolean };
    if (!providerRegistry.has(provider)) return reply.code(404).send({ error: `Unknown provider: ${provider}` });

    await store.setEnabled(req.orgId!, provider, enabled);
    return { provider, enabled };
  });

  // ── Disconnect (revoke + delete stored tokens, keeps saved credentials) ─────
  fastify.delete('/integrations/:provider', { preHandler: requireAuth }, async (req: FastifyRequest, reply) => {
    const { provider } = req.params as { provider: string };
    if (!providerRegistry.has(provider)) return reply.code(404).send({ error: `Unknown provider: ${provider}` });

    await oauth.disconnect(req.orgId!, provider);
    return { provider, disconnected: true };
  });

  // ── Provider webhooks — signature-verified per adapter ───────────────────────
  // NOT gated by requireAuth: this is called BY the third-party provider's
  // own servers (Zoom, etc.), which will never have our JWT — its security
  // model is per-adapter webhook signature verification (adapter.verifyWebhook
  // below), a completely different, already-correct mechanism.
  //
  // KNOWN REMAINING GAP: unlike every route above, there is currently no
  // way to know which ORG a given inbound webhook belongs to — this route
  // isn't scoped by org in its URL, and a provider's webhook payload isn't
  // guaranteed to carry an identifier this app can map back to one of our
  // orgs. Closing this properly needs one of: (a) per-org webhook URLs
  // (e.g. /integrations/:provider/webhook/:orgId, configured as each org's
  // distinct callback URL with the provider), or (b) resolving org from an
  // identifier already present in the payload (e.g. a Zoom account ID that
  // was recorded against a specific org's connection at OAuth-connect
  // time). Neither is implemented — this still resolves credentials via a
  // single fixed org until one of those is built. Left as an explicit
  // constant (not a request-derived value) specifically so this doesn't
  // silently look "fixed" alongside the routes above that genuinely are.
  const WEBHOOK_ORG_ID_UNRESOLVED = 'default';
  fastify.post('/integrations/:provider/webhook', { config: { rawBody: true } }, async (req: FastifyRequest, reply) => {
    const { provider } = req.params as { provider: string };
    if (!providerRegistry.has(provider)) return reply.code(404).send({ error: `Unknown provider: ${provider}` });

    const credentials = await credentialsStore.get(WEBHOOK_ORG_ID_UNRESOLVED, provider);
    if (!credentials) return reply.code(400).send({ error: `${provider} is not configured` });

    const adapter = providerRegistry.buildAdapter(provider, credentials);
    const rawBody = (req as unknown as { rawBody: Buffer }).rawBody;

    // Some providers (Zoom) require answering a one-time handshake before
    // any signature can be verified.
    if (adapter.handleUrlValidation) {
      const validation = adapter.handleUrlValidation(rawBody);
      if (validation) return reply.send(validation);
    }

    if (!adapter.verifyWebhook(req.headers, rawBody)) {
      return reply.code(401).send({ error: 'Webhook signature verification failed' });
    }

    const events = adapter.parseWebhookEvent(rawBody);
    for (const event of events) {
      // Hand off to whatever the existing app uses to consume normalized
      // meeting events — out of scope here — e.g.: meetingEventBus.emit(event);
      fastify.log.info({ event }, `[integrations:${provider}] event`);
    }

    return reply.code(200).send({ received: events.length });
  });
}
