# Missive MCP — Tool Reference

The complete reference for all **36 tools**, grounded in the
[Missive REST API docs](https://missiveapp.com/docs/developers/rest-api/endpoints).
For a quick overview see the [README](../README.md); for live, in-assistant help
call `missive_help` (`topic: "tools"` or `"usage"`).

**Conventions used below**

- Each tool maps to one Missive endpoint (`base = https://public.missiveapp.com/v1`).
- `*` marks a **required** parameter. Annotations: **ro** = read-only,
  **idem** = idempotent (safe to repeat). Create tools have no annotation.
- Tools return Missive's JSON response verbatim, wrapped by resource key — e.g.
  `{ "conversations": [ … ] }`, `{ "drafts": { … } }`. Failures return a text
  result like `Missive error (404): …`.
- Optional `.env` defaults fill in an omitted value: `organization` →
  `MISSIVE_DEFAULT_ORGANIZATION`, `contact_book` → `MISSIVE_DEFAULT_CONTACT_BOOK`,
  `team` → `MISSIVE_DEFAULT_TEAM`, a draft's `from_field` → `MISSIVE_DEFAULT_FROM_ADDRESS`
  (+`MISSIVE_DEFAULT_FROM_NAME`), and a custom-channel `account` → `MISSIVE_DEFAULT_ACCOUNT`.

---

## Contacts

### `missive_create_contacts` — `POST /contacts`
Create one or more contacts. Body shape `{ contacts: [...] }`.
- `contacts`* — array of contact objects. Each: `contact_book` (req, or env default), `first_name`, `last_name`, `middle_name`, `phonetic_first_name`, `phonetic_last_name`, `phonetic_middle_name`, `prefix`, `suffix`, `nickname`, `file_as`, `notes`, `starred`, `gender`, and:
  - `infos[]` — typed contact details: `{ kind, label*, value/name, custom_label, … }` where `kind` ∈ `email | phone_number | twitter | facebook | physical_address | url | custom` (physical_address adds `street`, `extended_address`, `city`, `region`, `postal_code`, `po_box`, `country`, …).
  - `memberships[]` — `{ title, location, department, description, group: { kind: organization|group, name* } }`.

### `missive_update_contacts` — `PATCH /contacts/:id1,:id2,…` · _idem_
Update contacts by UUID; only attributes you supply change.
- `contacts`* — array; each object must include its `id`.
- ⚠️ Passing `infos` or `memberships` **replaces the whole array** — omitted items are deleted. Read-merge before writing.

### `missive_list_contacts` — `GET /contacts` · _ro_
List contacts in a contact book.
- `contact_book` (req, or env default), `search`, `order` ∈ `last_name | last_modified`, `limit` (≤200), `offset`, `modified_since` (unix), `include_deleted`.

### `missive_get_contact` — `GET /contacts/:id` · _ro_
- `contact_id`* — a deleted contact returns 404.

---

## Contact books & groups

### `missive_list_contact_books` — `GET /contact_books` · _ro_
List accessible contact books (id, name, sharing flags, import status). Use it to find the `contact_book` id.
- `limit` (≤200), `offset`.

### `missive_list_contact_groups` — `GET /contact_groups` · _ro_
List groups/organizations linked to a contact book.
- `contact_book` (req, or env default), `kind`* ∈ `group | organization`, `limit` (≤200), `offset`.

---

## Conversations

### `missive_list_conversations` — `GET /conversations` · _ro_
List conversations, newest activity first. **Requires at least one mailbox filter.**
- Mailbox booleans: `inbox`, `all`, `assigned`, `closed`, `snoozed`, `flagged`, `trashed`, `junked`, `drafts`.
- Mailbox ids: `shared_label`, `team_inbox`, `team_closed`, `team_all`.
- `organization` (optional filter, env default), `limit` (≤50), `until` (= `last_activity_at` of the previous page's oldest).
- Contact filters (mutually exclusive): `email`, `domain`, `contact_organization`.

### `missive_get_conversation` — `GET /conversations/:id` · _ro_
- `conversation_id`* — if merged, the current conversation is returned (its `id` may differ).

### `missive_update_conversations` — `PATCH /conversations/:id1,:id2,…` · _idem_
Change state without posting: close/reopen, move, assign, label, recolor, rename.
- `ids`* — conversation ids to update. `conversations`* — one object per id, each with its `id` and any of: `subject`, `color`/`conversation_color`, `organization`, `team`, `force_team`, `add_users[]`, `add_assignees[]`, `remove_assignees[]`, `add_shared_labels[]`, `remove_shared_labels[]`, `add_to_inbox`, `add_to_team_inbox`, `close`, `reopen`.
- `organization` is **required** on any item using `add_users`/`add_assignees`/`remove_assignees`/`add_shared_labels`; `team` is required with `add_to_team_inbox`.

### `missive_merge_conversations` — `POST /conversations/:source/merge` · _irreversible_
Merge the source conversation INTO the target: the source is replaced and its messages/comments move to the target. The returned conversation id may differ if Missive swaps them. **Cannot be undone through this server.**
- `source_conversation_id`* — the conversation merged FROM (goes in the URL). `target_conversation_id`* — the surviving destination (sent as `target`). `subject` — optional new subject.

### `missive_list_conversation_messages` — `GET /conversations/:id/messages` · _ro_
- `conversation_id`*, `limit` (≤10), `until` (= `delivered_at` of previous page's oldest). Draft messages excluded.

### `missive_list_conversation_comments` — `GET /conversations/:id/comments` · _ro_
- `conversation_id`*, `limit` (≤10), `until` (= `created_at`).

### `missive_list_conversation_drafts` — `GET /conversations/:id/drafts` · _ro_
- `conversation_id`*, `limit` (≤10), `until` (= `delivered_at`).

### `missive_list_conversation_posts` — `GET /conversations/:id/posts` · _ro_
- `conversation_id`*, `limit` (≤10), `until` (= `created_at`).

---

## Messages

### `missive_get_message` — `GET /messages/:id1,:id2,…` · _ro_
Fetch one or many messages (headers, body, attachments, parent conversation).
- `message_ids`* — array; pass several to batch-fetch in one call.

### `missive_list_messages` — `GET /messages?email_message_id=…` · _ro_
Find messages by RFC 5322 `Message-ID`.
- `email_message_id`*.

### `missive_create_message` — `POST /messages`
**Advanced — custom channels only.** Creates an *incoming* (simulated inbound) message record; never transmits externally. Body `{ messages: { … } }`.
- `account` (req, or `MISSIVE_DEFAULT_ACCOUNT`), `from_field`* (object), plus `subject`, `body`, `to_fields[]`, `cc_fields[]`, `bcc_fields[]`, `delivered_at`, `attachments[]`, `external_id`, `references[]`, `conversation`, `team`, `force_team`, `organization`, `add_users[]`, `add_assignees[]`, `remove_assignees[]`, `conversation_subject`, `conversation_color`, `add_shared_labels[]`, `remove_shared_labels[]`, `add_to_inbox`, `add_to_team_inbox`, `close`.

---

## Drafts

### `missive_create_draft` — `POST /drafts`
Create a draft (email/SMS/WhatsApp/custom-channel) saved in Missive for manual review/sending. Body `{ drafts: { … } }`. **Does not send** — the `send`, `send_at`, and `auto_followup` parameters are intentionally not exposed.
- `subject`, `body` (HTML/text), `to_fields[]`, `cc_fields[]`, `bcc_fields[]`, `from_field` (`{ address, name }` for email; `{ phone_number }` for SMS — `address` must match one of your Missive aliases), `account`, `attachments[]` (`{ base64_data, filename }`, up to 25), `references[]`, `conversation`, `conversation_subject`, `conversation_color`, `organization`, `team`, `force_team`, `add_users[]`, `add_assignees[]`, `remove_assignees[]`, `add_shared_labels[]`, `remove_shared_labels[]`, `add_to_inbox`, `add_to_team_inbox`, `close`, `quote_previous_message` (default `false`; the docs flag it as a data-leak risk when replying).
- `organization` is required when using `add_users`/`add_assignees`/`remove_assignees`/`add_shared_labels`; `team` is required with `add_to_team_inbox`. The send parameters (`send`, `send_at`, `auto_followup`) are intentionally **not** exposed.

---

## Posts

### `missive_create_post` — `POST /posts`
Inject visible content into a conversation and optionally manage its state. Body `{ posts: { … } }`. **Permanent, notifies everyone with access, and cannot be undone through this server.**
- At least one of `text`, `markdown`, `attachments[]` is required.
- `notification` (`{ title, body }`), `username`, `username_icon`, `conversation_icon`, `conversation`, `references[]`, `conversation_subject`, `conversation_color`, `organization`, `team`, `force_team`, `add_users[]`, `add_assignees[]`, `remove_assignees[]`, `add_shared_labels[]`, `remove_shared_labels[]`, `add_to_inbox`, `add_to_team_inbox`, `close`, `reopen`. No `conversation`/`references` → a new conversation is created.

---

## Shared labels

### `missive_list_shared_labels` — `GET /shared_labels` · _ro_
- `organization` (optional filter, env default), `limit`, `offset`.

### `missive_create_shared_labels` — `POST /shared_labels`
Body `{ shared_labels: [...] }`.
- `shared_labels`* — each: `name`*, `organization` (req, env default), `color`, `parent`, sharing options.

### `missive_update_shared_labels` — `PATCH /shared_labels/:id1,:id2,…` · _idem_
- `shared_labels`* — one object per label, each with its `id`; change name/color/parent/sharing/visibility.

---

## Teams

### `missive_list_teams` — `GET /teams` · _ro_
- `organization` (optional filter), `limit`, `offset`.

### `missive_create_teams` — `POST /teams`
Org admin/owner only. Body `{ teams: [...] }`.
- `teams`* — each: `name`*, `organization` (req, env default), members/observers/behaviors per docs.

### `missive_update_teams` — `PATCH /teams/:id1,:id2,…` · _idem_
Org admin/owner only.
- `ids`*, `teams`* — one object per id, each with its `id`.

---

## Users & organizations

### `missive_list_users` — `GET /users` · _ro_
List users across your organizations (id, name, email, avatar_url, `me`).
- `organization` (optional filter), `limit`, `offset`.

### `missive_list_organizations` — `GET /organizations` · _ro_
List your organizations (id, name). Use it to find the `organization` id.
- `limit`, `offset`.

---

## Responses (canned replies)

### `missive_list_responses` — `GET /responses` · _ro_
- `organization` (optional filter), `limit`, `offset`.

### `missive_get_response` — `GET /responses/:id` · _ro_
- `response_id`*.

### `missive_create_responses` — `POST /responses`
Body `{ responses: [...] }`. Each response is scoped to **either** an organization (shared) **or** a user (personal) — exactly one.
- `responses`* — each: `organization` xor `user` (org defaults from env only when no `user`), optional `title`, plus `body`, `subject`, default recipients, attachments, external sync ids.

### `missive_update_responses` — `PATCH /responses/:id1,:id2,…` · _idem_
- `responses`* — one object per response, each with its `id`. Passing `attachments` replaces the whole set. Externally-synced responses (e.g. WhatsApp templates) cannot be updated.

---

## Tasks

### `missive_list_tasks` — `GET /tasks` · _ro_
List tasks by last activity (newest first).
- `organization` (optional filter), `state` ∈ `todo | in_progress | closed`, `type` ∈ `task | conversation | all`, `team`, `assignee`, `conversation`, `due_at_gteq`, `due_at_lteq`, `limit` (2–50), `until` (cursor on `last_activity_at`; no offset).

### `missive_get_task` — `GET /tasks/:id` · _ro_
- `task_id`* — includes expanded assignee/team objects.

### `missive_create_task` — `POST /tasks`
Standalone task, tasked conversation, or subtask. Body `{ tasks: { … } }`. Appears in the Tasks view, not the Inbox.
- `title`*, `description`, `state`, `organization` (required with `team`/`assignees`/`add_users`; env default), `team`, `assignees[]`, `due_at`, `subtask`, `conversation`/`references[]` (a subtask needs one), `conversation_subject`, `add_users[]`, `add_to_inbox`.

### `missive_update_task` — `PATCH /tasks/:id` · _idem_
- `task_id`*, plus any of `title`, `description`, `state`, `assignees[]`, `team`, `due_at`.

---

## Help

### `missive_help` · _ro_
Self-documentation (no API call).
- `topic` ∈ `index | overview | architecture | tools | usage | authentication | safety | conventions | extending | troubleshooting | version`.
