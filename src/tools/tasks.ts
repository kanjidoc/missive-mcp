import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { missiveRequest } from "../missive-client";
import { handle, errorResult, optionalOrg, optionalTeam } from "../tool-helpers";

/**
 * Task tools (GET `/tasks`, GET `/tasks/:id`, POST `/tasks`,
 * PATCH `/tasks/:id`). Tasks are Missive's standalone or conversation-scoped
 * to-do items, with a state, optional due date, and a team or assignees.
 *
 * Bodies are assembled field-by-field from declared zod fields only (no
 * passthrough, no freeform JSON) so the request surface is exactly what the
 * tool documents. Create/update bodies use the `{ tasks: {...} }` envelope.
 */

/** Task states accepted by the Missive task endpoints. */
const STATE = ["todo", "in_progress", "closed"] as const;
/** Task `type` filter values for the list endpoint. */
const TYPE = ["task", "conversation", "all"] as const;

/** A task object as sent to POST `/tasks` (body shape `{ tasks: {...} }`). */
interface TaskCreate {
  title: string;
  description?: string;
  state?: (typeof STATE)[number];
  organization?: string;
  team?: string;
  assignees?: string[];
  due_at?: number;
  subtask?: boolean;
  conversation?: string;
  references?: string[];
  conversation_subject?: string;
  add_users?: string[];
  add_to_inbox?: boolean;
}

/** A task object as sent to PATCH `/tasks/:id` (body shape `{ tasks: {...} }`). */
interface TaskUpdate {
  title?: string;
  description?: string;
  state?: (typeof STATE)[number];
  assignees?: string[];
  team?: string;
  due_at?: number;
}

/**
 * `missive_list_tasks` — GET `/tasks`.
 * Lists tasks the authenticated user can access, ordered by last activity
 * (most recent first). `organization` is an OPTIONAL filter (explicit arg →
 * MISSIVE_DEFAULT_ORGANIZATION → omitted, listing across all accessible orgs).
 * Pagination is CURSOR-style via `until` (a Unix `last_activity_at`), NOT offset.
 */
export const listTasks = tool(
  "missive_list_tasks",
  "Lists tasks you can access, ordered by last activity (most recent first). `organization` is an optional filter. Filter by state, type, team, assignee, parent conversation, or due-date range. Paginate with `until` (cursor on last_activity_at) — there is no offset.",
  {
    organization: z
      .string()
      .optional()
      .describe(
        "Optional organization ID to filter by. Defaults to MISSIVE_DEFAULT_ORGANIZATION if set; otherwise lists across all accessible organizations.",
      ),
    state: z
      .enum(STATE)
      .optional()
      .describe("Filter by task state: 'todo', 'in_progress', or 'closed'."),
    type: z
      .enum(TYPE)
      .optional()
      .describe(
        "Filter by type: 'task' (tasks only), 'conversation' (tasked conversations only), or 'all' (both; the API default).",
      ),
    team: z.string().optional().describe("Filter by team ID."),
    assignee: z.string().optional().describe("Filter by assignee user ID."),
    conversation: z
      .string()
      .optional()
      .describe("Filter by parent conversation ID (returns subtasks of that conversation)."),
    due_at_gteq: z
      .number()
      .int()
      .optional()
      .describe("Filter to tasks whose `due_at` is greater than or equal to this Unix timestamp."),
    due_at_lteq: z
      .number()
      .int()
      .optional()
      .describe("Filter to tasks whose `due_at` is less than or equal to this Unix timestamp."),
    limit: z
      .number()
      .int()
      .min(2)
      .max(50)
      .optional()
      .describe("Number of tasks to return (min 2, max 50)."),
    until: z
      .number()
      .int()
      .optional()
      .describe(
        "Unix timestamp for cursor pagination: returns tasks with last_activity_at before (and including) this value. Pass the last task's last_activity_at minus 1 to fetch the next page without duplicates.",
      ),
  },
  async (args) => {
    const organization = optionalOrg(args.organization);
    return handle(() =>
      missiveRequest("GET", "/tasks", {
        query: {
          organization,
          state: args.state,
          type: args.type,
          team: args.team,
          assignee: args.assignee,
          conversation: args.conversation,
          due_at_gteq: args.due_at_gteq,
          due_at_lteq: args.due_at_lteq,
          limit: args.limit,
          until: args.until,
        },
      }),
    );
  },
  { annotations: { readOnlyHint: true } },
);

/**
 * `missive_get_task` — GET `/tasks/:id`.
 * Returns a single task with full details (assignees and team as full objects).
 */
export const getTask = tool(
  "missive_get_task",
  "Gets a single task by ID, with full details including expanded assignee and team objects.",
  {
    task_id: z.string().describe("ID of the task to retrieve."),
  },
  async (args) => handle(() => missiveRequest("GET", `/tasks/${args.task_id}`, {})),
  { annotations: { readOnlyHint: true } },
);

/**
 * `missive_create_task` — POST `/tasks`.
 * Creates a standalone task, a tasked conversation, or a subtask inside a
 * conversation. Body shape `{ tasks: {...} }`. `organization` is required when
 * assigning a team, assignees, or add_users (falls back to the env default);
 * a subtask requires a parent `conversation` ID or `references`.
 */
