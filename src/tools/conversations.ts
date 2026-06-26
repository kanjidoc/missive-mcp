import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { missiveRequest } from "../missive-client";
import { handle, errorResult, optionalOrg } from "../tool-helpers";
import { joinIds, validateBatchIds } from "../query-helpers";

/**
 * Conversation tools: read conversation lists/details and their nested entries
 * (messages, comments, drafts, posts), plus a silent state-update endpoint.
 *
 * Read tools are read-only. `missive_update_conversations` is a PATCH that
 * changes conversation state (close/reopen, move, assign, label, recolor,
 * rename) WITHOUT creating any visible post — it never sends or transmits
 * anything. Its body is assembled field-by-field from declared zod fields only
 * (no passthrough), so no outbound surface can ever leak through.
 */

/** Mutually-exclusive contact filters on the list endpoint (see in-handler check). */
const CONTACT_FILTER_HINT =
  "Mutually exclusive with `domain` and `contact_organization` — pass at most one of the three.";

/**
 * `missive_list_conversations` — GET /conversations.
 *
 * The API REQUIRES at least one mailbox filter (a boolean mailbox or an
 * ID-based label/team filter); omitting all of them yields a "You need to
 * paginate at least one mailbox" error, so we reject that up front. The
 * `organization` filter is OPTIONAL (resolved via env default, omitted when
 * absent — never an error). `email`/`domain`/`contact_organization` are
 * mutually exclusive.
 */
export const listConversations = tool(
  "missive_list_conversations",
  "Lists conversations visible to the API-token user (GET /conversations), newest activity first. REQUIRES at least one mailbox filter: a boolean (`inbox`, `all`, `assigned`, `closed`, `snoozed`, `flagged`, `trashed`, `junked`, `drafts`) or an ID filter (`shared_label`, `team_inbox`, `team_closed`, `team_all`). `organization` is an optional filter (falls back to MISSIVE_DEFAULT_ORGANIZATION, omitted otherwise). `email`/`domain`/`contact_organization` are mutually exclusive. Paginate with `until` = `last_activity_at` of the oldest conversation from the previous page. Read-only. Conversations where you are only a guest return just `id` and `last_activity_at`.",
  {
    inbox: z.boolean().optional().describe("Pass true to list conversations in the Inbox."),
    all: z.boolean().optional().describe("Pass true to list conversations in the All mailbox."),
    assigned: z
      .boolean()
      .optional()
      .describe("Pass true to list conversations assigned to the user."),
    closed: z.boolean().optional().describe("Pass true to list conversations in Closed."),
    snoozed: z.boolean().optional().describe("Pass true to list conversations in Snoozed."),
    flagged: z
      .boolean()
      .optional()
      .describe("Pass true to list conversations in Starred (flagged)."),
    trashed: z.boolean().optional().describe("Pass true to list conversations in Trash."),
    junked: z
      .boolean()
      .optional()
      .describe("Pass true to list conversations in Spam (a.k.a. Junk)."),
    drafts: z.boolean().optional().describe("Pass true to list conversations in Drafts."),
    shared_label: z
      .string()
      .optional()
      .describe("Shared label ID. List conversations carrying this shared label."),
    team_inbox: z.string().optional().describe("Team ID. List conversations in the team's Inbox."),
    team_closed: z
      .string()
      .optional()
      .describe("Team ID. List conversations in the team's Closed mailbox."),
    team_all: z
      .string()
      .optional()
      .describe("Team ID. List conversations in the team's All mailbox."),
    organization: z
      .string()
      .optional()
      .describe(
        "Optional organization ID filter. Falls back to MISSIVE_DEFAULT_ORGANIZATION; omitted entirely when neither is set. No effect when a shared_label or team_ filter is used.",
      ),
    email: z
      .string()
      .optional()
      .describe(`Filter by a specific contact email address (e.g. user@example.com). ${CONTACT_FILTER_HINT}`),
    domain: z
      .string()
      .optional()
      .describe(`Filter by contacts from an email domain (e.g. example.com, no leading @). ${CONTACT_FILTER_HINT}`),
    contact_organization: z
      .string()
      .optional()
      .describe(`Contact organization/group UUID to filter by. ${CONTACT_FILTER_HINT}`),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe("Number of conversations to return. Default 25, max 50."),
    until: z
      .number()
      .int()
      .optional()
      .describe(
        "Unix timestamp used to paginate: the `last_activity_at` of the oldest conversation from the previous page.",
      ),
  },
  async (args) => {
    const hasMailbox =
      args.inbox === true ||
      args.all === true ||
      args.assigned === true ||
      args.closed === true ||
      args.snoozed === true ||
      args.flagged === true ||
      args.trashed === true ||
      args.junked === true ||
      args.drafts === true ||
      Boolean(args.shared_label) ||
      Boolean(args.team_inbox) ||
      Boolean(args.team_closed) ||
      Boolean(args.team_all);
    if (!hasMailbox) {
      return errorResult(
        "At least one mailbox filter is required: set one of inbox/all/assigned/closed/snoozed/flagged/trashed/junked/drafts to true, or pass a shared_label/team_inbox/team_closed/team_all ID.",
      );
    }

    const contactFilters = [args.email, args.domain, args.contact_organization].filter(
      (value) => value !== undefined && value !== null && value !== "",
    );
    if (contactFilters.length > 1) {
      return errorResult(
        "email, domain, and contact_organization are mutually exclusive — pass at most one of them.",
      );
    }

    return handle(() =>
      missiveRequest("GET", "/conversations", {
        query: {
          inbox: args.inbox === true ? true : undefined,
          all: args.all === true ? true : undefined,
          assigned: args.assigned === true ? true : undefined,
          closed: args.closed === true ? true : undefined,
          snoozed: args.snoozed === true ? true : undefined,
          flagged: args.flagged === true ? true : undefined,
          trashed: args.trashed === true ? true : undefined,
          junked: args.junked === true ? true : undefined,
          drafts: args.drafts === true ? true : undefined,
          shared_label: args.shared_label,
          team_inbox: args.team_inbox,
          team_closed: args.team_closed,
          team_all: args.team_all,
          organization: optionalOrg(args.organization),
          email: args.email,
          domain: args.domain,
          contact_organization: args.contact_organization,
          limit: args.limit,
          until: args.until,
        },
      }),
    );
  },
  { annotations: { readOnlyHint: true } },
);

