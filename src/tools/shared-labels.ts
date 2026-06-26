import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { missiveRequest } from "../missive-client";
import { handle, errorResult, optionalOrg, resolveOrg } from "../tool-helpers";
import { joinIds, validateBatchIds } from "../query-helpers";

/**
 * Shared-label tools (GET `/shared_labels`, POST `/shared_labels`,
 * PATCH `/shared_labels/:ids`). Shared labels are the folder-like, team-shared
 * tags applied to conversations.
 *
 * Bodies are assembled field-by-field from declared zod fields only (no
 * passthrough, no freeform JSON) so the request surface is exactly what the
 * tool documents.
 */

/** Visibility values accepted by the Missive shared-label endpoints. */
const VISIBILITY = ["organization", "delegates"] as const;

/** A shared-label object as sent to POST `/shared_labels`. */
interface SharedLabelCreate {
  name: string;
  organization: string;
  color?: string;
  parent?: string;
  share_with_organization?: boolean;
  share_with_team?: string;
  share_with_users?: string[];
  visibility?: (typeof VISIBILITY)[number];
}

/** A shared-label object as sent to PATCH `/shared_labels/:ids` (only `id` is required). */
interface SharedLabelUpdate {
  id: string;
  name?: string;
  color?: string;
  parent?: string;
  share_with_organization?: boolean;
  share_with_team?: string;
  share_with_users?: string[];
  visibility?: (typeof VISIBILITY)[number];
}

/**
 * `missive_list_shared_labels` — GET `/shared_labels`.
 * Lists shared labels in the organizations the authenticated user can access.
 * `organization` is an OPTIONAL filter (explicit arg → MISSIVE_DEFAULT_ORGANIZATION
 * → omitted, listing across all accessible organizations).
 */
