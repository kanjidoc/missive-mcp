import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { missiveRequest } from "../missive-client";
import { handle, errorResult, optionalOrg, optionalTeam } from "../tool-helpers";

/**
 * Posts inject visible content and conversation-state changes into a Missive
 * conversation. A post is a permanent, visible trace seen by everyone with
 * access to the conversation, and creating one can notify those people. The
 * single tool here maps to `POST /v1/posts` with the `{ posts: {...} }`
 * envelope; the body is assembled field-by-field from declared zod fields only
 * (no passthrough / raw-body) so this server can never be coerced into doing
 * anything beyond the documented post fields.
 *
 * This server intentionally exposes no delete tool, so a created post cannot be
 * removed through it — that is reflected in the tool description.
 */

/** One label/value row inside a formatted attachment block. */
const attachmentFieldSchema = z.object({
  title: z.string().optional().describe('Field label, e.g. "Paying customer?".'),
  value: z.string().optional().describe('Field value, e.g. "yes".'),
  short: z
    .boolean()
    .optional()
    .describe("If true, two fields render per row; otherwise one field per row."),
});

/** A Slack-style formatted attachment block (all fields optional). */
const formattedAttachmentSchema = z.object({
  color: z
    .string()
    .optional()
    .describe('HEX color code (e.g. "#2266ED") or one of "good", "warning", "danger".'),
  pretext: z.string().optional().describe("Text shown above the attachment block."),
  author_name: z.string().optional().describe("Attachment author name."),
  author_link: z.string().optional().describe("URL linking to the author."),
  author_icon: z.string().optional().describe("Image URL of the attachment author."),
  title: z.string().optional().describe("Attachment title."),
  title_link: z.string().optional().describe("URL linking to the attachment resource."),
  image_url: z.string().optional().describe("Image URL displayed in the attachment."),
  text: z.string().optional().describe("Main text of the attachment block."),
  markdown: z
    .string()
    .optional()
    .describe("Main text of the attachment block, formatted with Markdown."),
  timestamp: z
    .number()
    .int()
    .optional()
    .describe("Unix timestamp in seconds shown on the attachment."),
  footer: z.string().optional().describe("Footer text."),
  footer_icon: z.string().optional().describe("Image URL shown beside the footer."),
  fields: z
    .array(attachmentFieldSchema)
    .optional()
    .describe("Array of label/value field objects rendered inside the attachment."),
});

/** A binary file attachment; both fields are required by the API. */
const fileAttachmentSchema = z.object({
  base64_data: z
    .string()
    .describe("Base64-encoded contents of the file (required for a binary file attachment)."),
  filename: z
    .string()
    .describe('Filename of the attachment, e.g. "logo.png" (required for a binary file attachment).'),
});

/**
 * An attachment is either a binary file attachment (base64_data + filename) or
 * a formatted block. Both shapes are merged into one object and refined so that
 * whenever `base64_data` is present `filename` must be too. Without this guard a
 * binary attachment missing its filename would be silently accepted as an empty
 * formatted block (with `base64_data` stripped) and sent as a wrong body.
 */
const attachmentSchema = fileAttachmentSchema
  .partial()
  .extend(formattedAttachmentSchema.shape)
  .refine((value) => !(value.base64_data !== undefined && value.filename === undefined), {
    message:
      "filename is required when base64_data is provided (a binary file attachment needs both base64_data and filename).",
    path: ["filename"],
  });
type Attachment = z.infer<typeof attachmentSchema>;

/** Notification rendered to recipients when the post is created. */
const notificationSchema = z.object({
  title: z.string().describe("Notification title."),
  body: z.string().describe("Notification body."),
});
type Notification = z.infer<typeof notificationSchema>;

/** The `posts` payload, assembled field-by-field (only supplied keys are set). */
interface PostPayload {
  text?: string;
  markdown?: string;
  attachments?: Attachment[];
  notification?: Notification;
  username?: string;
  username_icon?: string;
  conversation_icon?: string;
  conversation?: string;
  references?: string[];
  conversation_subject?: string;
  conversation_color?: string;
  organization?: string;
  team?: string;
  force_team?: boolean;
  add_users?: string[];
  add_assignees?: string[];
  remove_assignees?: string[];
  add_shared_labels?: string[];
  remove_shared_labels?: string[];
  add_to_inbox?: boolean;
  add_to_team_inbox?: boolean;
  close?: boolean;
  reopen?: boolean;
}

