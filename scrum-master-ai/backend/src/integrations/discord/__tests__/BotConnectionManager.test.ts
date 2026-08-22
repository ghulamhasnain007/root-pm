import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetDiscordClient = vi.fn();
const mockReleaseDiscordClient = vi.fn();

vi.mock('../DiscordBotClient.js', () => ({
  getDiscordClient: (...args: any[]) => mockGetDiscordClient(...args),
  releaseDiscordClient: (...args: any[]) => mockReleaseDiscordClient(...args),
}));

let BotConnectionManager: typeof import('../BotConnectionManager.js').BotConnectionManager;

beforeAll(async () => {
  // Dynamic (not top-level) import so vi.mock above is applied first —
  // also keeps this file compatible with the project's commonjs
  // tsconfig target, which doesn't support top-level await.
  ({ BotConnectionManager } = await import('../BotConnectionManager.js'));
});

function fakeClient(id: string) {
  return { id } as any; // BotConnectionManager only uses Client as a Map key/value here
}

describe('BotConnectionManager', () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    mockGetDiscordClient.mockReset();
    mockReleaseDiscordClient.mockReset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('connects successfully when auth-service returns credentials', async () => {
    const client = fakeClient('c1');
    mockGetDiscordClient.mockResolvedValue(client);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ credentials: { bot_token: 'org1-token' } }),
    }) as any;

    const manager = new BotConnectionManager();
    await manager.addOrg('org1', 'http://auth-service:4000', 'internal-key');

    expect(mockGetDiscordClient).toHaveBeenCalledWith('org1-token');
    expect(manager.getStatus()).toEqual([
      expect.objectContaining({ orgId: 'org1', status: 'connected' }),
    ]);
    expect(manager.getClientForOrg('org1')).toBe(client);
    expect(manager.getOrgForClient(client)).toBe('org1');
  });

  it('fails cleanly (does not throw) when credentials are not configured for the org', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 }) as any;

    const manager = new BotConnectionManager();
    await manager.addOrg('org1', 'http://auth-service:4000', 'internal-key');

    expect(manager.getStatus()).toEqual([
      expect.objectContaining({ orgId: 'org1', status: 'failed' }),
    ]);
    expect(mockGetDiscordClient).not.toHaveBeenCalled();
  });

  it('does NOT fall back to a shared env-var bot token when the credential fetch fails — regression test for the cross-tenant token-sharing bug', async () => {
    process.env.DISCORD_BOT_TOKEN = 'shared-env-token-should-never-be-used';
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('auth-service unreachable')) as any;

    const manager = new BotConnectionManager();
    await manager.addOrg('org1', 'http://auth-service:4000', 'internal-key');

    expect(mockGetDiscordClient).not.toHaveBeenCalled();
    expect(manager.getStatus()[0].status).toBe('failed');
  });

  it('one org failing to connect does not affect another org already connected', async () => {
    const clientA = fakeClient('a');
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ credentials: { bot_token: 'org-a-token' } }) })
      .mockResolvedValueOnce({ ok: false, status: 404 }) as any;
    mockGetDiscordClient.mockResolvedValueOnce(clientA);

    const manager = new BotConnectionManager();
    await manager.addOrg('org-a', 'http://auth-service:4000', 'internal-key');
    await manager.addOrg('org-b', 'http://auth-service:4000', 'internal-key');

    const statuses = Object.fromEntries(manager.getStatus().map(s => [s.orgId, s.status]));
    expect(statuses['org-a']).toBe('connected');
    expect(statuses['org-b']).toBe('failed');
    expect(manager.getClientForOrg('org-a')).toBe(clientA);
  });

  it('removeOrg actually releases the underlying Discord client, not just local bookkeeping', async () => {
    const client = fakeClient('c1');
    mockGetDiscordClient.mockResolvedValue(client);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ credentials: { bot_token: 'org1-token' } }),
    }) as any;

    const manager = new BotConnectionManager();
    await manager.addOrg('org1', 'http://auth-service:4000', 'internal-key');
    await manager.removeOrg('org1');

    expect(mockReleaseDiscordClient).toHaveBeenCalledWith('org1-token');
    expect(manager.getClientForOrg('org1')).toBeNull();
    expect(manager.getOrgForClient(client)).toBeNull();
    expect(manager.getStatus()).toEqual([]);
  });

  it('removeOrg on an unknown org is a safe no-op', async () => {
    const manager = new BotConnectionManager();
    await expect(manager.removeOrg('never-added')).resolves.toBeUndefined();
    expect(mockReleaseDiscordClient).not.toHaveBeenCalled();
  });

  it('addOrg is idempotent — calling twice for the same org does not reconnect', async () => {
    mockGetDiscordClient.mockResolvedValue(fakeClient('c1'));
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ credentials: { bot_token: 'org1-token' } }),
    }) as any;

    const manager = new BotConnectionManager();
    await manager.addOrg('org1', 'http://auth-service:4000', 'internal-key');
    await manager.addOrg('org1', 'http://auth-service:4000', 'internal-key');

    expect(mockGetDiscordClient).toHaveBeenCalledTimes(1);
  });
});
