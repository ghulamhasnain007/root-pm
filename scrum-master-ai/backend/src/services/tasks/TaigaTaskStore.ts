/**
 * tasks/TaigaTaskStore.ts
 * ──────────────────────
 * TaskStore + PM-surface (TaskStorePmSurface) implementation backed directly
 * by the Taiga REST API. This is what "expose taiga/pm-platform to the voice
 * bot" means in practice: when TAIGA_URL/TAIGA_USER/TAIGA_PASS/TAIGA_PROJECT_SLUG
 * are configured, the ambient voice assistant reads and writes the real
 * project tracker instead of only its own MongoDB slice.
 *
 * Mirrors the agent-bridge Python adapter (backend/platforms/pm/taiga_platform.py)
 * so both the chat agent and the voice bot behave the same against Taiga.
 */
import type { TaskStore, Task, TaskInput, TaskChanges, TaskStorePmSurface } from './TaskStore.js';

export interface TaigaStoreConfig {
  /** Taiga API base, e.g. "https://api.taiga.io/api/v1" */
  url: string;
  username: string;
  password: string;
  projectSlug: string;
}

/** Type alias (not interface) so assignments to Record<string, ...> keep
 *  their implicit index signature. */
type TaigaMember = {
  id: number;
  username: string;
  fullName: string;
  role: string;
};

interface TaigaRawTask {
  id: number;
  ref: number;
  subject: string;
  description: string;
  status: number;
  status_extra_info?: { name?: string };
  assigned_to?: number | null;
  assigned_to_extra_info?: { username?: string };
  tags: string[];
  version: number;
  created_date: string;
  finished_date?: string;
  is_closed?: boolean;
}