export const listSharedLabels = tool(
  "missive_list_shared_labels",
  "Lists shared labels (the folder-like, team-shared conversation tags) in the organizations you can access. `organization` is an optional filter; pagination via limit/offset.",
  {
    organization: z
      .string()
      .optional()
      .describe(
        "Optional organization ID to filter by. Defaults to MISSIVE_DEFAULT_ORGANIZATION if set; otherwise lists across all accessible organizations.",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe("Number of shared labels to return. Default 50, max 200."),
    offset: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Offset used to paginate results. Default 0."),
  },
  async (args) => {
    const organization = optionalOrg(args.organization);
    return handle(() =>
      missiveRequest("GET", "/shared_labels", {
        query: { organization, limit: args.limit, offset: args.offset },
      }),
    );
  },
  { annotations: { readOnlyHint: true } },
);

/**
 * `missive_create_shared_labels` — POST `/shared_labels`.
 * Creates one or more shared labels. Body shape `{ shared_labels: [...] }`.
 * Each label requires `name` and `organization`; `organization` falls back to
 * MISSIVE_DEFAULT_ORGANIZATION when omitted (errors if neither is available).
 */
export const createSharedLabels = tool(
  "missive_create_shared_labels",
  "Creates one or more shared labels (folder-like, team-shared conversation tags). Each label requires a name and an organization (organization falls back to MISSIVE_DEFAULT_ORGANIZATION). Optionally set color, a parent label, and sharing options.",
  {
    shared_labels: z
      .array(
        z.object({
          name: z.string().describe("The label name (e.g. \"Heroku\")."),
          organization: z
            .string()
            .optional()
            .describe(
              "Organization ID that owns the label. Defaults to MISSIVE_DEFAULT_ORGANIZATION if omitted.",
            ),
          color: z
            .string()
            .optional()
            .describe("HEX color code for the label (e.g. \"#430098\")."),
          parent: z
            .string()
            .optional()
            .describe("Parent shared-label ID, to nest this label under another."),
          share_with_organization: z
            .boolean()
            .optional()
            .describe("Whether to share the label with everyone in the organization."),
          share_with_team: z
            .string()
            .optional()
            .describe("Team ID to share the label with."),
          share_with_users: z
            .array(z.string())
            .optional()
            .describe("Array of user IDs to explicitly share the label with."),
          visibility: z
            .enum(VISIBILITY)
            .optional()
            .describe(
              "Who can use the label: 'organization' (everyone in the org) or 'delegates' (admins and auto-shared users only).",
            ),
        }),
      )
      .min(1)
      .describe("The shared labels to create (at least one)."),
  },
  async (args) =>
    handle(() => {
      const shared_labels: SharedLabelCreate[] = args.shared_labels.map((label) => {
        const item: SharedLabelCreate = {
          name: label.name,
          organization: resolveOrg(label.organization),
        };
        if (label.color !== undefined) item.color = label.color;
        if (label.parent !== undefined) item.parent = label.parent;
        if (label.share_with_organization !== undefined) {
          item.share_with_organization = label.share_with_organization;
        }
        if (label.share_with_team !== undefined) item.share_with_team = label.share_with_team;
        if (label.share_with_users !== undefined) item.share_with_users = label.share_with_users;
        if (label.visibility !== undefined) item.visibility = label.visibility;
        return item;
      });
      return missiveRequest("POST", "/shared_labels", { body: { shared_labels } });
    }),
  { annotations: { destructiveHint: false } },
);

/**
 * `missive_update_shared_labels` — PATCH `/shared_labels/:id1,:id2,...`.
 * Updates one or more existing shared labels. Body shape `{ shared_labels: [...] }`
 * with exactly one object per URL id, each carrying its own `id`. Only the
 * attributes you pass are changed.
 */
export const updateSharedLabels = tool(
  "missive_update_shared_labels",
  "Updates one or more existing shared labels. Provide one object per label, each with its `id`; only the attributes you include (name, color, parent, sharing options, visibility) are changed.",
  {
    shared_labels: z
      .array(
        z.object({
          id: z.string().describe("ID of the shared label to update (required)."),
          name: z.string().optional().describe("New label name."),
          color: z
            .string()
            .optional()
            .describe("New HEX color code (e.g. \"#f96885\")."),
          parent: z
            .string()
            .optional()
            .describe("New parent shared-label ID."),
          share_with_organization: z
            .boolean()
            .optional()
            .describe("Whether to share the label with everyone in the organization (admin/owner only)."),
          share_with_team: z
            .string()
            .optional()
            .describe("Team ID to share the label with (admin/owner only)."),
          share_with_users: z
            .array(z.string())
            .optional()
            .describe("Array of user IDs to explicitly share the label with (admin/owner only)."),
          visibility: z
            .enum(VISIBILITY)
            .optional()
            .describe("Label visibility: 'organization' or 'delegates' (admin/owner only)."),
        }),
      )
      .min(1)
      .describe("The shared labels to update (at least one, each with its `id`)."),
  },
  async (args) => {
    const ids = args.shared_labels.map((label) => label.id);
    const validationError = validateBatchIds(ids, args.shared_labels);
    if (validationError) return errorResult(validationError);

    const path = `/shared_labels/${joinIds(ids)}`;
    return handle(() => {
      const shared_labels: SharedLabelUpdate[] = args.shared_labels.map((label) => {
        const item: SharedLabelUpdate = { id: label.id };
        if (label.name !== undefined) item.name = label.name;
        if (label.color !== undefined) item.color = label.color;
        if (label.parent !== undefined) item.parent = label.parent;
        if (label.share_with_organization !== undefined) {
          item.share_with_organization = label.share_with_organization;
        }
        if (label.share_with_team !== undefined) item.share_with_team = label.share_with_team;
        if (label.share_with_users !== undefined) item.share_with_users = label.share_with_users;
        if (label.visibility !== undefined) item.visibility = label.visibility;
        return item;
      });
      return missiveRequest("PATCH", path, { body: { shared_labels } });
    });
  },
  { annotations: { idempotentHint: true, destructiveHint: false } },
);
