import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { missiveRequest } from "../missive-client";
import { handle, errorResult, optionalOrg, optionalTeam, resolveAccount } from "../tool-helpers";
import { joinIds } from "../query-helpers";

/**
 * Message tools for the Missive REST API (`/messages`).
 *
 * Three read/advanced-create tools:
 *  - `missive_get_message`    GET  /messages/:id[,:id2,…]  (single or batch fetch)
 *  - `missive_list_messages`  GET  /messages?email_message_id=…
 *  - `missive_create_message` POST /messages  (custom-channel INCOMING records only)
 *
 * Safety note: `create_message` is NOT an email-send path. It injects an
 * inbound message record into a custom channel (simulating something received
 * from an external system) and never transmits anything externally. To send a
 * real email use the Drafts endpoint with `send: true` (not exposed by this
 * server). The request body is assembled field-by-field from validated zod
 * fields only — there is no passthrough/raw-body field.
 */

/**
 * A message participant. Shape depends on the channel:
 *  - Email channel:     `{ address, name }`
 *  - Text / HTML channel: `{ id, username, name }`
 * All keys are optional so either form is accepted; describe which to use.
 */
const participantField = z.object({
  address: z
    .string()
    .optional()
    .describe('Email address — use for EMAIL-channel messages, e.g. "sam@fellowship.org".'),
  name: z.string().optional().describe('Display name, e.g. "Samwise Gamgee".'),
  id: z
    .string()
    .optional()
    .describe('External participant ID — use for TEXT/HTML-channel messages, e.g. "12345".'),
  username: z
    .string()
    .optional()
    .describe('External username — use for TEXT/HTML-channel messages, e.g. "@philippe".'),
});

/** A file attachment. Both fields are required; total request payload must stay under 10 MB. */
const attachmentField = z.object({
  base64_data: z.string().describe("Base64-encoded contents of the file (required)."),
  filename: z.string().describe('Filename of the attachment, e.g. "logo.png" (required).'),
});

/**
 * `missive_get_message` — fetch one or more messages (headers, body, attachments)
 * by id. Multiple ids are comma-joined into the batch path `/messages/:id,:id2`.
 */
export const getMessage = tool(
  "missive_get_message",
  "Fetch one or more Missive messages (headers, body, attachments, and parent conversation) by message id. Pass one id for a single message or several ids to batch-fetch them in one call. Read-only.",
  {
    message_ids: z
      .array(z.string())
      .min(1)
      .describe("One or more message IDs to fetch. Multiple IDs are batched into a single request."),
  },
  async (args) => {
    const ids = joinIds(args.message_ids);
    if (!ids) {
      return errorResult("At least one non-blank message_id is required.");
    }
    return handle(() => missiveRequest("GET", `/messages/${ids}`));
  },
  { annotations: { readOnlyHint: true } },
);

/**
 * `missive_list_messages` — fetch messages matching an email `Message-ID`. Usually
 * one message matches; non-compliant senders may yield up to the latest 10.
 */
export const listMessages = tool(
  "missive_list_messages",
  "Fetch messages matching an email Message-ID (the RFC 5322 `Message-ID` header value). Normally returns a single message; non-compliant senders may produce up to the latest 10 matches. Read-only.",
  {
    email_message_id: z
      .string()
      .describe(
        'Required. The email `Message-ID` header value, e.g. "<0f1ab2d8-cd90-4dd1-a861-ef7e31fb3cdd@missiveapp.com>".',
      ),
  },
  async (args) => {
    if (!args.email_message_id.trim()) {
      return errorResult("email_message_id is required.");
    }
    return handle(() =>
      missiveRequest("GET", "/messages", { query: { email_message_id: args.email_message_id } }),
    );
  },
  { annotations: { readOnlyHint: true } },
);

/**
 * `missive_create_message` — ADVANCED. Custom channels only. Creates an INCOMING
 * message record (simulated inbound) in a custom channel; it NEVER transmits
 * anything externally. Body is `{ messages: {...} }`, built field-by-field.
 */