/** `missive_get_conversation` — GET /conversations/:id. */
export const getConversation = tool(
  "missive_get_conversation",
  "Fetches a single conversation by ID (GET /conversations/:id). If the conversation was merged, the current (merged) conversation is returned and its `id` may differ from the one passed. Read-only. Conversations where you are only a guest return just `id` and `last_activity_at`.",
  {
    conversation_id: z.string().describe("The conversation UUID to fetch."),
  },
  async (args) =>
    handle(() => missiveRequest("GET", `/conversations/${args.conversation_id}`)),
  { annotations: { readOnlyHint: true } },
);

/**
 * Per-conversation update item. Each object carries its own `id` (which must
 * match one of the URL ids). The body is built field-by-field from these
 * declared fields only — undeclared keys are stripped by zod and never sent.
 */
const conversationUpdateSchema = z.object({
  id: z
    .string()
    .describe("Conversation ID to update. Must match one of the ids passed in `ids`."),
  subject: z.string().optional().describe("New conversation subject."),
  color: z
    .string()
    .optional()
    .describe('HEX color code (e.g. "#000") or one of "good", "warning", "danger".'),
  conversation_color: z
    .string()
    .optional()
    .describe('Alias of `color`: HEX code or "good"/"warning"/"danger".'),
  organization: z
    .string()
    .optional()
    .describe(
      "Organization ID. Required on this item when using add_users, add_assignees, remove_assignees, or add_shared_labels.",
    ),
  team: z
    .string()
    .optional()
    .describe(
      "Team ID. Sets the conversation's team when it is not already linked to another team.",
    ),
  force_team: z
    .boolean()
    .optional()
    .describe("Force the new team even if the conversation is already in another team."),
  add_users: z
    .array(z.string())
    .optional()
    .describe("User IDs to grant access to the conversation. Requires `organization`."),
  add_assignees: z
    .array(z.string())
    .optional()
    .describe("User IDs to assign to the conversation. Requires `organization`."),
  remove_assignees: z
    .array(z.string())
    .optional()
    .describe("User IDs to remove from the conversation's assignees. Requires `organization`."),
  add_shared_labels: z
    .array(z.string())
    .optional()
    .describe(
      "Shared label IDs to add. Requires `organization`; labels must belong to it and be visible to the token user.",
    ),
  remove_shared_labels: z
    .array(z.string())
    .optional()
    .describe("Shared label IDs to remove from the conversation."),
  add_to_inbox: z
    .boolean()
    .optional()
    .describe("Move the conversation to Inbox for everyone with access."),
  add_to_team_inbox: z
    .boolean()
    .optional()
    .describe("Move the conversation to a team inbox. The `team` field is required when used."),
  close: z
    .boolean()
    .optional()
    .describe("Close the conversation for everyone with access."),
  reopen: z
    .boolean()
    .optional()
    .describe("Reopen the conversation for everyone with access."),
});

