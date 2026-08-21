import type { ProviderId } from '../types.js';
import type { CredentialsStore } from './CredentialsStore.js';
import type { AuthServiceClient } from './AuthServiceClient.js';

/**
 * Once auth-service is the source of truth for org tool credentials, this
 * app should stop being a place where they're *entered* — that happens on
 * the org's Platforms/Tools page in `client/` (Phase 5), which talks to
 * auth-service's dashboard-facing, JWT-authenticated
 * `PUT /orgs/:orgId/tools/:toolId` directly.
 *
 * This store is deliberately READ-ONLY: `get`/`isConfigured` proxy to
 * auth-service (via the internal service-to-service credential-fetch
 * route), while `save`/`delete` throw rather than silently no-op or
 * (worse) writing credentials through a path with no user-authentication
 * check at all. Silently accepting a `save()` call here would mean
 * scrum-master-ai's own local API — which has no user/role auth on these
 * routes — could write another org's credentials with nothing checking
 * who's asking; throwing a clear, actionable error is the honest choice
 * until those write-path routes are actually removed from this service.
 */
export class AuthServiceCredentialsStore implements CredentialsStore {
  constructor(private client: AuthServiceClient) {}

  async get(orgId: string, provider: ProviderId): Promise<Record<string, string> | null> {
    return this.client.getToolCredentials(orgId, provider);
  }

  async isConfigured(orgId: string, provider: ProviderId): Promise<boolean> {
    const creds = await this.client.getToolCredentials(orgId, provider);
    return creds !== null;
  }

  async save(_orgId: string, provider: ProviderId, _credentials: Record<string, string>): Promise<void> {
    throw new Error(
      `Cannot save "${provider}" credentials here — INTEGRATIONS_STORAGE_DRIVER=auth-service means ` +
      `credentials are managed in the org dashboard (client/), not this app's own settings routes. ` +
      `Configure "${provider}" from the org's Tools page instead.`
    );
  }

  async delete(_orgId: string, provider: ProviderId): Promise<void> {
    throw new Error(
      `Cannot delete "${provider}" credentials here — manage this from the org's Tools page in the dashboard.`
    );
  }
}
