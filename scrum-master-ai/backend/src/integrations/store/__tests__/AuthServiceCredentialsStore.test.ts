import { describe, expect, it, vi } from 'vitest';
import { AuthServiceCredentialsStore } from '../AuthServiceCredentialsStore.js';
import type { AuthServiceClient } from '../AuthServiceClient.js';

function fakeClient(overrides: Partial<AuthServiceClient> = {}): AuthServiceClient {
  return {
    getToolCredentials: vi.fn().mockResolvedValue(null),
    invalidate: vi.fn(),
    ...overrides,
  } as unknown as AuthServiceClient;
}

describe('AuthServiceCredentialsStore', () => {
  it('get() proxies to the auth-service client', async () => {
    const client = fakeClient({ getToolCredentials: vi.fn().mockResolvedValue({ botToken: 'x' }) });
    const store = new AuthServiceCredentialsStore(client);

    const creds = await store.get('org1', 'discord');
    expect(creds).toEqual({ botToken: 'x' });
    expect(client.getToolCredentials).toHaveBeenCalledWith('org1', 'discord');
  });

  it('isConfigured() is true when credentials exist, false when null', async () => {
    const configured = new AuthServiceCredentialsStore(fakeClient({ getToolCredentials: vi.fn().mockResolvedValue({ x: '1' }) }));
    expect(await configured.isConfigured('org1', 'discord')).toBe(true);

    const notConfigured = new AuthServiceCredentialsStore(fakeClient({ getToolCredentials: vi.fn().mockResolvedValue(null) }));
    expect(await notConfigured.isConfigured('org1', 'discord')).toBe(false);
  });

  it('save() refuses with a clear, actionable error rather than silently no-op-ing or writing through an unauthenticated path', async () => {
    const store = new AuthServiceCredentialsStore(fakeClient());
    await expect(store.save('org1', 'discord', { botToken: 'x' })).rejects.toThrow(/Tools page/);
  });

  it('delete() refuses with a clear error', async () => {
    const store = new AuthServiceCredentialsStore(fakeClient());
    await expect(store.delete('org1', 'discord')).rejects.toThrow(/Tools page/);
  });
});