/** Thin REST client — same auth/retry shape as the Python _TaigaHTTP. */
class TaigaHttp {
  private token: string | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly username: string,
    private readonly password: string
  ) {}

  async login(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'normal', username: this.username, password: this.password }),
    });
    if (!res.ok) {
      throw new Error(`Taiga auth failed (${res.status}): ${await this.body(res)}`);
    }
    const data = (await res.json()) as { auth_token: string };
    this.token = data.auth_token;
  }

  private async headers(): Promise<Record<string, string>> {
    if (!this.token) await this.login();
    return { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' };
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res = await this.raw(method, path, body);
    if (res.status === 401 && this.token) {
      this.token = null;
      res = await this.raw(method, path, body);
    }
    if (!res.ok) {
      throw new Error(`Taiga ${method} ${path} failed (${res.status}): ${await this.body(res)}`);
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  private async raw(method: string, path: string, body?: unknown): Promise<Response> {
    const query = method === 'GET' && body ? `?${new URLSearchParams(body as Record<string, string>).toString()}` : '';
    return fetch(`${this.baseUrl}${path}${query}`, {
      method,
      headers: await this.headers(),
      ...(method !== 'GET' && body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }

  private async body(res: Response): Promise<string> {
    try {
      return (await res.text()).slice(0, 300);
    } catch {
      return '<no body>';
    }
  }
}

export class TaigaTaskStore implements TaskStore, TaskStorePmSurface {
  /** Attribute retained purely for parity with the other stores — Taiga has
   *  no per-task channel field, so reads come back with this blank. */
  private readonly sourceChannelId = '';

  private http: TaigaHttp;
  private projectId: string | null = null;
  private projectName: string | null = null;
  private closedStatusIds = new Set<number>();
  private members: TaigaMember[] | null = null;

  constructor(private readonly config: TaigaStoreConfig) {
    this.http = new TaigaHttp(config.url, config.username, config.password);
  }

  // ── PM helpers ────────────────────────────────────────────────────────

  private async resolveProjectId(): Promise<string> {
    if (this.projectId) return this.projectId;
    const data = await this.http.request<{ id: number }>('GET', '/projects/by_slug', { slug: this.config.projectSlug });
    this.projectId = String(data.id);
    return this.projectId;
  }

  private async ensureStatuses(projectId: string): Promise<void> {
    if (this.closedStatusIds.size) return;
    const statuses = await this.http.request<Array<{ id: number; is_closed?: boolean }>>(
      'GET', '/tasks/statuses', { project: projectId }
    );
    this.closedStatusIds = new Set(statuses.filter(s => s.is_closed).map(s => s.id));
  }

  async listMembers(): Promise<Array<Record<string, string | number>>> {
    return this.typedMembers();
  }

  private async typedMembers(): Promise<TaigaMember[]> {
    if (this.members) return this.members;
    const projectId = await this.resolveProjectId();
    const raw = await this.http.request<Array<{
      user: number;
      full_name?: string;
      role_name?: string;
      user_extra_info?: { username?: string };
    }>>('GET', '/memberships', { project: projectId });
    this.members = raw.map(m => ({
      id: m.user,
      username: m.user_extra_info?.username ?? '',
      fullName: m.full_name ?? '',
      role: m.role_name ?? '',
    }));
    return this.members;
  }

  /** Resolve a freeform assignee name (Discord display name, username, or
   *  substring) to a Taiga member object. Throws when no member matches so
   *  the voice bot can immediately ask to check the member list. */
  private async resolveAssignee(name: string): Promise<{ id: number; username: string }> {
    const target = name.trim().toLowerCase();
    const members = await this.typedMembers();
    const exact = members.find(
      m => m.username.toLowerCase() === target || m.fullName.toLowerCase() === target
    );
    if (exact) return { id: exact.id, username: exact.username };
    const partial = members.find(
      m => m.username.toLowerCase().includes(target) || m.fullName.toLowerCase().includes(target)
    );
    if (partial) return { id: partial.id, username: partial.username };
    throw new Error(`User "${name}" not found in the Taiga project. Use the list_members tool to see valid names.`);
  }

  async getProjectLabel(): Promise<string> {
    if (this.projectName) return this.projectName;
    const projectId = await this.resolveProjectId();
    const project = await this.http.request<{ name: string }>('GET', `/projects/${projectId}`);
    this.projectName = project.name;
    return project.name;
  }

  async getActiveSprint(): Promise<Record<string, unknown> | null> {
    const projectId = await this.resolveProjectId();
    const sprints = await this.http.request<Array<{
      name: string;
      estimated_finish?: string;
      closed_points?: number;
      total_points?: number;
      closed?: boolean;
    }>>('GET', '/milestones', { project: projectId });
    const active = sprints.find(s => !s.closed);
    if (!active) return null;
    return {
      name: active.name ?? 'Unnamed',
      estimatedFinish: active.estimated_finish ?? null,
      closedPoints: active.closed_points ?? 0,
      totalPoints: active.total_points ?? 0,
    };
  }

  // ── TaskStore ─────────────────────────────────────────────────────────

  async create(orgId: string, input: TaskInput): Promise<Task> {
    const projectId = await this.resolveProjectId();
    const payload: Record<string, unknown> = {
      project: Number(projectId),
      subject: input.title,
      description: input.description ?? '',
      tags: [],
    };
    if (input.assignee) {
      const member = await this.resolveAssignee(input.assignee);
      payload.assigned_to = member.id;
    }
    const raw = await this.http.request<TaigaRawTask>('POST', '/tasks', payload);
    return this.toTask(orgId, raw);
  }

  async close(orgId: string, taskIdOrTitle: string): Promise<Task | null> {
    const projectId = await this.resolveProjectId();
    await this.ensureStatuses(projectId);
    const raw = await this.findOpenTask(projectId, taskIdOrTitle);
    if (!raw) return null;
    const closedStatus = this.closedStatusIds.values().next().value;
    const updated = await this.http.request<TaigaRawTask>('PATCH', `/tasks/${raw.id}`, {
      status: closedStatus,
      version: raw.version,
    });
    return this.toTask(orgId, updated);
  }

  async update(orgId: string, taskIdOrTitle: string, changes: TaskChanges): Promise<Task | null> {
    const projectId = await this.resolveProjectId();
    const raw = await this.findOpenTask(projectId, taskIdOrTitle);
    if (!raw) return null;

    const patch: Record<string, unknown> = { version: raw.version };
    if (changes.title !== undefined) patch.subject = changes.title;
    if (changes.description !== undefined) patch.description = changes.description;
    if (changes.assignee !== undefined) {
      const member = await this.resolveAssignee(changes.assignee);
      patch.assigned_to = member.id;
    }

    const updated = await this.http.request<TaigaRawTask>('PATCH', `/tasks/${raw.id}`, patch);
    return this.toTask(orgId, updated);
  }

  async list(orgId: string, status?: 'open' | 'closed'): Promise<Task[]> {
    const projectId = await this.resolveProjectId();
    const params: Record<string, string> = { project: projectId };
    if (status === 'open') params['status__is_closed'] = 'false';
    if (status === 'closed') params['status__is_closed'] = 'true';
    const raws = await this.http.request<TaigaRawTask[]>('GET', '/tasks', params);
    return Promise.all(raws.map(raw => this.toTask(orgId, raw)));
  }

  async get(orgId: string, id: string): Promise<Task | null> {
    const raw = await this.http.request<TaigaRawTask>('GET', `/tasks/${id}`).catch(() => null);
    return raw ? this.toTask(orgId, raw) : null;
  }

  // ── Internals ─────────────────────────────────────────────────────────

  /** Matches by numeric Taiga id first, then case-insensitive title
   *  substring across OPEN tasks — mirrors the voice close/update flow. */
  private async findOpenTask(projectId: string, idOrTitle: string): Promise<TaigaRawTask | null> {
    const trimmed = idOrTitle.trim();
    if (/^\d+$/.test(trimmed)) {
      const byId = await this.http.request<TaigaRawTask>('GET', `/tasks/${trimmed}`).catch(() => null);
      if (byId) return byId;
    }
    const open = await this.http.request<TaigaRawTask[]>('GET', '/tasks', {
      project: projectId,
      status__is_closed: 'false',
    });
    const needle = trimmed.toLowerCase();
    const match = open.find(t => t.subject.toLowerCase().includes(needle));
    return match ?? null;
  }

  private async toTask(orgId: string, raw: TaigaRawTask): Promise<Task> {
    if (!this.closedStatusIds.size) {
      try {
        await this.ensureStatuses(await this.resolveProjectId());
      } catch {
        // Non-fatal — isClosed below falls back to raw.is_closed.
      }
    }
    let isClosed = raw.is_closed === true;
    if (this.closedStatusIds.has(raw.status)) isClosed = true;

    const created = raw.created_date ? Date.parse(raw.created_date) : Date.now();
    return {
      id: String(raw.id),
      orgId,
      title: raw.subject,
      description: raw.description || undefined,
      assignee: raw.assigned_to_extra_info?.username,
      status: isClosed ? 'closed' : 'open',
      createdBy: 'voice-bot',
      createdAt: Number.isNaN(created) ? Date.now() : created,
      closedAt: isClosed ? (raw.finished_date ? Date.parse(raw.finished_date) : Date.now()) : null,
      sourceChannelId: this.sourceChannelId,
    };
  }
}