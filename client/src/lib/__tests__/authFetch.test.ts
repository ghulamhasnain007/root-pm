import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('authFetch', () => {
  const originalFetch = globalThis.fetch;
  const originalLocation = window.location;

  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
    // authFetch navigates on unrecoverable session expiry — stub location
    // so that doesn't actually try to navigate jsdom anywhere.
    delete (window as any).location;
    ;(window as any).location = { href: '' } as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    (window as any).location = originalLocation;
    vi.restoreAllMocks();
  });

  it('attaches the access token as a Bearer header when present', async () => {
    const { saveTokens } = await import('../tokenStore.js');
    saveTokens({ accessToken: 'my-token', refreshToken: 'my-refresh' });

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: 1 }) });
    globalThis.fetch = fetchMock as any;

    const { authFetch } = await import('../authFetch.js');
    await authFetch('http://api.example', '/thing');

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer my-token');
  });

  it('makes no Authorization header when there is no token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    globalThis.fetch = fetchMock as any;

    const { authFetch } = await import('../authFetch.js');
    await authFetch('http://api.example', '/thing');

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it('on 401, refreshes the token and retries the original request once', async () => {
    const { saveTokens } = await import('../tokenStore.js');
    saveTokens({ accessToken: 'expired-token', refreshToken: 'valid-refresh' });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 401 }) // original request fails
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ accessToken: 'new-token', refreshToken: 'new-refresh' }) }) // refresh succeeds
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ result: 'success' }) }); // retried request succeeds
    globalThis.fetch = fetchMock as any;

    const { authFetch } = await import('../authFetch.js');
    const result = await authFetch('http://api.example', '/thing');

    expect(result).toEqual({ result: 'success' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // The retried request uses the NEW token, not the expired one.
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe('Bearer new-token');
  });

  it('clears tokens and redirects to /login when refresh itself fails', async () => {
    const { saveTokens, getAccessToken } = await import('../tokenStore.js');
    saveTokens({ accessToken: 'expired-token', refreshToken: 'also-invalid-refresh' });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 401 }) // original request fails
      .mockResolvedValueOnce({ ok: false, status: 401 }); // refresh also fails
    globalThis.fetch = fetchMock as any;

    const { authFetch } = await import('../authFetch.js');

    await expect(authFetch('http://api.example', '/thing')).rejects.toThrow('Session expired');
    expect(getAccessToken()).toBeNull();
    expect(window.location.href).toBe('/login');
  });

  it('does not attempt a refresh at all if there is no refresh token', async () => {
    localStorage.setItem('accessToken', 'expired-token');
    localStorage.removeItem('refreshToken');
    vi.resetModules();

    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ message: 'Unauthorized' }) });
    globalThis.fetch = fetchMock as any;

    const { authFetch } = await import('../authFetch.js');
    await expect(authFetch('http://api.example', '/thing')).rejects.toThrow(/HTTP 401|Unauthorized/);

    expect(fetchMock).toHaveBeenCalledTimes(1); // no refresh attempt, no retry
  });

  it('de-dupes concurrent refresh attempts — two requests 401ing at once share one refresh call', async () => {
    const { saveTokens } = await import('../tokenStore.js');
    saveTokens({ accessToken: 'expired-token', refreshToken: 'valid-refresh' });

    let refreshCallCount = 0;
    const called: Record<string, boolean> = {};
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/auth/refresh')) {
        refreshCallCount += 1;
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ accessToken: 'new-token', refreshToken: 'new-refresh' }) });
      }
      if (url.includes('/thing-a') || url.includes('/thing-b')) {
        if (!called[url]) {
          called[url] = true;
          return Promise.resolve({ ok: false, status: 401 });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });
    globalThis.fetch = fetchMock as any;

    const { authFetch } = await import('../authFetch.js');
    await Promise.all([
      authFetch('http://api.example', '/thing-a'),
      authFetch('http://api.example', '/thing-b'),
    ]);

    expect(refreshCallCount).toBe(1);
  });

  it('non-401 error responses throw with the server-provided message', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false, status: 400, json: async () => ({ message: 'Validation failed' }),
    });
    globalThis.fetch = fetchMock as any;

    const { authFetch } = await import('../authFetch.js');
    await expect(authFetch('http://api.example', '/thing')).rejects.toThrow('Validation failed');
  });

  it('returns null for a 204 No Content response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    globalThis.fetch = fetchMock as any;

    const { authFetch } = await import('../authFetch.js');
    const result = await authFetch('http://api.example', '/thing', { method: 'DELETE' });

    expect(result).toBeNull();
  });
});
