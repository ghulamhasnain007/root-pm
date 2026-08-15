import { isPmSurfaceStore, type TaskStore, type Task, type TaskChanges } from '../../../services/tasks/TaskStore.js';
import type { AmbientFunctionCall, AmbientFunctionDeclaration } from '../../../services/GeminiAmbientService.js';

/** The tools registered with Gemini once task actions are enabled — passed
 *  into GeminiAmbientService via DiscordAmbientRoom's functionHandling
 *  extension point (see systemPrompt.ts for the matching prompt section). */
export const AMBIENT_TASK_TOOLS: AmbientFunctionDeclaration[] = [
  {
    name: 'create_task',
    description: 'Create a new task. Only call this when explicitly asked to create/add a task.',
    parameters: {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING', description: 'Short task title' },
        description: { type: 'STRING', description: 'Optional additional detail' },
        assignee: { type: 'STRING', description: 'Optional — who the task is for, by name' },
      },
      required: ['title'],
    },
  },
  {
    name: 'close_task',
    description: 'Mark a task as closed/done. Only call this when explicitly asked to close/complete a task.',
    parameters: {
      type: 'OBJECT',
      properties: {
        taskIdOrTitle: { type: 'STRING', description: "The task's id, or its title (or a close match to it)" },
      },
      required: ['taskIdOrTitle'],
    },
  },
  {
    name: 'list_tasks',
    description: 'List current tasks. Only call this when explicitly asked what tasks are open or closed.',
    parameters: {
      type: 'OBJECT',
      properties: {
        status: { type: 'STRING', enum: ['open', 'closed'], description: 'Optional filter' },
      },
      required: [],
    },
  },
  {
    name: 'update_task',
    description:
      "Update or assign an existing task. Use this when someone asks to assign a task to a person, or to change a task's title or description (e.g. \"assign task 42 to Alice\", \"change the login bug task to be about 2FA\"). Only call when explicitly asked.",
    parameters: {
      type: 'OBJECT',
      properties: {
        taskIdOrTitle: { type: 'STRING', description: "The task's id, or its title (or a close match to it)" },
        title: { type: 'STRING', description: 'Optional — new title' },
        description: { type: 'STRING', description: 'Optional — new description' },
        assignee: { type: 'STRING', description: 'Optional — who to assign the task to, by name' },
      },
      required: ['taskIdOrTitle'],
    },
  },
  {
    name: 'list_members',
    description:
      "List the team members in the current project with their usernames. Use this before assigning a task so you use a valid name. Only call when explicitly asked, or when you need a username to assign a task.",
    parameters: { type: 'OBJECT', properties: {}, required: [] },
  },
  {
    name: 'get_sprint',
    description:
      "Get the current active sprint's name, end date and progress. Only call when explicitly asked about the sprint or milestone status.",
    parameters: { type: 'OBJECT', properties: {}, required: [] },
  },
];

export type AmbientTaskActionResult =
  | { success: true; task: Task }
  | { success: true; tasks: Task[] }
  | { success: true; sprint: Record<string, unknown> }
  | { success: true; members: Array<Record<string, string | number>> }
  | { success: false; reason: string };

/**
 * Resolves a Gemini function call against the built-in TaskStore. Returned
 * object becomes the function response sent back to Gemini — kept as plain
 * JSON-serializable data so the model can reference it in its spoken
 * confirmation (e.g. "created task: fix the login bug").
 */
export async function handleAmbientFunctionCall(
  store: TaskStore,
  orgId: string,
  channelId: string,
  createdBy: string,
  call: AmbientFunctionCall
): Promise<AmbientTaskActionResult> {
  switch (call.name) {
    case 'create_task': {
      const title = String(call.args.title ?? '').trim();
      if (!title) return { success: false, reason: 'title is required' };
      const task = await store.create(orgId, {
        title,
        description: call.args.description ? String(call.args.description) : undefined,
        assignee: call.args.assignee ? String(call.args.assignee) : undefined,
        createdBy,
        sourceChannelId: channelId,
      });
      return { success: true, task };
    }

    case 'close_task': {
      const idOrTitle = String(call.args.taskIdOrTitle ?? '').trim();
      if (!idOrTitle) return { success: false, reason: 'taskIdOrTitle is required' };
      const task = await store.close(orgId, idOrTitle);
      return task ? { success: true, task } : { success: false, reason: 'no matching open task found' };
    }

    case 'list_tasks': {
      const status = call.args.status === 'open' || call.args.status === 'closed' ? call.args.status : undefined;
      const tasks = await store.list(orgId, status);
      return { success: true, tasks };
    }

    case 'update_task': {
      const idOrTitle = String(call.args.taskIdOrTitle ?? '').trim();
      if (!idOrTitle) return { success: false, reason: 'taskIdOrTitle is required' };

      const changes: TaskChanges = {};
      if (call.args.title !== undefined) changes.title = String(call.args.title);
      if (call.args.description !== undefined) changes.description = String(call.args.description);
      if (call.args.assignee !== undefined) changes.assignee = String(call.args.assignee);
      if (Object.keys(changes).length === 0) {
        return { success: false, reason: 'provide at least one of: title, description, assignee' };
      }

      const task = await store.update(orgId, idOrTitle, changes);
      return task ? { success: true, task } : { success: false, reason: 'no matching open task found' };
    }

    case 'list_members': {
      if (!isPmSurfaceStore(store)) {
        return {
          success: false,
          reason: 'member queries need the Taiga store — configure TAIGA_URL, TAIGA_USER, TAIGA_PASS and TAIGA_PROJECT_SLUG',
        };
      }
      const members = await store.listMembers();
      return { success: true, members };
    }

    case 'get_sprint': {
      if (!isPmSurfaceStore(store)) {
        return {
          success: false,
          reason: 'sprint queries need the Taiga store — configure TAIGA_URL, TAIGA_USER, TAIGA_PASS and TAIGA_PROJECT_SLUG',
        };
      }
      const sprint = await store.getActiveSprint();
      return sprint ? { success: true, sprint } : { success: false, reason: 'no active sprint found in this project' };
    }

    default:
      return { success: false, reason: `unknown function ${call.name}` };
  }
}
