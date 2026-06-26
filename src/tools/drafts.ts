import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { missiveRequest } from "../missive-client";
import { handle, errorResult, optionalOrg, optionalTeam, defaultFromField } from "../tool-helpers";

/**
 * Drafts tool — SAFETY CRITICAL.
 *
 * `missive_create_draft` (POST /drafts, body `{ drafts: {...} }`) creates a draft
 * that is SAVED in Missive for a human to review and send from the app. It does
 * NOT send anything.
 *
 * The body is assembled field-by-field from declared zod fields only (no
 * `.passthrough()`, no raw/freeform body field), which is what structurally
 * guarantees the no-send property. The outbound-send surface is DELIBERATELY NOT
 * EXPOSED and is never set: `send`, `send_at`, `auto_followup`,
 * `external_response_id`, `external_response_variables`. Do not add them back.
 *
 * Per design spec section 11.2, `organization` is required whenever
 * `add_shared_labels`, `add_users`, `add_assignees`, or `remove_assignees` is
 * used (and `team` is required for `add_to_team_inbox`); those are enforced
 * in-handler (resolving MISSIVE_DEFAULT_ORGANIZATION as a fallback) and return a
 * clear error when the requirement is not met.
 */

/** Sender identity. Email, SMS/WhatsApp, and custom-channel shapes share one object. */
const fromFieldSchema = z
  .object({
    address: z
      .string()
      .optional()
      .describe(
        "Email address — must match one of your Missive email aliases (email channel). Must match one of your Missive email aliases. The API has no endpoint to list aliases — take the send-as address from the conversation's existing messages or confirm it with the user.",
      ),
    name: z.string().optional().describe("Display name shown on the From line."),
    phone_number: z
      .string()
      .optional()
      .describe(
        "Phone number for SMS/WhatsApp channels, formatted as '+' followed by digits only; must match an account you can access.",
      ),
    type: z
      .enum(["signalwire", "twilio", "twilio_whatsapp", "whatsapp"])
      .optional()
      .describe(
        "Channel type for the phone number. Only needed when the number matches accounts of different types.",
      ),
    id: z.string().optional().describe("Sender id for a custom channel."),
    username: z.string().optional().describe("Username/handle for a custom channel."),
  })
  .describe(
    "Sender identity. Email: {address, name}. SMS/WhatsApp: {phone_number, type?}. Custom channel: {id, username, name}.",
  );

/** A single recipient in `to_fields` — supports every channel Missive accepts. */
const toFieldSchema = z
  .object({
    address: z.string().optional().describe("Email address of the recipient (email channel)."),
    name: z.string().optional().describe("Display name of the recipient."),
    phone_number: z
      .string()
      .optional()
      .describe(
        "Recipient phone number for SMS/WhatsApp, formatted as '+' followed by digits only (only one to-field is allowed for SMS/WhatsApp).",
      ),
    id: z
      .string()
      .optional()
      .describe("Recipient id for Messenger/Instagram, custom channels, or Missive Live Chat."),
    username: z
      .string()
      .optional()
      .describe("Recipient username for custom channels or Missive Live Chat."),
  })
  .describe(
    "A single recipient. Email: {address, name}. SMS/WhatsApp: {phone_number}. Messenger/Instagram: {id}. Custom channel / Live Chat: {id, username, name}.",
  );

/** Email-only recipient used by `cc_fields` / `bcc_fields`. */
const emailAddressSchema = z
  .object({
    address: z.string().describe("Email address."),
    name: z.string().optional().describe("Display name for the address."),
  })
  .describe("An email recipient: {address, name?}.");

/** A binary file attachment for a draft; both fields are required by the API. */
const draftAttachmentSchema = z
  .object({
    base64_data: z.string().describe("Base64-encoded contents of the file (required)."),
    filename: z.string().describe("Filename of the attachment (required)."),
  })
  .describe("A draft attachment: { base64_data, filename }.");

