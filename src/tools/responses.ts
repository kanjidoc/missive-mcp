import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { missiveRequest } from "../missive-client";
import { handle, errorResult, optionalOrg } from "../tool-helpers";
import { joinIds, validateBatchIds } from "../query-helpers";

/**
 * Response (canned reply) tools — GET `/responses`, GET `/responses/:id`,
 * POST `/responses`, PATCH `/responses/:ids`. Responses are reusable email/reply
 * templates owned by either an organization (shared) or a single user (personal).
 *
 * Bodies are assembled field-by-field from declared zod fields only (no
 * passthrough, no freeform JSON) so the request surface is exactly what the
 * tool documents.
 *
 * Ownership rule (enforced in-handler on create): each response is scoped to
 * EITHER an `organization` OR a `user` — exactly one, never both. The
 * MISSIVE_DEFAULT_ORGANIZATION default is injected only when no `user` is given.
 */

/** A recipient entry for to/cc/bcc fields (`address` required, `name` optional). */
interface Recipient {
  address: string;
  name?: string;
}

/** A file attachment as accepted by the response endpoints. */
interface ResponseAttachment {
  base64_data: string;
  filename: string;
  id?: string;
}

/** Content fields shared by create and update response items. */
interface ResponseContent {
  title?: string;
  body?: string;
  subject?: string;
  share_with_team?: string;
  shared_labels?: string[];
  to_fields?: Recipient[];
  cc_fields?: Recipient[];
  bcc_fields?: Recipient[];
  external_id?: string;
  external_source?: string;
  attachments?: ResponseAttachment[];
}

/** A response object as sent to POST `/responses` (ownership set in-handler). */
interface ResponseCreate extends ResponseContent {
  organization?: string;
  user?: string;
}

/** A response object as sent to PATCH `/responses/:ids` (only `id` is required). */
interface ResponseUpdate extends ResponseContent {
  id: string;
}

/** Shape of the validated content args common to create and update items. */
interface ResponseContentInput {
  title?: string;
  body?: string;
  subject?: string;
  share_with_team?: string;
  shared_labels?: string[];
  to_fields?: { address: string; name?: string }[];
  cc_fields?: { address: string; name?: string }[];
  bcc_fields?: { address: string; name?: string }[];
  external_id?: string;
  external_source?: string;
  attachments?: { base64_data: string; filename: string; id?: string }[];
}

/** Copy recipient entries field-by-field (no spread of unchecked objects). */
function toRecipients(list: { address: string; name?: string }[]): Recipient[] {
  return list.map((r) => {
    const item: Recipient = { address: r.address };
    if (r.name !== undefined) item.name = r.name;
    return item;
  });
}

/** Copy attachment entries field-by-field (no spread of unchecked objects). */
function toAttachments(
  list: { base64_data: string; filename: string; id?: string }[],
): ResponseAttachment[] {
  return list.map((a) => {
    const item: ResponseAttachment = { base64_data: a.base64_data, filename: a.filename };
    if (a.id !== undefined) item.id = a.id;
    return item;
  });
}

/** Assign the shared content fields onto a create/update item, omitting undefined keys. */
function assignContent(item: ResponseContent, src: ResponseContentInput): void {
  if (src.title !== undefined) item.title = src.title;
  if (src.body !== undefined) item.body = src.body;
  if (src.subject !== undefined) item.subject = src.subject;
  if (src.share_with_team !== undefined) item.share_with_team = src.share_with_team;
  if (src.shared_labels !== undefined) item.shared_labels = src.shared_labels;
  if (src.to_fields !== undefined) item.to_fields = toRecipients(src.to_fields);
  if (src.cc_fields !== undefined) item.cc_fields = toRecipients(src.cc_fields);
  if (src.bcc_fields !== undefined) item.bcc_fields = toRecipients(src.bcc_fields);
  if (src.external_id !== undefined) item.external_id = src.external_id;
  if (src.external_source !== undefined) item.external_source = src.external_source;
  if (src.attachments !== undefined) item.attachments = toAttachments(src.attachments);
}

