import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../jwksVerifier.js', () => ({
  verifyAccessToken: vi.fn(),
}));

function fakeReply() {
  return { code: vi.fn().mockReturnThis() } as any;
}

describe('requireAuth', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
    vi.restoreAllMocks();
  });

  describe('AUTH_SERVICE_URL unset — single-org fallback mode', () => {
    beforeEach(() => {
      delete process.env.AUTH_SERVICE_URL;
    });

    it('sets orgId to "default" without requiring a token', async () => {
      const { requireAuth } = await import('../requireAuth.js');
      const request: any = { headers: {} };
      await requireAuth(request, fakeReply());

      expect(request.orgId).toBe('default');
      expect(request.role).toBe('owner');
    });

    it('isAuthEnforced() reports false', async () => {
      const { isAuthEnforced } = await import('../requireAuth.js');
      expect(isAuthEnforced()).toBe(false);
    });
  });

  describe('AUTH_SERVICE_URL set — real auth enforced', () => {
    beforeEach(() => {
      process.env.AUTH_SERVICE_URL = 'http://auth-service:4000';
    });

    it('rejects a request with no Authorization header', async () => {
      const { requireAuth } = await import('../requireAuth.js');
      const reply = fakeReply();
      const request: any = { headers: {} };

      await expect(requireAuth(request, reply)).rejects.toThrow(/Authentication required/);
      expect(reply.code).toHaveBeenCalledWith(401);
    });

    it('rejects a malformed Authorization header (not Bearer)', async () => {
      const { requireAuth } = await import('../requireAuth.js');
      const reply = fakeReply();
      const request: any = { headers: { authorization: 'Basic abc123' } };

      await expect(requireAuth(request, reply)).rejects.toThrow(/Authentication required/);
    });

    it('rejects a token that fails verification', async () => {
      const { verifyAccessToken } = await import('../jwksVerifier.js');
      vi.mocked(verifyAccessToken).mockRejectedValue(new Error('signature invalid'));

      const { requireAuth } = await import('../requireAuth.js');
      const reply = fakeReply();
      const request: any = { headers: { authorization: 'Bearer bad-token' } };

      await expect(requireAuth(request, reply)).rejects.toThrow(/Invalid or expired token/);
      expect(reply.code).toHaveBeenCalledWith(401);
    });

    it('sets orgId/userId/role from a valid token — never from client input', async () => {
      const { verifyAccessToken } = await import('../jwksVerifier.js');
      vi.mocked(verifyAccessToken).mockResolvedValue({
        orgId: 'org-abc', userId: 'user-123', role: 'admin', email: 'a@b.test',
      });

      const { requireAuth } = await import('../requireAuth.js');
      const request: any = { headers: { authorization: 'Bearer valid-token' } };
      await requireAuth(request, fakeReply());

      expect(request.orgId).toBe('org-abc');
      expect(request.userId).toBe('user-123');
      expect(request.role).toBe('admin');
    });

    it('isAuthEnforced() reports true', async () => {
      const { isAuthEnforced } = await import('../requireAuth.js');
      expect(isAuthEnforced()).toBe(true);
    });
  });
});