export const createDraft = tool(
  "missive_create_draft",
  "Creates a draft saved in Missive for manual review/sending — it does NOT send. Builds a draft email/SMS/WhatsApp/custom-channel message (in a new conversation, or appended to an existing one via `conversation` or `references`) that a human reviews and sends from the Missive app. The send-related parameters (send, send_at, auto_followup) are intentionally NOT available, so this tool can never transmit a message.",
  {
    subject: z
      .string()
      .optional()
      .describe(
        "Email subject, passed verbatim to the outgoing email. When replying, set to 'Re: [original subject]' so recipient clients thread it correctly.",
      ),
    body: z
      .string()
      .optional()
      .describe(
        "HTML or text body of the message. Note: for paragraph spacing in Missive use <div>…</div> blocks separated by <div><br></div> rather than <p> tags.",
      ),
    to_fields: z
      .array(toFieldSchema)
      .optional()
      .describe("Primary recipients. Array of recipient objects (shape depends on channel)."),
    cc_fields: z
      .array(emailAddressSchema)
      .optional()
      .describe("CC recipients (email only). Array of {address, name?} objects."),
    bcc_fields: z
      .array(emailAddressSchema)
      .optional()
      .describe("BCC recipients (email only). Array of {address, name?} objects."),
    from_field: fromFieldSchema.optional(),
    account: z
      .string()
      .optional()
      .describe(
        "Account ID for custom channel, Missive Live Chat, Messenger or Instagram drafts (Settings > API > Resource IDs).",
      ),
    references: z
      .array(z.string())
      .optional()
      .describe(
        "Message-ID/References header strings used to locate and append this draft to an existing conversation (chevrons optional). If none match, a new conversation is created.",
      ),
    conversation: z
      .string()
      .optional()
      .describe(
        "ID of an existing Missive conversation to append this draft to (alternative to `references`).",
      ),
    conversation_subject: z
      .string()
      .optional()
      .describe("Subject for the conversation in Missive (the internal conversation title)."),
    conversation_color: z
      .string()
      .optional()
      .describe(
        "Conversation color: a HEX code (e.g. '#000') or one of 'good', 'warning', 'danger'.",
      ),
    organization: z
      .string()
      .optional()
      .describe(
        "Organization UUID. Scopes the conversation search and links new conversations to that organization. Defaults to MISSIVE_DEFAULT_ORGANIZATION. REQUIRED when `add_shared_labels` is used.",
      ),
    team: z
      .string()
      .optional()
      .describe(
        "Team ID to link the draft's conversation to. Ignored if the conversation is already linked to a team.",
      ),
    force_team: z
      .boolean()
      .optional()
      .describe("When true, force the `team` even if the conversation is already in another team."),
    add_shared_labels: z
      .array(z.string())
      .optional()
      .describe(
        "Shared label IDs to apply to the draft's conversation. Requires `organization` (explicit or MISSIVE_DEFAULT_ORGANIZATION).",
      ),
    remove_shared_labels: z
      .array(z.string())
      .optional()
      .describe("Shared label IDs to remove from the draft's conversation."),
    add_to_inbox: z
      .boolean()
      .optional()
      .describe("When true, move the draft's conversation to Inbox for everyone with access."),
    attachments: z
      .array(draftAttachmentSchema)
      .optional()
      .describe(
        "Files to attach (up to 25). Each: base64_data (base64-encoded contents) and filename.",
      ),
    close: z
      .boolean()
      .optional()
      .describe("Close the draft's conversation for everyone."),
    add_assignees: z
      .array(z.string())
      .optional()
      .describe("User IDs to assign. Requires `organization` (explicit or MISSIVE_DEFAULT_ORGANIZATION)."),
    add_users: z
      .array(z.string())
      .optional()
      .describe("User IDs to grant access. Requires `organization` (explicit or MISSIVE_DEFAULT_ORGANIZATION)."),
    remove_assignees: z
      .array(z.string())
      .optional()
      .describe("User IDs to unassign. Requires `organization` (explicit or MISSIVE_DEFAULT_ORGANIZATION)."),
    add_to_team_inbox: z
      .boolean()
      .optional()
      .describe("When true, move the conversation to a team inbox. Requires `team`."),
    quote_previous_message: z
      .boolean()
      .default(false)
      .describe(
        "When true, include a quoted copy of the conversation's last message in the draft. DANGER: when appending to an existing conversation (via `conversation`/`references`) this embeds the previous message's body and can leak sensitive content. Leave false unless you fully control and have visibility into the conversation. Defaults to false.",
      ),
  },
  async (args) => {
    // `organization` is required when applying shared labels or touching access/
    // assignees; resolve the env default before deciding, and fail clearly if
    // none can be determined.
    const organization = optionalOrg(args.organization);
    const needsOrganization =
      (args.add_shared_labels?.length ?? 0) > 0 ||
      (args.add_users?.length ?? 0) > 0 ||
      (args.add_assignees?.length ?? 0) > 0 ||
      (args.remove_assignees?.length ?? 0) > 0;
    if (needsOrganization && !organization) {
      return errorResult(
        "organization is required when using add_shared_labels, add_users, add_assignees, or remove_assignees: pass `organization` explicitly or set MISSIVE_DEFAULT_ORGANIZATION in .env.",
      );
    }
    const team = optionalTeam(args.team);
    if (args.add_to_team_inbox === true && !team) {
      return errorResult("team is required when add_to_team_inbox is true.");
    }
    const from_field = args.from_field ?? defaultFromField();

    // Allow-list body builder: every key is enumerated here, so send/send_at/
    // auto_followup/external_response_* can never reach the request. Undefined
    // values are dropped by JSON serialization.
    const draft = {
      subject: args.subject,
      body: args.body,
      to_fields: args.to_fields,
      cc_fields: args.cc_fields,
      bcc_fields: args.bcc_fields,
      from_field,
      account: args.account,
      references: args.references,
      conversation: args.conversation,
      conversation_subject: args.conversation_subject,
      conversation_color: args.conversation_color,
      organization,
      team,
      force_team: args.force_team,
      add_shared_labels: args.add_shared_labels,
      remove_shared_labels: args.remove_shared_labels,
      add_to_inbox: args.add_to_inbox,
      attachments: args.attachments,
      close: args.close,
      add_assignees: args.add_assignees,
      add_users: args.add_users,
      remove_assignees: args.remove_assignees,
      add_to_team_inbox: args.add_to_team_inbox,
      quote_previous_message: args.quote_previous_message,
    };

    return handle(() => missiveRequest("POST", "/drafts", { body: { drafts: draft } }));
  },
  { annotations: { destructiveHint: false } },
);
