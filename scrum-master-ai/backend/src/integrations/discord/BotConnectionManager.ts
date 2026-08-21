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
import { getDiscordClient } from './DiscordBotClient.js';

export interface OrgConnection {
  orgId: string;
  client: Client;
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
   */
  async addOrg(orgId: string, authServiceUrl: string, internalKey: string): Promise<void> {
    if (this.connections.has(orgId)) return;

    const conn: OrgConnection = {
      orgId,
      client: null as any,
      status: 'connecting',
      lastError: null,
      connectedAt: null,
    };
    this.connections.set(orgId, conn);

    try {
      let credentials: Record<string, string> = {};
      try {
        credentials = await this.fetchCredentials(authServiceUrl, internalKey, orgId, 'discord');
      } catch {
        // Fallback to env vars — deprecated, will be removed in future release
        const envToken = process.env.DISCORD_BOT_TOKEN || process.env.BOT_TOKEN || '';
        if (envToken) {
          console.warn(`[BotConnectionManager] DEPRECATED: Using env-var fallback for org ${orgId}. ` +
            'Migrate to auth-service tool config: npx tsx scripts/migrate-to-org.ts');
          credentials = {
            bot_token: envToken,
            trigger_role: process.env.DISCORD_TRIGGER_ROLE || 'FYP',
          };
        }
      }
      const token = credentials.bot_token || credentials.token;
      if (!token) throw new Error('No bot token found in credentials');

      const client = await getDiscordClient(token);
      conn.client = client;
      conn.status = 'connected';
      conn.connectedAt = new Date();
      this.clientToOrg.set(client, orgId);

      console.log(`[BotConnectionManager] Org ${orgId}: connected`);
    } catch (err: any) {
      conn.status = 'failed';
      conn.lastError = err.message;
      console.error(`[BotConnectionManager] Org ${orgId}: connection failed — ${err.message}`);
    }
  }

  /**
   * Remove a connection for a specific org.
   */
  async removeOrg(orgId: string): Promise<void> {
    const conn = this.connections.get(orgId);
    if (!conn) return;

    conn.status = 'disconnecting';
    this.clientToOrg.delete(conn.client);
    this.connections.delete(orgId);
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
