/**
 * Built-in task storage for the ambient assistant — per your decision to
 * skip external trackers (Taiga/Jira) for now. Follows the exact same
 * pluggable-interface pattern as every other store in this codebase —
 * swapping in a TaigaAdapter later means writing one class against this
 * interface, not a rewrite. See AMBIENT_BOT_ARCHITECTURE_PLAN.md §6.
 */
export interface Task {
  id: string;
  orgId: string;
  title: string;
  description?: string;
  /** Discord display name, freeform for now — no identity resolution against Discord accounts. */
  assignee?: string;
  status: 'open' | 'closed';
  /** Discord display name of whoever asked the bot to create this task. */
  createdBy: string;
  createdAt: number;
  closedAt: number | null;
  /** Which ambient channel's session created this task — useful for audit/debugging. */
  sourceChannelId: string;
}

export type TaskInput = Omit<Task, 'id' | 'orgId' | 'status' | 'createdAt' | 'closedAt'>;

/** Editable fields for an existing task. `assignee` is either a Taiga
 *  username or a display name that gets resolved against the project's
 *  membership list (same loose matching the close() path uses for titles). */
export type TaskChanges = Partial<Pick<Task, 'title' | 'description' | 'assignee'>>;

export interface TaskStore {
  create(orgId: string, input: TaskInput): Promise<Task>;
  /** Matches by exact id first, then falls back to a case-insensitive
   *  substring match against open tasks' titles — voice input won't
   *  reliably produce an exact task id, so title matching is the practical
   *  path for "close the login bug task." */
  close(orgId: string, taskIdOrTitle: string): Promise<Task | null>;
  /** Matches by id then title (same rules as close), applies only the
   *  fields present in `changes`, and returns the updated task. This is
   *  what powers "assign task 3 to Alice" and "change the title". */
  update(orgId: string, taskIdOrTitle: string, changes: TaskChanges): Promise<Task | null>;
  list(orgId: string, status?: 'open' | 'closed'): Promise<Task[]>;
  get(orgId: string, id: string): Promise<Task | null>;
}

/**
 * Optional PM-platform surface. Only TaigaTaskStore implements this — it
 * lets the voice bot answer sprint/member queries with real data instead of
 * being limited to the task store's own slice. Tools that need it degrade
 * gracefully when a plain Mongo/Kafka store is in use.
 */
export interface TaskStorePmSurface {
  getProjectLabel(): Promise<string>;
  getActiveSprint(): Promise<Record<string, unknown> | null>;
  listMembers(): Promise<Array<Record<string, string | number>>>;
}

export function isPmSurfaceStore(store: TaskStore): store is TaskStore & TaskStorePmSurface {
  const surface = store as Partial<TaskStorePmSurface>;
  return typeof surface.getActiveSprint === 'function' && typeof surface.listMembers === 'function';
}
