/**
 * Client for auth-service's internal credential-fetch endpoint
 * (GET /internal/orgs/:orgId/tools/:toolId/credentials) — the
 * service-to-service side, authenticated with X-Internal-Key, not the
 * per-user JWT auth-service also exposes for its dashboard routes. See
 * auth-service/src/http/plugins/internalAuth.ts for why these are
 * deliberately different trust boundaries.
 *
 * Cached with a short TTL rather than fetched on every call, so a hot path
 * (e.g. every scheduled meeting launch) doesn't turn into a network round
 * trip to auth-service each time — but short enough that rotating a
 * credential in the dashboard takes effect within seconds, not requiring a
 * restart. This mirrors the same reasoning already applied to project
 * context caching in agent-bridge (core/settings.py's CONTEXT_CACHE_TTL).
 */

interface CacheEntry {
  credentials: Record<string, string> | null;
  fetchedAt: number;
}

export class AuthServiceClient {
  private cache = new Map<string, CacheEntry>();

  constructor(
    private baseUrl: string,
    private internalServiceKey: string,
    private cacheTtlMs = 30_000
  ) {}

  private cacheKey(orgId: string, toolId: string) {
    return `${orgId}:${toolId}`;
  }

  async getToolCredentials(orgId: string, toolId: string): Promise<Record<string, string> | null> {
    const key = this.cacheKey(orgId, toolId);
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.fetchedAt < this.cacheTtlMs) {
      return cached.credentials;
    }

    const res = await fetch(`${this.baseUrl}/internal/orgs/${orgId}/tools/${toolId}/credentials`, {
      headers: { 'X-Internal-Key': this.internalServiceKey },
    });

    let credentials: Record<string, string> | null = null;
    if (res.status === 200) {
      const body = (await res.json()) as { credentials: Record<string, string> };
      credentials = body.credentials;
    } else if (res.status === 404) {
      credentials = null; // tool not configured for this org — not an error
    } else {
      throw new Error(`auth-service credential fetch failed: ${res.status} ${res.statusText}`);
    }

    this.cache.set(key, { credentials, fetchedAt: Date.now() });
    return credentials;
  }

  /** Drop a cached entry immediately — used once Phase 4's event-driven
   * cache invalidation exists (auth-service publishes org.tool_updated);
   * until then, credentials simply refresh within `cacheTtlMs` on their own. */
  invalidate(orgId: string, toolId: string): void {
    this.cache.delete(this.cacheKey(orgId, toolId));
  }
}
