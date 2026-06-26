/**
 * MCP server "instructions" — surfaced to the client (e.g. Claude Desktop) at
 * connect time and injected into the model's context. This is the single source
 * of "how to call this server" guidance: it is set on the server in `server.ts`
 * AND returned by the `missive_help` "usage" topic. Keep it grounded in the
 * Missive REST API docs (https://missiveapp.com/docs/developers/rest-api).
 *
 * Note: kept free of backticks so the template literal needs no escaping; the
 * text is read by a model, where code-formatting is unnecessary.
 */
export const MISSIVE_INSTRUCTIONS = `Missive MCP — exposes the Missive REST API (team email/inbox, contacts, conversations, drafts, posts, tasks, labels). Tools are prefixed "missive_".

SAFETY — what this server can and cannot do (by design):
- Internal posts: YES. missive_create_post adds internal comments/notes to a conversation (visible to your team, and it may notify them). Internal "messaging" is fully supported.
- Merge conversations: YES. missive_merge_conversations merges one conversation into another. This is irreversible — the source conversation is replaced.
- External email/SMS: NO auto-send. missive_create_draft only SAVES a draft in Missive for a person to review and send. There is no send tool and no send / send_at / auto_followup parameter, so the assistant can never send an email or SMS on its own.
- Deletes: NONE. There are no delete tools.
Writes act on a LIVE shared account — create_post is permanent and notifies people, merge cannot be undone, and the update tools change real state. Confirm intent before mutating.

RESOURCE IDs & DEFAULTS: most write tools need IDs (organization, contact_book, team, shared_label, user, conversation, account). Get them from the missive_list_* tools, or from Missive > Settings > API > Resource IDs. These optional .env defaults fill in a value you omit: MISSIVE_DEFAULT_ORGANIZATION, MISSIVE_DEFAULT_CONTACT_BOOK, MISSIVE_DEFAULT_TEAM, MISSIVE_DEFAULT_FROM_ADDRESS (the email a draft is sent from), and MISSIVE_DEFAULT_ACCOUNT (custom channels).

RULES THAT TRIP UP CALLERS:
- missive_list_conversations REQUIRES at least one mailbox filter — a boolean (inbox, all, assigned, closed, snoozed, flagged, trashed, junked, drafts) OR an id (shared_label, team_inbox, team_closed, team_all). To filter by who is involved, also pass EXACTLY ONE of email | domain | contact_organization. Paginate with until = the last_activity_at of the oldest conversation in the previous page.
- Contact tools require contact_book. missive_update_contacts REPLACES the entire infos/memberships array you send — fetch the contact first and submit the full merged array, or you will delete the omitted items.
- Org-scoped writes need organization. missive_update_conversations requires organization when using add_users / add_assignees / remove_assignees / add_shared_labels. missive_create_responses needs organization XOR user (exactly one).
- To reply inside an existing thread, pass conversation (id) or references (a Message-ID) on missive_create_draft, and set subject to "Re: <original subject>" so email clients thread it. If MISSIVE_DEFAULT_FROM_ADDRESS is not set, take the from address from the conversation's existing messages or confirm it with the user (the API cannot list your aliases).
- Adding or removing a shared label can TRIGGER configured label-change rules (which may close, move, or reassign the conversation), so expect side effects beyond the label itself.
- There is no archive action: close is the closest equivalent, and add_to_inbox un-archives.
- Conversations where you are only a guest come back with just id and last_activity_at — treat sparse results as a permissions limit, not an error.

COMMON RECIPES:
- Triage the inbox: missive_list_conversations(inbox:true) then missive_update_conversations(close:true / add_shared_labels / add_assignees, with organization).
- Leave an internal note: missive_create_post(markdown:"...") — posts to the team; no email is sent.
- Draft an email reply: missive_get_conversation + missive_list_conversation_messages, then missive_create_draft(conversation, from_field, to_fields, subject:"Re: ...", body). The user reviews and sends it from Missive.
- Merge duplicates: missive_merge_conversations(source_conversation_id, target_conversation_id).
- Manage tasks: missive_list_tasks(state:"todo") / missive_create_task / missive_update_task.
- Sync a contact: missive_list_contacts(search:"...") then missive_get_contact then missive_update_contacts.

OUTPUT: tools return Missive's JSON verbatim, wrapped by resource key — for example { "conversations": [ ... ] }, { "drafts": { ... } }, { "contacts": [ ... ] }. Errors come back as a text result like "Missive error (404): ...".

RATE LIMITS: 5 concurrent / 300 per minute. The client caps concurrency and auto-retries HTTP 429. For bulk reads, prefer batch comma-id calls (for example missive_get_message with several ids).

Call missive_help (topic: tools, safety, authentication, usage, ...) for full documentation.`;
