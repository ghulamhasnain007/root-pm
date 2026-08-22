/**
 * integrations/discord/BotConnectionManager.ts — Manages N concurrent Discord
 * connections, one per org that has Discord configured.
 *
 * At startup: discovers orgs via auth-service endpoint, calls getDiscordClient
 * per org. Maintains a reverse Map<Client, orgId> so incoming events can be
 * tagged with the originating org.
 *
 * Subscribes to Kafka tool-config events to add/remove connections dynamically.
 */
import { Client } from 'discord.js';
import { getDiscordClient, releaseDiscordClient } from './DiscordBotClient.js';

export interface OrgConnection {
  orgId: string;
  client: Client;
  /** Needed at removal time to release the right cached client — see releaseDiscordClient. */
  token: string;
  status: 'connecting' | 'connected' | 'failed' | 'disconnecting';
  lastError: string | null;
  connectedAt: Date | null;
}

export class BotConnectionManager {
  private connections = new Map<string, OrgConnection>();
  private clientToOrg = new Map<Client, string>();

  /**
   * Discover orgs from auth-service and establish connections.
   */
  async discoverAndConnect(authServiceUrl: string, internalKey: string): Promise<void> {
    const orgs = await this.fetchOrgs(authServiceUrl, internalKey, 'discord');
    for (const org of orgs) {
      await this.addOrg(org.orgId, authServiceUrl, internalKey);
    }
  }

  /**
   * Add a connection for a specific org.
   *
   * Deliberately does NOT fall back to a shared env-var bot token if the
   * auth-service credential fetch fails for any reason. This is a
   * bring-your-own-bot-per-org design — a shared fallback would mean that
   * if auth-service is briefly unreachable, every org being (re)connected
   * during that window would silently share ONE bot token. Beyond the
   * obvious tenant-isolation problem, Discord only allows a single active
   * gateway session per bot token — multiple orgs' connections fighting
   * over the same token would repeatedly kick each other's sessions.
   * Failing this org's connection cleanly (status: 'failed', logged, does
   * not affect any other org) is the correct behavior here, not silently
   * degrading into a shared identity.
   */
  async addOrg(orgId: string, authServiceUrl: string, internalKey: string): Promise<void> {
    if (this.connections.has(orgId)) return;

    try {
      const credentials = await this.fetchCredentials(authServiceUrl, internalKey, orgId, 'discord');
      // Checks both naming conventions — the dashboard's ToolConfigPage
      // writes bot_token (snake_case, matching this codebase's existing
      // config field naming), but check camelCase too for resilience
      // against whatever wrote the credentials, same defensive dual-check
      // core/auth_service_client.py's overlay function does on the Python
      // side (they must agree on what they'll accept, or a credential
      // written by one path silently fails to be read by the other).
      const token = credentials.bot_token || credentials.botToken || credentials.token;
      if (!token) throw new Error('No bot token configured for this org\'s Discord tool');

      const conn: OrgConnection = {
        orgId, token, client: null as any,
        status: 'connecting', lastError: null, connectedAt: null,
      };
      this.connections.set(orgId, conn);

      const client = await getDiscordClient(token);
      conn.client = client;
      conn.status = 'connected';
      conn.connectedAt = new Date();
      this.clientToOrg.set(client, orgId);

      console.log(`[BotConnectionManager] Org ${orgId}: connected`);
    } catch (err: any) {
      this.connections.set(orgId, {
        orgId, token: '', client: null as any,
        status: 'failed', lastError: err.message, connectedAt: null,
      });
      console.error(`[BotConnectionManager] Org ${orgId}: connection failed — ${err.message}`);
    }
  }

  /**
   * Remove a connection for a specific org — actually disconnects from
   * Discord (releaseDiscordClient), not just forgetting about it locally.
   */
  async removeOrg(orgId: string): Promise<void> {
    const conn = this.connections.get(orgId);
    if (!conn) return;

    conn.status = 'disconnecting';
    if (conn.client) this.clientToOrg.delete(conn.client);
    this.connections.delete(orgId);

    if (conn.token) {
      await releaseDiscordClient(conn.token);
    }
    console.log(`[BotConnectionManager] Org ${orgId}: connection removed`);
  }

  /**
   * Get the client for a specific org (for sending messages).
   */
  getClientForOrg(orgId: string): Client | null {
    return this.connections.get(orgId)?.client ?? null;
  }

  /**
   * Get the orgId for a given client (for incoming event tagging).
   */
  getOrgForClient(client: Client): string | null {
    return this.clientToOrg.get(client) ?? null;
  }

  /**
   * Get status of all connections.
   */
  getStatus(): Array<{ orgId: string; status: string; lastError: string | null; connectedAt: Date | null }> {
    return Array.from(this.connections.values()).map(c => ({
      orgId: c.orgId,
      status: c.status,
      lastError: c.lastError,
      connectedAt: c.connectedAt,
    }));
  }

  private async fetchOrgs(url: string, key: string, toolId: string): Promise<Array<{ orgId: string; status: string }>> {
    const resp = await fetch(`${url}/internal/tools/${toolId}/orgs`, {
      headers: { 'X-Internal-Key': key },
    });
    if (!resp.ok) return [];
    const data = await resp.json() as any;
    return data.orgs ?? [];
  }
  private async fetchCredentials(url: string, key: string, orgId: string, toolId: string): Promise<Record<string, string>> {
    const resp = await fetch(`${url}/internal/orgs/${orgId}/tools/${toolId}/credentials`, {
      headers: { 'X-Internal-Key': key },
    });
    if (!resp.ok) throw new Error(`Failed to fetch credentials: ${resp.status}`);
    const data = await resp.json() as any;
    return data.credentials ?? {};
  }
}