type ConversationUpdate = z.infer<typeof conversationUpdateSchema>;

/** Fields whose presence makes `organization` required on the same item. */
function requiresOrganization(item: ConversationUpdate): boolean {
  return (
    item.add_users !== undefined ||
    item.add_assignees !== undefined ||
    item.remove_assignees !== undefined ||
    item.add_shared_labels !== undefined
  );
}

/** Assemble one request-body object field-by-field, omitting unset keys. */
function buildConversationUpdate(item: ConversationUpdate): Record<string, unknown> {
  const body: Record<string, unknown> = { id: item.id };
  if (item.subject !== undefined) body.subject = item.subject;
  if (item.color !== undefined) body.color = item.color;
  if (item.conversation_color !== undefined) body.conversation_color = item.conversation_color;
  if (item.organization !== undefined) body.organization = item.organization;
  if (item.team !== undefined) body.team = item.team;
  if (item.force_team !== undefined) body.force_team = item.force_team;
  if (item.add_users !== undefined) body.add_users = item.add_users;
  if (item.add_assignees !== undefined) body.add_assignees = item.add_assignees;
  if (item.remove_assignees !== undefined) body.remove_assignees = item.remove_assignees;
  if (item.add_shared_labels !== undefined) body.add_shared_labels = item.add_shared_labels;
  if (item.remove_shared_labels !== undefined) body.remove_shared_labels = item.remove_shared_labels;
  if (item.add_to_inbox !== undefined) body.add_to_inbox = item.add_to_inbox;
  if (item.add_to_team_inbox !== undefined) body.add_to_team_inbox = item.add_to_team_inbox;
  if (item.close !== undefined) body.close = item.close;
  if (item.reopen !== undefined) body.reopen = item.reopen;
  return body;
}

/**
 * `missive_update_conversations` — PATCH /conversations/:id[,:id2,…].
 *
 * Silent state change (no post created, nothing sent). Updates 1+ conversations
 * in one request: the URL is the comma-joined `ids`, and `conversations` must
 * hold exactly one object per id, each carrying its matching `id`.
 */
export const updateConversations = tool(
  "missive_update_conversations",
  "Updates conversation state WITHOUT creating a post or sending anything (PATCH /conversations/:ids) — close/reopen, move to inbox/team, assign/unassign, add/remove shared labels, recolor, or rename. Pass `ids` (the conversation IDs to update) and `conversations` with exactly one object per id, each carrying its matching `id`. `organization` is required on any item that uses add_users, add_assignees, remove_assignees, or add_shared_labels. Idempotent. Missive's API has no archive action — `close` is the closest, and `add_to_inbox` un-archives.",
  {
    ids: z
      .array(z.string())
      .min(1)
      .describe("Conversation IDs to update; comma-joined into the request path."),
    conversations: z
      .array(conversationUpdateSchema)
      .min(1)
      .describe("One update object per id in `ids`. Each object must include its own matching `id`."),
  },
  async (args) => {
    const idError = validateBatchIds(args.ids, args.conversations);
    if (idError) return errorResult(idError);

    for (const item of args.conversations) {
      if (requiresOrganization(item) && !item.organization) {
        return errorResult(
          `Conversation '${item.id}': organization is required when using add_users, add_assignees, remove_assignees, or add_shared_labels.`,
        );
      }
      if (item.add_to_team_inbox === true && !item.team) {
        return errorResult(
          `Conversation '${item.id}': team is required when add_to_team_inbox is set.`,
        );
      }
    }

    const conversations = args.conversations.map(buildConversationUpdate);
    return handle(() =>
      missiveRequest("PATCH", `/conversations/${joinIds(args.ids)}`, {
        body: { conversations },
      }),
    );
  },
  { annotations: { idempotentHint: true, destructiveHint: false } },
);

/**
 * `missive_merge_conversations` — POST /conversations/:source/merge.
 *
 * Merges the source conversation INTO the target: the source is replaced and all
 * its messages, comments, and entries move to the target. IRREVERSIBLE — this
 * server exposes no un-merge action. Missive may swap the two, so the returned
 * conversation id can differ from either input.
 */
