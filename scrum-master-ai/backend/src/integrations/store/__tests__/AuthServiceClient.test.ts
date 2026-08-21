import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthServiceClient } from '../AuthServiceClient.js';

describe('AuthServiceClient', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('fetches credentials with the internal-key header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ credentials: { botToken: 'abc123' } }),
    });
    globalThis.fetch = fetchMock as any;

    const client = new AuthServiceClient('http://auth-service:4000', 'secret-key');
    const creds = await client.getToolCredentials('org1', 'discord');

    expect(creds).toEqual({ botToken: 'abc123' });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://auth-service:4000/internal/orgs/org1/tools/discord/credentials');
    expect(opts.headers['X-Internal-Key']).toBe('secret-key');
  });

  it('returns null (not an error) when the tool is not configured (404)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ status: 404 }) as any;
    const client = new AuthServiceClient('http://auth-service:4000', 'secret-key');
    const creds = await client.getToolCredentials('org1', 'taiga');
    expect(creds).toBeNull();
  });

  it('throws on unexpected error statuses (e.g. 401 wrong key, 500)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ status: 401, statusText: 'Unauthorized' }) as any;
    const client = new AuthServiceClient('http://auth-service:4000', 'wrong-key');
    await expect(client.getToolCredentials('org1', 'discord')).rejects.toThrow(/401/);
  });

  it('caches results and does not refetch within the TTL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ credentials: { botToken: 'abc123' } }),
    });
    globalThis.fetch = fetchMock as any;

    const client = new AuthServiceClient('http://auth-service:4000', 'secret-key', 60_000);
    await client.getToolCredentials('org1', 'discord');
    await client.getToolCredentials('org1', 'discord');
    await client.getToolCredentials('org1', 'discord');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refetches after invalidate() is called', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ credentials: { botToken: 'abc123' } }),
    });
    globalThis.fetch = fetchMock as any;

    const client = new AuthServiceClient('http://auth-service:4000', 'secret-key', 60_000);
    await client.getToolCredentials('org1', 'discord');
    client.invalidate('org1', 'discord');
    await client.getToolCredentials('org1', 'discord');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps separate cache entries per org and per tool', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ credentials: { botToken: 'abc123' } }),
    });
    globalThis.fetch = fetchMock as any;

    const client = new AuthServiceClient('http://auth-service:4000', 'secret-key', 60_000);
    await client.getToolCredentials('org1', 'discord');
    await client.getToolCredentials('org2', 'discord'); // different org
    await client.getToolCredentials('org1', 'taiga');   // different tool

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