export const createPost = tool(
  "missive_create_post",
  "Creates a post in a Missive conversation (POST /posts). A post is the recommended way for an automation to inject content and manage conversation state (close/reopen, move to inbox, assign users, add labels, set color) while leaving a visible trace. WARNING: the post is PERMANENT and VISIBLE to everyone with access to the conversation, creating it can send NOTIFICATIONS to those people, and it CANNOT be undone through this server (no delete tool is exposed). At least one of `text`, `markdown`, or `attachments` is required. If no `conversation` or matching `references` is given, a new conversation is created.",
  {
    text: z
      .string()
      .max(8000)
      .optional()
      .describe(
        "Main message of the post as plain text (max 8000 chars). At least one of text, markdown, or attachments is required.",
      ),
    markdown: z
      .string()
      .max(8000)
      .optional()
      .describe(
        "Main message of the post formatted with Markdown (max 8000 chars). At least one of text, markdown, or attachments is required.",
      ),
    attachments: z
      .array(attachmentSchema)
      .optional()
      .describe(
        "Array of attachment objects: either formatted blocks (color/title/text/fields/etc.) or binary file attachments ({ base64_data, filename }). At least one of text, markdown, or attachments is required.",
      ),
    notification: notificationSchema
      .optional()
      .describe(
        "Optional notification object with `title` and `body`, used to render the notification shown to recipients.",
      ),
    username: z
      .string()
      .optional()
      .describe("Name of the post author, used instead of the API token owner's name."),
    username_icon: z
      .string()
      .optional()
      .describe("Image URL of the post author, used instead of the API token owner's avatar."),
    conversation_icon: z
      .string()
      .optional()
      .describe("Image URL used as the icon in the conversation list."),
    conversation: z
      .string()
      .optional()
      .describe(
        "ID of an existing conversation to append this post to. If omitted (and no matching references), a new conversation is created.",
      ),
    references: z
      .array(z.string())
      .optional()
      .describe(
        "Reference strings (e.g. email Message-ID values) used to append the post to an existing conversation; chevrons are optional. If none match, a new conversation is created.",
      ),
    conversation_subject: z
      .string()
      .optional()
      .describe("Subject for the conversation, e.g. \"New user!\"."),
    conversation_color: z
      .string()
      .optional()
      .describe('Conversation color: a HEX code (e.g. "#000") or one of "good", "warning", "danger".'),
    organization: z
      .string()
      .optional()
      .describe(
        "Organization ID. Required when using add_users, add_assignees, or remove_assignees. Also scopes conversation search and links a newly created conversation to the organization.",
      ),
    team: z
      .string()
      .optional()
      .describe("Team ID to link the conversation to. Required when add_to_team_inbox is true."),
    force_team: z
      .boolean()
      .optional()
      .describe("If true, move the conversation to `team` even if it is already in another team."),
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
    add_shared_labels: z
      .array(z.string())
      .optional()
      .describe("Shared label IDs to apply to the post's conversation."),
    remove_shared_labels: z
      .array(z.string())
      .optional()
      .describe("Shared label IDs to remove from the post's conversation."),
    add_to_inbox: z
      .boolean()
      .optional()
      .describe("If true, move the conversation to Inbox (unarchive) for everyone with access."),
    add_to_team_inbox: z
      .boolean()
      .optional()
      .describe("If true, move the conversation to a team inbox for everyone with access. Requires `team`."),
    close: z
      .boolean()
      .optional()
      .describe("If true, close the conversation for everyone with access."),
    reopen: z
      .boolean()
      .optional()
      .describe(
        "If true, keep a closed conversation closed even after adding this post (prevents auto-reopen).",
      ),
  },
  async (args) => {
    // Validation 1: at least one content field is required (endpoints.md L2387).
    const hasAttachments = Array.isArray(args.attachments) && args.attachments.length > 0;
    if (args.text === undefined && args.markdown === undefined && !hasAttachments) {
      return errorResult("A post requires at least one of `text`, `markdown`, or `attachments`.");
    }

    // Resolve organization: explicit arg, else MISSIVE_DEFAULT_ORGANIZATION (mirrors create_draft).
    const organization = optionalOrg(args.organization);
    const team = optionalTeam(args.team);

    // Validation 2: assignee/access fields require an organization (endpoints.md L2417-2425).
    const needsOrg =
      (args.add_users !== undefined && args.add_users.length > 0) ||
      (args.add_assignees !== undefined && args.add_assignees.length > 0) ||
      (args.remove_assignees !== undefined && args.remove_assignees.length > 0);
    if (needsOrg && organization === undefined) {
      return errorResult(
        "`organization` is required when using add_users, add_assignees, or remove_assignees.",
      );
    }

    // Validation 3: moving to a team inbox requires a team (endpoints.md L2433).
    // Check the resolved team so MISSIVE_DEFAULT_TEAM satisfies the requirement.
    if (args.add_to_team_inbox === true && team === undefined) {
      return errorResult("`team` is required when add_to_team_inbox is true.");
    }

    // Build the body field-by-field; only include keys the user supplied.
    const posts: PostPayload = {};
    if (args.text !== undefined) posts.text = args.text;
    if (args.markdown !== undefined) posts.markdown = args.markdown;
    if (args.attachments !== undefined) posts.attachments = args.attachments;
    if (args.notification !== undefined) posts.notification = args.notification;
    if (args.username !== undefined) posts.username = args.username;
    if (args.username_icon !== undefined) posts.username_icon = args.username_icon;
    if (args.conversation_icon !== undefined) posts.conversation_icon = args.conversation_icon;
    if (args.conversation !== undefined) posts.conversation = args.conversation;
    if (args.references !== undefined) posts.references = args.references;
    if (args.conversation_subject !== undefined) posts.conversation_subject = args.conversation_subject;
    if (args.conversation_color !== undefined) posts.conversation_color = args.conversation_color;
    if (organization !== undefined) posts.organization = organization;
    if (team !== undefined) posts.team = team;
    if (args.force_team !== undefined) posts.force_team = args.force_team;
    if (args.add_users !== undefined) posts.add_users = args.add_users;
    if (args.add_assignees !== undefined) posts.add_assignees = args.add_assignees;
    if (args.remove_assignees !== undefined) posts.remove_assignees = args.remove_assignees;
    if (args.add_shared_labels !== undefined) posts.add_shared_labels = args.add_shared_labels;
    if (args.remove_shared_labels !== undefined) posts.remove_shared_labels = args.remove_shared_labels;
    if (args.add_to_inbox !== undefined) posts.add_to_inbox = args.add_to_inbox;
    if (args.add_to_team_inbox !== undefined) posts.add_to_team_inbox = args.add_to_team_inbox;
    if (args.close !== undefined) posts.close = args.close;
    if (args.reopen !== undefined) posts.reopen = args.reopen;

    return handle(() => missiveRequest("POST", "/posts", { body: { posts } }));
  },
  { annotations: { destructiveHint: true } },
);