export const createMessage = tool(
  "missive_create_message",
  "ADVANCED — custom channels only. Creates an INCOMING message record (a simulated inbound message) inside a Missive custom channel; it NEVER transmits anything externally and is NOT an email send. To actually send an email, use the Drafts endpoint with send (not exposed by this server). `from_field` is required; `account` (the custom-channel account ID) falls back to MISSIVE_DEFAULT_ACCOUNT.",
  {
    account: z
      .string()
      .optional()
      .describe(
        "Custom-channel account ID (found in the custom channel settings). Falls back to MISSIVE_DEFAULT_ACCOUNT.",
      ),
    from_field: participantField.describe(
      'Required. The message sender. Email channel: { address, name }. Text/HTML channel: { id, username, name }.',
    ),
    subject: z.string().optional().describe("Email-channel only: message subject."),
    body: z
      .string()
      .optional()
      .describe("Message body — HTML or plain text depending on the channel message type."),
    to_fields: z
      .array(participantField)
      .optional()
      .describe("Recipients. Email channel: [{ address, name }]. Text/HTML channel: [{ id, username, name }]."),
    cc_fields: z
      .array(participantField)
      .optional()
      .describe("Email-channel only: CC recipients ([{ address, name }])."),
    bcc_fields: z
      .array(participantField)
      .optional()
      .describe("Email-channel only: BCC recipients ([{ address, name }])."),
    delivered_at: z
      .number()
      .optional()
      .describe("Delivery timestamp (Unix seconds). If omitted, delivered-at is set to request time."),
    attachments: z
      .array(attachmentField)
      .optional()
      .describe("Files to attach. Total request payload must not exceed 10 MB."),
    external_id: z
      .string()
      .optional()
      .describe("Unique ID identifying non-email messages (SMS, Instagram DMs, etc.)."),
    references: z
      .array(z.string())
      .optional()
      .describe(
        "Reference strings used to append this message to an existing conversation (matched against prior external_id/references). If none match, a new conversation is created.",
      ),
    conversation: z
      .string()
      .optional()
      .describe("ID of an existing conversation to append this message to (alternative to references)."),
    team: z
      .string()
      .optional()
      .describe("Team ID to link the conversation to (ignored if the conversation already has a team)."),
    force_team: z
      .boolean()
      .optional()
      .describe("Force a new team even if the conversation is already in another team."),
    organization: z
      .string()
      .optional()
      .describe(
        "Organization ID. Scopes the conversation search and links a newly created conversation. REQUIRED when using add_users / add_assignees / remove_assignees.",
      ),
    add_users: z
      .array(z.string())
      .optional()
      .describe("User IDs to grant access to the conversation. Requires `organization`."),
    add_assignees: z
      .array(z.string())
      .optional()
      .describe("User IDs to assign to the conversation (existing assignees remain). Requires `organization`."),
    remove_assignees: z
      .array(z.string())
      .optional()
      .describe("User IDs to unassign from the conversation. Requires `organization`."),
    conversation_subject: z.string().optional().describe("Subject to set on the conversation."),
    conversation_color: z
      .string()
      .optional()
      .describe('Conversation color: a HEX code (e.g. "#000") or one of "good" / "warning" / "danger".'),
    add_shared_labels: z
      .array(z.string())
      .optional()
      .describe("Shared-label IDs to apply to the message's conversation."),
    remove_shared_labels: z
      .array(z.string())
      .optional()
      .describe("Shared-label IDs to remove from the message's conversation."),
    add_to_inbox: z
      .boolean()
      .optional()
      .describe("Move the conversation to Inbox for everyone with access."),
    add_to_team_inbox: z
      .boolean()
      .optional()
      .describe("Move the conversation to a team inbox. Requires `team`."),
    close: z
      .boolean()
      .optional()
      .describe("Close the message's conversation for everyone with access."),
  },
  async (args) => {
    // Pre-flight: enforce the doc's conditional requirements with clear messages.
    const organization = optionalOrg(args.organization);
    const team = optionalTeam(args.team);
    const usesAssigneeFields =
      (args.add_users?.length ?? 0) > 0 ||
      (args.add_assignees?.length ?? 0) > 0 ||
      (args.remove_assignees?.length ?? 0) > 0;
    if (usesAssigneeFields && !organization) {
      return errorResult(
        "organization is required when using add_users, add_assignees, or remove_assignees.",
      );
    }
    if (args.add_to_team_inbox && !team) {
      return errorResult("team is required when add_to_team_inbox is true.");
    }

    return handle(() => {
      const account = resolveAccount(args.account);

      // Allow-list body builder: only declared, validated fields — no passthrough.
      const message: Record<string, unknown> = {
        account,
        from_field: args.from_field,
      };
      if (args.subject !== undefined) message.subject = args.subject;
      if (args.body !== undefined) message.body = args.body;
      if (args.to_fields !== undefined) message.to_fields = args.to_fields;
      if (args.cc_fields !== undefined) message.cc_fields = args.cc_fields;
      if (args.bcc_fields !== undefined) message.bcc_fields = args.bcc_fields;
      if (args.delivered_at !== undefined) message.delivered_at = args.delivered_at;
      if (args.attachments !== undefined) message.attachments = args.attachments;
      if (args.external_id !== undefined) message.external_id = args.external_id;
      if (args.references !== undefined) message.references = args.references;
      if (args.conversation !== undefined) message.conversation = args.conversation;
      if (team !== undefined) message.team = team;
      if (args.force_team !== undefined) message.force_team = args.force_team;
      if (organization !== undefined) message.organization = organization;
      if (args.add_users !== undefined) message.add_users = args.add_users;
      if (args.add_assignees !== undefined) message.add_assignees = args.add_assignees;
      if (args.remove_assignees !== undefined) message.remove_assignees = args.remove_assignees;
      if (args.conversation_subject !== undefined) message.conversation_subject = args.conversation_subject;
      if (args.conversation_color !== undefined) message.conversation_color = args.conversation_color;
      if (args.add_shared_labels !== undefined) message.add_shared_labels = args.add_shared_labels;
      if (args.remove_shared_labels !== undefined) message.remove_shared_labels = args.remove_shared_labels;
      if (args.add_to_inbox !== undefined) message.add_to_inbox = args.add_to_inbox;
      if (args.add_to_team_inbox !== undefined) message.add_to_team_inbox = args.add_to_team_inbox;
      if (args.close !== undefined) message.close = args.close;

      return missiveRequest("POST", "/messages", { body: { messages: message } });
    });
  },
  { annotations: { destructiveHint: false } },
);
