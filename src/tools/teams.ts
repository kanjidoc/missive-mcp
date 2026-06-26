import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { missiveRequest } from "../missive-client";
import { handle, errorResult, resolveOrg, optionalOrg } from "../tool-helpers";
import { joinIds, validateBatchIds } from "../query-helpers";

/**
 * Teams tools — list, create, and update teams within an organization.
 *
 * Three tools:
 *  - `missive_list_teams`   GET    /teams        (read-only; `organization` is an
 *                                                 OPTIONAL filter via the env default)
 *  - `missive_create_teams` POST   /teams        (body `{ teams: [...] }`)
 *  - `missive_update_teams` PATCH  /teams/:ids   (body `{ teams: [...] }`, each with
 *                                                 its own `id`; comma-joined URL path)
 *
 * Request bodies are assembled field-by-field from declared zod fields only — no
 * passthrough, no freeform JSON — so only attributes the caller supplied are sent.
 * Create/update share the same attribute surface; `organization` and `name` are
 * required by the API on create (organization resolves from the env default).
 */

/** Who receives notifications when the team is @mentioned. */
const TEAM_MENTION_BEHAVIOR = ["all_members", "only_active_members"] as const;
/** What happens when a user replies to an unassigned conversation. */
const USER_REPLY_BEHAVIOR = ["assign_user", "leave_in_team_inbox"] as const;
/** Where an assigned conversation surfaces when a new reply arrives. */
const RECEIVED_REPLY_BEHAVIOR = ["show_in_assignee_inbox", "show_in_team_inbox"] as const;
/** What the team shows in the sidebar. */
const TEAM_SIDEBAR_BEHAVIOR = ["show_team_space", "show_team_inbox"] as const;

/** A single business-hours time slot: a day-of-week and a [start, end] window. */
const businessHoursSlotSchema = z.object({
  d: z
    .number()
    .int()
    .min(0)
    .max(6)
    .describe("Day of week (0 = Sunday, 1 = Monday, ..., 6 = Saturday)."),
  s: z
    .tuple([z.number().int().min(0), z.number().int().min(0)])
    .describe(
      "[start, end] times in seconds from midnight, e.g. [32400, 61200] = 9:00 AM to 5:00 PM.",
    ),
});

/** Business hours: a time zone plus the weekly slots when the team is available. */
const businessHoursSchema = z.object({
  tz: z
    .string()
    .describe('IANA time zone identifier, e.g. "America/Montreal".'),
  t: z
    .array(businessHoursSlotSchema)
    .describe("Array of weekly time slots, one or more per day."),
});

/**
 * Optional attributes shared by create and update. Declared once so both tools
 * expose the identical surface; copied into the request body field-by-field.
 */
const teamAttributeShape = {
  emoji: z
    .string()
    .optional()
    .describe('Emoji shortcode in :name: format, e.g. ":dart:".'),
  color: z
    .string()
    .optional()
    .describe('HEX color code, e.g. "#2266ED".'),
  active_members: z
    .array(z.string())
    .optional()
    .describe(
      "User UUIDs of active members. They get notified of new team-inbox messages and see conversations in the unified Team Inboxes view.",
    ),
  observers: z
    .array(z.string())
    .optional()
    .describe(
      "User UUIDs of observers. They are not notified and do not see conversations in the unified Team Inboxes view, but can open and manage the team inbox.",
    ),
  business_hours: businessHoursSchema
    .optional()
    .describe("Business-hours configuration (time zone plus weekly availability slots)."),
  inactivity_period: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      "Seconds of inactivity after which a conversation is considered stale. Common values: 86400 (1 day), 259200 (3 days), 604800 (1 week).",
    ),
  team_mention_behavior: z
    .enum(TEAM_MENTION_BEHAVIOR)
    .optional()
    .describe(
      "Who is notified when the team is mentioned: 'all_members' (active + observers) or 'only_active_members'.",
    ),
  user_reply_behavior: z
    .enum(USER_REPLY_BEHAVIOR)
    .optional()
    .describe(
      "On a user reply to an unassigned conversation: 'assign_user' (auto-assign) or 'leave_in_team_inbox'.",
    ),
  received_reply_behavior: z
    .enum(RECEIVED_REPLY_BEHAVIOR)
    .optional()
    .describe(
      "When a new reply arrives on an assigned conversation: 'show_in_assignee_inbox' or 'show_in_team_inbox'.",
    ),
  team_sidebar_behavior: z
    .enum(TEAM_SIDEBAR_BEHAVIOR)
    .optional()
    .describe("Sidebar display: 'show_team_space' (full team space) or 'show_team_inbox'."),
  team_inbox_enabled: z
    .boolean()
    .optional()
    .describe("Whether the team inbox is enabled."),
  chat_room_enabled: z
    .boolean()
    .optional()
    .describe("Whether the team chat room is enabled."),
};

/** Inferred type of the shared optional attributes (used by the body builder). */
type TeamAttributes = z.infer<z.ZodObject<typeof teamAttributeShape>>;