export const mergeConversations = tool(
  "missive_merge_conversations",
  "Merges one conversation INTO another (POST /conversations/:source/merge). The `source_conversation_id` is merged into `target_conversation_id`: the source conversation is replaced and all its messages, comments, and entries move to the target. IRREVERSIBLE — it CANNOT be un-merged through this server. Missive may swap the two conversations, so the returned conversation `id` may differ from either input. Optionally pass `subject` to rename the merged conversation.",
  {
    source_conversation_id: z
      .string()
      .describe("The conversation to merge FROM (it is replaced/merged into the target)."),
    target_conversation_id: z
      .string()
      .describe("The surviving destination conversation the source is merged into."),
    subject: z.string().optional().describe("Optional new subject for the merged conversation."),
  },
  async (args) => {
    const path = `/conversations/${args.source_conversation_id}/merge`;
    const body: Record<string, string> = { target: args.target_conversation_id };
    if (args.subject !== undefined) body.subject = args.subject;
    return handle(() => missiveRequest("POST", path, { body }));
  },
  { annotations: { destructiveHint: true } },
);

/** `missive_list_conversation_messages` — GET /conversations/:id/messages. */
export const listConversationMessages = tool(
  "missive_list_conversation_messages",
  "Lists messages in a conversation (GET /conversations/:id/messages), newest first; draft messages are excluded. Paginate with `until` = `delivered_at` of the oldest message from the previous page. Read-only.",
  {
    conversation_id: z.string().describe("The conversation UUID to list messages from."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe("Number of messages to return. Default 10, max 10."),
    until: z
      .number()
      .int()
      .optional()
      .describe("Unix timestamp: the `delivered_at` of the oldest message from the previous page."),
  },
  async (args) =>
    handle(() =>
      missiveRequest("GET", `/conversations/${args.conversation_id}/messages`, {
        query: { limit: args.limit, until: args.until },
      }),
    ),
  { annotations: { readOnlyHint: true } },
);

/** `missive_list_conversation_comments` — GET /conversations/:id/comments. */
export const listConversationComments = tool(
  "missive_list_conversation_comments",
  "Lists comments in a conversation (GET /conversations/:id/comments), newest first. Paginate with `until` = `created_at` of the oldest comment from the previous page. Read-only.",
  {
    conversation_id: z.string().describe("The conversation UUID to list comments from."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe("Number of comments to return. Default 10, max 10."),
    until: z
      .number()
      .int()
      .optional()
      .describe("Unix timestamp: the `created_at` of the oldest comment from the previous page."),
  },
  async (args) =>
    handle(() =>
      missiveRequest("GET", `/conversations/${args.conversation_id}/comments`, {
        query: { limit: args.limit, until: args.until },
      }),
    ),
  { annotations: { readOnlyHint: true } },
);

/** `missive_list_conversation_drafts` — GET /conversations/:id/drafts. */
export const listConversationDrafts = tool(
  "missive_list_conversation_drafts",
  "Lists draft messages in a conversation (GET /conversations/:id/drafts), newest first. Paginate with `until` = `delivered_at` of the oldest draft from the previous page. Read-only.",
  {
    conversation_id: z.string().describe("The conversation UUID to list drafts from."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe("Number of drafts to return. Default 10, max 10."),
    until: z
      .number()
      .int()
      .optional()
      .describe("Unix timestamp: the `delivered_at` of the oldest draft from the previous page."),
  },
  async (args) =>
    handle(() =>
      missiveRequest("GET", `/conversations/${args.conversation_id}/drafts`, {
        query: { limit: args.limit, until: args.until },
      }),
    ),
  { annotations: { readOnlyHint: true } },
);

/** `missive_list_conversation_posts` — GET /conversations/:id/posts. */
export const listConversationPosts = tool(
  "missive_list_conversation_posts",
  "Lists posts in a conversation (GET /conversations/:id/posts), newest first. Paginate with `until` = `created_at` of the oldest post from the previous page. Read-only.",
  {
    conversation_id: z.string().describe("The conversation UUID to list posts from."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe("Number of posts to return. Default 10, max 10."),
    until: z
      .number()
      .int()
      .optional()
      .describe("Unix timestamp: the `created_at` of the oldest post from the previous page."),
  },
  async (args) =>
    handle(() =>
      missiveRequest("GET", `/conversations/${args.conversation_id}/posts`, {
        query: { limit: args.limit, until: args.until },
      }),
    ),
  { annotations: { readOnlyHint: true } },
);
