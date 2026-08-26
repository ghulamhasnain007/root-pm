import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function makeJwt(payload: Record<string, any>): string {
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const body = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${header}.${body}.fakesig`;
}

describe('tokenStore', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('a freshly-loaded module picks up tokens already in localStorage — this is what makes a genuinely new tab see an existing login', async () => {
    // Simulates: tab 1 already logged in and wrote to localStorage. Tab 2
    // opens fresh — its JS module graph is evaluated from scratch, reading
    // whatever's in localStorage at that moment.
    localStorage.setItem('accessToken', 'existing-access-token');
    localStorage.setItem('refreshToken', 'existing-refresh-token');

    const { getAccessToken, getRefreshToken } = await import('../tokenStore.js');

    expect(getAccessToken()).toBe('existing-access-token');
    expect(getRefreshToken()).toBe('existing-refresh-token');
  });

  it('saveTokens writes to localStorage and updates in-memory state', async () => {
    const { saveTokens, getAccessToken, getRefreshToken } = await import('../tokenStore.js');

    saveTokens({ accessToken: 'new-access', refreshToken: 'new-refresh' });

    expect(getAccessToken()).toBe('new-access');
    expect(getRefreshToken()).toBe('new-refresh');
    expect(localStorage.getItem('accessToken')).toBe('new-access');
    expect(localStorage.getItem('refreshToken')).toBe('new-refresh');
  });

  it('clearTokens removes everything', async () => {
    const { saveTokens, clearTokens, getAccessToken } = await import('../tokenStore.js');
    saveTokens({ accessToken: 'a', refreshToken: 'b' });

    clearTokens();

    expect(getAccessToken()).toBeNull();
    expect(localStorage.getItem('accessToken')).toBeNull();
  });

  it('saveTokens/clearTokens notify subscribers in the SAME tab', async () => {
    const { saveTokens, clearTokens, subscribeToTokenChanges } = await import('../tokenStore.js');
    const listener = vi.fn();
    subscribeToTokenChanges(listener);

    saveTokens({ accessToken: 'a', refreshToken: 'b' });
    expect(listener).toHaveBeenCalledTimes(1);

    clearTokens();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('unsubscribe actually stops notifications', async () => {
    const { saveTokens, subscribeToTokenChanges } = await import('../tokenStore.js');
    const listener = vi.fn();
    const unsubscribe = subscribeToTokenChanges(listener);
    unsubscribe();

    saveTokens({ accessToken: 'a', refreshToken: 'b' });

    expect(listener).not.toHaveBeenCalled();
  });

  it('a storage event (simulating another tab writing to localStorage) updates this tab\'s in-memory state and notifies subscribers — the actual fix for the cross-tab session bug', async () => {
    const { getAccessToken, subscribeToTokenChanges } = await import('../tokenStore.js');
    const listener = vi.fn();
    subscribeToTokenChanges(listener);

    expect(getAccessToken()).toBeNull();

    // Real browsers fire a 'storage' event on every OTHER open tab (never
    // the tab that made the write) whenever localStorage changes — jsdom
    // doesn't auto-dispatch this on same-window localStorage writes, so we
    // simulate what tab 1's login would cause tab 2 to receive.
    localStorage.setItem('accessToken', 'token-from-another-tab');
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'accessToken',
      newValue: 'token-from-another-tab',
      storageArea: localStorage,
    }));

    expect(getAccessToken()).toBe('token-from-another-tab');
    expect(listener).toHaveBeenCalled();
  });

  it('a storage event with key=null (localStorage.clear() in another tab) also syncs', async () => {
    localStorage.setItem('accessToken', 'stale-token');
    const { getAccessToken } = await import('../tokenStore.js');
    expect(getAccessToken()).toBe('stale-token');

    localStorage.clear();
    window.dispatchEvent(new StorageEvent('storage', { key: null, storageArea: localStorage }));

    expect(getAccessToken()).toBeNull();
  });

  it('a storage event for an unrelated key is ignored', async () => {
    const { subscribeToTokenChanges } = await import('../tokenStore.js');
    const listener = vi.fn();
    subscribeToTokenChanges(listener);

    window.dispatchEvent(new StorageEvent('storage', { key: 'someUnrelatedKey', newValue: 'x' }));

    expect(listener).not.toHaveBeenCalled();
  });

  describe('isAccessTokenExpired', () => {
    it('is true when there is no token', async () => {
      const { isAccessTokenExpired } = await import('../tokenStore.js');
      expect(isAccessTokenExpired()).toBe(true);
    });

    it('is false for a token that expires well in the future', async () => {
      const { saveTokens, isAccessTokenExpired } = await import('../tokenStore.js');
      const token = makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
      saveTokens({ accessToken: token, refreshToken: 'r' });

      expect(isAccessTokenExpired()).toBe(false);
    });

    it('is true for a token that already expired', async () => {
      const { saveTokens, isAccessTokenExpired } = await import('../tokenStore.js');
      const token = makeJwt({ exp: Math.floor(Date.now() / 1000) - 3600 });
      saveTokens({ accessToken: token, refreshToken: 'r' });

      expect(isAccessTokenExpired()).toBe(true);
    });

    it('is true within the safety buffer even if technically not expired yet', async () => {
      const { saveTokens, isAccessTokenExpired } = await import('../tokenStore.js');
      const token = makeJwt({ exp: Math.floor(Date.now() / 1000) + 5 }); // 5s from now
      saveTokens({ accessToken: token, refreshToken: 'r' });

      expect(isAccessTokenExpired(10)).toBe(true); // 10s buffer > 5s remaining
    });

    it('is true for a malformed token rather than throwing', async () => {
      const { saveTokens, isAccessTokenExpired } = await import('../tokenStore.js');
      saveTokens({ accessToken: 'not-a-real-jwt', refreshToken: 'r' });

      expect(isAccessTokenExpired()).toBe(true);
    });
  });

  describe('parseJwtPayload (base64url handling)', () => {
    it('correctly decodes a payload containing base64url-only characters (- and _)', async () => {
      const { parseJwtPayload } = await import('../tokenStore.js');
      // Craft a payload whose base64 encoding is very likely to contain
      // '+' or '/' in standard base64 (becoming '-'/'_' in base64url) —
      // this is the exact bug: plain atob() on this would throw or
      // misdecode.
      const payload = { orgId: 'org-????>>>???___###', sub: 'user-1', role: 'owner', email: 'a@b.test' };
      const token = makeJwt(payload);

      const decoded = parseJwtPayload(token);

      expect(decoded.orgId).toBe(payload.orgId);
      expect(decoded.sub).toBe('user-1');
    });
  });
});