/** Reusable zod schema for a to/cc/bcc recipient. */
const recipientSchema = z.object({
  address: z.string().describe("Email address of the recipient."),
  name: z.string().optional().describe("Optional display name of the recipient."),
});

/** Reusable zod schema for a response attachment. */
const attachmentSchema = z.object({
  base64_data: z.string().describe("The base64-encoded contents of the file (required)."),
  filename: z.string().describe("Filename of the attachment (required)."),
  id: z
    .string()
    .optional()
    .describe(
      "Temporary ID for inline-image references. Reference it in the body HTML via a data-missive-attachment-id attribute; the server replaces it with the real attachment UUID.",
    ),
});

/** Reusable zod fields shared by create and update response items. */
const contentFields = {
  body: z.string().optional().describe("HTML string containing the response content."),
  subject: z.string().optional().describe("Subject line string (max 500 characters)."),
  share_with_team: z
    .string()
    .optional()
    .describe("Team ID to share the response with. Requires an organization-scoped response."),
  shared_labels: z
    .array(z.string())
    .optional()
    .describe("Array of shared-label IDs. Requires an organization-scoped response."),
  to_fields: z
    .array(recipientSchema)
    .optional()
    .describe("Array of default To recipients (each with an address, optional name)."),
  cc_fields: z
    .array(recipientSchema)
    .optional()
    .describe("Array of default CC recipients (each with an address, optional name)."),
  bcc_fields: z
    .array(recipientSchema)
    .optional()
    .describe("Array of default BCC recipients (each with an address, optional name)."),
  external_id: z
    .string()
    .optional()
    .describe(
      "External identifier for syncing with other systems. When provided, external_source is also required.",
    ),
  external_source: z
    .string()
    .optional()
    .describe(
      "Source-system identifier. Required when external_id is provided; the pair must be unique per organization or user.",
    ),
  attachments: z
    .array(attachmentSchema)
    .optional()
    .describe(
      "Array of files to attach. Total JSON payload must not exceed 10 MB. On update, you must pass ALL attachments you want to keep — omitted ones are removed.",
    ),
};

/**
 * `missive_list_responses` — GET `/responses`.
 * Lists responses (canned reply templates) for the authenticated user.
 * `organization` is an OPTIONAL filter (explicit arg → MISSIVE_DEFAULT_ORGANIZATION
 * → omitted, listing across all accessible organizations).
 */
export const listResponses = tool(
  "missive_list_responses",
  "Lists responses (reusable canned reply / email templates) for the authenticated user. `organization` is an optional filter; pagination via limit/offset.",
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
      .describe("Number of responses to return. Default 50, max 200."),
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
      missiveRequest("GET", "/responses", {
        query: { organization, limit: args.limit, offset: args.offset },
      }),
    );
  },
  { annotations: { readOnlyHint: true } },
);

/**
 * `missive_get_response` — GET `/responses/:id`.
 * Fetches a single response by its ID.
 */
export const getResponse = tool(
  "missive_get_response",
  "Fetches a single response (canned reply template) by its ID.",
  {
    response_id: z.string().describe("ID of the response to fetch."),
  },
  async (args) =>
    handle(() => missiveRequest("GET", `/responses/${args.response_id}`)),
  { annotations: { readOnlyHint: true } },
);

/**
 * `missive_create_responses` — POST `/responses`.
 * Creates one or more responses. Body shape `{ responses: [...] }`.
 * Each response is scoped to EITHER an organization OR a user (exactly one):
 *  - if `user` is given, the response is personal and no organization is added;
 *  - otherwise `organization` is used (falling back to MISSIVE_DEFAULT_ORGANIZATION).
 * `title` is NOT required.
 */