export const createTask = tool(
  "missive_create_task",
  "Creates a task in Missive (standalone task, tasked conversation, or a subtask inside a conversation). Tasks created via the API appear in the Tasks view, not the Inbox. `title` is required; `organization` is required when using `team`, `assignees`, or `add_users` (defaults to MISSIVE_DEFAULT_ORGANIZATION); a subtask requires `conversation` or `references`.",
  {
    title: z.string().describe("Task title (required, max 1000 characters)."),
    description: z
      .string()
      .optional()
      .describe("Task description, plain text (max 10000 characters)."),
    state: z
      .enum(STATE)
      .optional()
      .describe("Initial task state: 'todo', 'in_progress', or 'closed'. Defaults to 'todo'."),
    organization: z
      .string()
      .optional()
      .describe(
        "Organization ID. Required when using `team`, `assignees`, or `add_users`. Defaults to MISSIVE_DEFAULT_ORGANIZATION if set.",
      ),
    team: z
      .string()
      .optional()
      .describe(
        "Team ID to assign the task to. For a standalone task, either `team` or `assignees` is required.",
      ),
    assignees: z
      .array(z.string())
      .optional()
      .describe(
        "Array of user IDs to assign the task to. For a standalone task, either `team` or `assignees` is required.",
      ),
    due_at: z
      .number()
      .int()
      .optional()
      .describe("Unix timestamp for when the task is due."),
    subtask: z
      .boolean()
      .optional()
      .describe(
        "Set true to create this task as a subtask inside a conversation. Requires `conversation` or `references`.",
      ),
    conversation: z
      .string()
      .optional()
      .describe("Parent conversation ID for a subtask (required when `subtask` is true)."),
    references: z
      .array(z.string())
      .optional()
      .describe(
        "Message references (e.g. email Message-IDs) used to find or create the parent conversation for a subtask, as an alternative to `conversation`.",
      ),
    conversation_subject: z
      .string()
      .optional()
      .describe(
        "Subject for the parent conversation when creating it via `references` (only used when a new conversation is created).",
      ),
    add_users: z
      .array(z.string())
      .optional()
      .describe(
        "User IDs to add to the parent conversation (subtasks only). Requires `organization`.",
      ),
    add_to_inbox: z
      .boolean()
      .optional()
      .describe(
        "Set true to move the parent conversation to the Inbox for everyone with access (subtasks only).",
      ),
  },
  async (args) => {
    const organization = optionalOrg(args.organization);
    const team = optionalTeam(args.team);
    const needsOrg =
      team !== undefined ||
      (args.assignees?.length ?? 0) > 0 ||
      (args.add_users?.length ?? 0) > 0;
    if (needsOrg && !organization) {
      return errorResult(
        "organization is required when assigning a task to a team, assignees, or add_users: pass `organization` explicitly or set MISSIVE_DEFAULT_ORGANIZATION.",
      );
    }
    if (
      args.subtask === true &&
      args.conversation === undefined &&
      (args.references?.length ?? 0) === 0
    ) {
      return errorResult(
        "A subtask requires a parent `conversation` ID or `references` to find or create the parent conversation.",
      );
    }
    return handle(() => {
      const task: TaskCreate = { title: args.title };
      if (args.description !== undefined) task.description = args.description;
      if (args.state !== undefined) task.state = args.state;
      if (organization !== undefined && (needsOrg || args.organization !== undefined)) {
        task.organization = organization;
      }
      if (team !== undefined) task.team = team;
      if (args.assignees !== undefined) task.assignees = args.assignees;
      if (args.due_at !== undefined) task.due_at = args.due_at;
      if (args.subtask !== undefined) task.subtask = args.subtask;
      if (args.conversation !== undefined) task.conversation = args.conversation;
      if (args.references !== undefined) task.references = args.references;
      if (args.conversation_subject !== undefined) {
        task.conversation_subject = args.conversation_subject;
      }
      if (args.add_users !== undefined) task.add_users = args.add_users;
      if (args.add_to_inbox !== undefined) task.add_to_inbox = args.add_to_inbox;
      return missiveRequest("POST", "/tasks", { body: { tasks: task } });
    });
  },
  { annotations: { destructiveHint: false } },
);

/**
 * `missive_update_task` — PATCH `/tasks/:id`.
 * Updates a single task's attributes. Body shape `{ tasks: {...} }`. Only the
 * fields you pass are changed.
 */
export const updateTask = tool(
  "missive_update_task",
  "Updates a single task's attributes (title, description, state, assignees, team, due date). Only the fields you include are changed.",
  {
    task_id: z.string().describe("ID of the task to update."),
    title: z.string().optional().describe("New task title (max 1000 characters)."),
    description: z
      .string()
      .optional()
      .describe("New task description, plain text (max 10000 characters)."),
    state: z
      .enum(STATE)
      .optional()
      .describe("New task state: 'todo', 'in_progress', or 'closed'."),
    assignees: z
      .array(z.string())
      .optional()
      .describe("New array of assignee user IDs (replaces the current assignees)."),
    team: z.string().optional().describe("New team ID for the task."),
    due_at: z
      .number()
      .int()
      .optional()
      .describe("New due date as a Unix timestamp."),
  },
  async (args) =>
    handle(() => {
      const task: TaskUpdate = {};
      if (args.title !== undefined) task.title = args.title;
      if (args.description !== undefined) task.description = args.description;
      if (args.state !== undefined) task.state = args.state;
      if (args.assignees !== undefined) task.assignees = args.assignees;
      if (args.team !== undefined) task.team = args.team;
      if (args.due_at !== undefined) task.due_at = args.due_at;
      return missiveRequest("PATCH", `/tasks/${args.task_id}`, { body: { tasks: task } });
    }),
  { annotations: { idempotentHint: true, destructiveHint: false } },
);
