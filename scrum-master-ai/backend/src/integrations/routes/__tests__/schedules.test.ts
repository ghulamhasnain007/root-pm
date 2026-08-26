import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type { ScheduledMeetingStore } from '../../scheduling/ScheduledMeetingStore.js';
import type { ScheduledMeeting } from '../../scheduling/types.js';

vi.mock('../../../auth/jwksVerifier.js', () => ({
  verifyAccessToken: vi.fn(),
}));

function fakeStore(): ScheduledMeetingStore {
  return {
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    get: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
    listAllEnabled: vi.fn(),
    recordRun: vi.fn(),
    disable: vi.fn(),
  };
}

describe('schedules routes — org resolution', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.AUTH_SERVICE_URL = 'http://auth-service:4000';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
    vi.restoreAllMocks();
  });

  async function buildApp(store: ScheduledMeetingStore) {
    vi.resetModules();
    const { default: registerScheduleRoutes } = await import('../schedules.js');
    const app = Fastify();
    registerScheduleRoutes(app, { store });
    return app;
  }

  it('rejects requests with no token — no more silent default-org fallback', async () => {
    const store = fakeStore();
    const app = await buildApp(store);

    const resp = await app.inject({ method: 'GET', url: '/integrations/schedules' });

    expect(resp.statusCode).toBe(401);
    expect(store.list).not.toHaveBeenCalled();
  });

  it('scopes list() to the authenticated caller\'s real org, not a hardcoded constant', async () => {
    const { verifyAccessToken } = await import('../../../auth/jwksVerifier.js');
    vi.mocked(verifyAccessToken).mockResolvedValue({
      orgId: 'org-real-123', userId: 'u1', role: 'owner', email: 'a@b.test',
    });

    const store = fakeStore();
    const app = await buildApp(store);

    await app.inject({ method: 'GET', url: '/integrations/schedules', headers: { authorization: 'Bearer valid' } });

    expect(store.list).toHaveBeenCalledWith('org-real-123');
    expect(store.list).not.toHaveBeenCalledWith('default');
  });

  it('two different orgs get routed to their own data, not a shared default', async () => {
    const { verifyAccessToken } = await import('../../../auth/jwksVerifier.js');
    const store = fakeStore();
    const app = await buildApp(store);

    vi.mocked(verifyAccessToken).mockResolvedValueOnce({ orgId: 'org-a', userId: 'u1', role: 'owner', email: 'a@a.test' });
    await app.inject({ method: 'GET', url: '/integrations/schedules', headers: { authorization: 'Bearer token-a' } });

    vi.mocked(verifyAccessToken).mockResolvedValueOnce({ orgId: 'org-b', userId: 'u2', role: 'owner', email: 'b@b.test' });
    await app.inject({ method: 'GET', url: '/integrations/schedules', headers: { authorization: 'Bearer token-b' } });

    expect(store.list).toHaveBeenNthCalledWith(1, 'org-a');
    expect(store.list).toHaveBeenNthCalledWith(2, 'org-b');
  });

  it('create() passes the authenticated org through to the store', async () => {
    const { verifyAccessToken } = await import('../../../auth/jwksVerifier.js');
    vi.mocked(verifyAccessToken).mockResolvedValue({ orgId: 'org-xyz', userId: 'u1', role: 'owner', email: 'a@b.test' });

    const store = fakeStore();
    vi.mocked(store.create).mockResolvedValue({ id: 'sched1' } as ScheduledMeeting);
    const app = await buildApp(store);

    const payload = {
      title: 'Daily standup', guildId: 'g1', channelId: 'c1',
      recurrence: 'weekly', daysOfWeek: [1, 2, 3, 4, 5],
      time: '09:00', timezone: 'UTC', durationMs: 900000,
    };
    await app.inject({
      method: 'POST', url: '/integrations/schedules',
      headers: { authorization: 'Bearer valid' }, payload,
    });

    expect(store.create).toHaveBeenCalledWith('org-xyz', expect.objectContaining({ title: 'Daily standup' }));
  });

  it('rejects an invalid/expired token', async () => {
    const { verifyAccessToken } = await import('../../../auth/jwksVerifier.js');
    vi.mocked(verifyAccessToken).mockRejectedValue(new Error('expired'));

    const store = fakeStore();
    const app = await buildApp(store);

    const resp = await app.inject({ method: 'GET', url: '/integrations/schedules', headers: { authorization: 'Bearer expired-token' } });

    expect(resp.statusCode).toBe(401);
    expect(store.list).not.toHaveBeenCalled();
  });
});

describe('schedules routes — single-org fallback mode (AUTH_SERVICE_URL unset)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.AUTH_SERVICE_URL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it('works with no token at all, scoped to "default" — preserves standalone-dev behavior', async () => {
    vi.resetModules();
    const { default: registerScheduleRoutes } = await import('../schedules.js');
    const store = fakeStore();
    const app = Fastify();
    registerScheduleRoutes(app, { store });

    const resp = await app.inject({ method: 'GET', url: '/integrations/schedules' });

    expect(resp.statusCode).toBe(200);
    expect(store.list).toHaveBeenCalledWith('default');
  });
});