/** Copy each supplied optional attribute onto the outgoing body (omit undefined). */
function applyTeamAttributes(target: Record<string, unknown>, attrs: TeamAttributes): void {
  if (attrs.emoji !== undefined) target.emoji = attrs.emoji;
  if (attrs.color !== undefined) target.color = attrs.color;
  if (attrs.active_members !== undefined) target.active_members = attrs.active_members;
  if (attrs.observers !== undefined) target.observers = attrs.observers;
  if (attrs.business_hours !== undefined) target.business_hours = attrs.business_hours;
  if (attrs.inactivity_period !== undefined) target.inactivity_period = attrs.inactivity_period;
  if (attrs.team_mention_behavior !== undefined)
    target.team_mention_behavior = attrs.team_mention_behavior;
  if (attrs.user_reply_behavior !== undefined)
    target.user_reply_behavior = attrs.user_reply_behavior;
  if (attrs.received_reply_behavior !== undefined)
    target.received_reply_behavior = attrs.received_reply_behavior;
  if (attrs.team_sidebar_behavior !== undefined)
    target.team_sidebar_behavior = attrs.team_sidebar_behavior;
  if (attrs.team_inbox_enabled !== undefined) target.team_inbox_enabled = attrs.team_inbox_enabled;
  if (attrs.chat_room_enabled !== undefined) target.chat_room_enabled = attrs.chat_room_enabled;
}

export const listTeams = tool(
  "missive_list_teams",
  "Lists teams in the organizations the API token owner belongs to and has access to (id, name, organization, members, observers, behaviors). `organization` is an optional filter; when omitted (and no default is set) teams from all accessible organizations are returned. Read-only.",
  {
    organization: z
      .string()
      .optional()
      .describe(
        "Optional organization UUID to filter teams. Defaults to MISSIVE_DEFAULT_ORGANIZATION; if neither is set, lists teams across all accessible organizations.",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe("Number of teams to return. Default 50, max 200."),
    offset: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Offset used to paginate results. Default 0."),
  },
  async (args) => {
    const query = {
      organization: optionalOrg(args.organization),
      limit: args.limit,
      offset: args.offset,
    };
    return handle(() => missiveRequest("GET", "/teams", { query }));
  },
  { annotations: { readOnlyHint: true } },
);

export const createTeams = tool(
  "missive_create_teams",
  "Creates one or more teams in an organization. The API token must belong to an admin or owner of the organization. Each team requires `name` and `organization` (organization falls back to MISSIVE_DEFAULT_ORGANIZATION). Body shape: { teams: [...] }.",
  {
    teams: z
      .array(
        z.object({
          name: z.string().describe('Team name, e.g. "Support".'),
          organization: z
            .string()
            .optional()
            .describe(
              "Organization UUID that owns the team (required by the API). Defaults to MISSIVE_DEFAULT_ORGANIZATION when omitted.",
            ),
          ...teamAttributeShape,
        }),
      )
      .min(1)
      .describe("One or more teams to create."),
  },
  async (args) =>
    handle(() => {
      const teams = args.teams.map((t) => {
        const body: Record<string, unknown> = {
          name: t.name,
          organization: resolveOrg(t.organization),
        };
        applyTeamAttributes(body, t);
        return body;
      });
      return missiveRequest("POST", "/teams", { body: { teams } });
    }),
  { annotations: { destructiveHint: false } },
);

export const updateTeams = tool(
  "missive_update_teams",
  "Updates one or more existing teams. The API token must belong to an admin or owner of the organization. Pass `ids` (comma-joined into the URL path) and a `teams` array with one object per id, each carrying its own matching `id` plus only the attributes to change. Body shape: { teams: [...] }.",
  {
    ids: z
      .array(z.string())
      .min(1)
      .describe(
        "Team UUIDs to update. Comma-joined into the URL path; must align 1:1 with `teams` (each team object carries its own matching `id`).",
      ),
    teams: z
      .array(
        z.object({
          id: z.string().describe("UUID of the team to update; must appear in `ids`."),
          name: z.string().optional().describe("New team name."),
          organization: z
            .string()
            .optional()
            .describe("Organization UUID (rarely changed; include only to move the team)."),
          ...teamAttributeShape,
        }),
      )
      .min(1)
      .describe("One update object per id; include only the attributes you want to change."),
  },
  async (args) => {
    const validationError = validateBatchIds(args.ids, args.teams);
    if (validationError) return errorResult(validationError);
    return handle(() => {
      const teams = args.teams.map((t) => {
        const body: Record<string, unknown> = { id: t.id };
        if (t.name !== undefined) body.name = t.name;
        if (t.organization !== undefined) body.organization = t.organization;
        applyTeamAttributes(body, t);
        return body;
      });
      return missiveRequest("PATCH", `/teams/${joinIds(args.ids)}`, { body: { teams } });
    });
  },
  { annotations: { idempotentHint: true, destructiveHint: false } },
);