export const createResponses = tool(
  "missive_create_responses",
  "Creates one or more responses (reusable canned reply / email templates). Body shape { responses: [...] }. Each response must be scoped to EITHER an organization (shared) OR a user (personal) — exactly one, never both; organization falls back to MISSIVE_DEFAULT_ORGANIZATION only when no user is given. Title is optional. Provide body, subject, default recipients, attachments, and external sync IDs as needed.",
  {
    responses: z
      .array(
        z.object({
          title: z
            .string()
            .optional()
            .describe("Response title (max 500 characters). Optional."),
          organization: z
            .string()
            .optional()
            .describe(
              "Organization ID that owns the response (shared). Mutually exclusive with `user`. Defaults to MISSIVE_DEFAULT_ORGANIZATION when neither is supplied.",
            ),
          user: z
            .string()
            .optional()
            .describe(
              "User ID for a personal response. Mutually exclusive with `organization`. When set, no organization is added.",
            ),
          ...contentFields,
        }),
      )
      .min(1)
      .describe("The responses to create (at least one)."),
  },
  async (args) => {
    // Pre-flight: enforce organization XOR user, and external_id/external_source pairing.
    for (let i = 0; i < args.responses.length; i += 1) {
      const r = args.responses[i];
      if (r.organization !== undefined && r.user !== undefined) {
        return errorResult(
          `Response ${i + 1}: provide either organization or user, not both.`,
        );
      }
      if (r.user === undefined && optionalOrg(r.organization) === undefined) {
        return errorResult(
          `Response ${i + 1}: organization is required — pass organization, set MISSIVE_DEFAULT_ORGANIZATION, or set user instead.`,
        );
      }
      if (r.external_id !== undefined && r.external_source === undefined) {
        return errorResult(
          `Response ${i + 1}: external_source is required when external_id is provided.`,
        );
      }
    }

    return handle(() => {
      const responses: ResponseCreate[] = args.responses.map((r) => {
        const item: ResponseCreate = {};
        if (r.user !== undefined) {
          item.user = r.user;
        } else {
          // Pre-flight guarantees a value here; resolve again for the type narrowing.
          const organization = optionalOrg(r.organization);
          if (organization === undefined) {
            throw new Error("organization is required for this response.");
          }
          item.organization = organization;
        }
        assignContent(item, r);
        return item;
      });
      return missiveRequest("POST", "/responses", { body: { responses } });
    });
  },
  { annotations: { destructiveHint: false } },
);

/**
 * `missive_update_responses` — PATCH `/responses/:id1,:id2,...`.
 * Updates one or more existing responses. Body shape `{ responses: [...] }` with
 * exactly one object per URL id, each carrying its own `id`. Only the attributes
 * you pass are changed. Note: passing `attachments` replaces the whole set —
 * omitted attachments are removed. Responses created by external integrations
 * (e.g. WhatsApp templates) cannot be updated.
 */
export const updateResponses = tool(
  "missive_update_responses",
  "Updates one or more existing responses (canned reply templates). Provide one object per response, each with its `id`; only the attributes you include (title, body, subject, recipients, shared_labels, attachments, external IDs) are changed. Passing `attachments` replaces the whole set — omitted attachments are removed. Responses created by external integrations (e.g. WhatsApp templates) cannot be updated.",
  {
    responses: z
      .array(
        z.object({
          id: z.string().describe("ID of the response to update (required)."),
          title: z
            .string()
            .optional()
            .describe("New response title (max 500 characters)."),
          ...contentFields,
        }),
      )
      .min(1)
      .describe("The responses to update (at least one, each with its `id`)."),
  },
  async (args) => {
    const ids = args.responses.map((r) => r.id);
    const validationError = validateBatchIds(ids, args.responses);
    if (validationError) return errorResult(validationError);

    // Pre-flight: external_id requires external_source.
    for (let i = 0; i < args.responses.length; i += 1) {
      const r = args.responses[i];
      if (r.external_id !== undefined && r.external_source === undefined) {
        return errorResult(
          `Response ${i + 1}: external_source is required when external_id is provided.`,
        );
      }
    }

    const path = `/responses/${joinIds(ids)}`;
    return handle(() => {
      const responses: ResponseUpdate[] = args.responses.map((r) => {
        const item: ResponseUpdate = { id: r.id };
        assignContent(item, r);
        return item;
      });
      return missiveRequest("PATCH", path, { body: { responses } });
    });
  },
  { annotations: { idempotentHint: true, destructiveHint: true } },
);
