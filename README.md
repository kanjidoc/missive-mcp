<p align="center">
  <img src="assets/missive-icon.png" width="72" height="72" alt="Missive MCP" />
</p>

# Missive MCP

An [MCP](https://modelcontextprotocol.io) server that connects AI assistants —
**Claude Desktop** and **Claude Code** — to your [Missive](https://missiveapp.com)
team inbox. It gives the assistant **36 tools** for contacts, conversations,
messages, drafts, posts, shared labels, teams, tasks, and canned responses.

> **Safe by design.** This server can read your inbox, organize it, post internal
> team comments, and merge conversations — but it **cannot send an email or text to
> anyone outside your team, and it cannot delete anything.**
> `missive_create_draft` always *saves* a draft in Missive for a person to review
> and send; there is no "send" tool and no send parameter.

**New here?** Follow the friendly step-by-step in **[SETUP.md](SETUP.md)** — it
assumes no prior experience. The rest of this page is the quick reference.

---

## Why it feels turnkey

- **The assistant gets usage instructions at connect time.** The server ships MCP
  `instructions` (the same channel Claude Desktop uses for built-in tools), so the
  assistant already knows the rules — which list calls need a mailbox filter, that
  contacts need a `contact_book`, that drafts never send, and so on.
- **Every tool is documented at the call site,** grounded in the Missive API docs.
- **It documents itself.** Ask it to call `missive_help` (topics: `usage`, `tools`,
  `safety`, `authentication`, …) any time.

## Requirements

- **Node.js 18+**
- A **Missive personal access token**. In Missive: **Preferences → API → Create a
  new token**. (Requires an organization on the Missive **Productive** plan.)

## Install

```bash
git clone https://github.com/kanjidoc/missive-mcp.git
cd missive-mcp
npm install
cp .env.example .env        # paste your MISSIVE_API_TOKEN
npm run setup               # validates the token, lists your resource IDs
npm run build
```

`npm run setup` confirms the token works and prints your organizations, contact
books, teams, and users — handy for filling the optional defaults below — then
prints a ready-to-paste launcher config.

## Configure your client

The launcher config carries **only the start command — never your token** (the
token lives only in `.env`). Replace the path with your absolute checkout path.

**Claude Desktop** — add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "missive": {
      "command": "node",
      "args": ["/absolute/path/to/missive-mcp/dist/index.js"]
    }
  }
}
```

**Claude Code:**

```bash
claude mcp add-json missive '{"type":"stdio","command":"node","args":["/absolute/path/to/missive-mcp/dist/index.js"]}'
```

Restart the client, and the `missive` tools appear.

## Configuration (`.env`)

Only the token is required; the rest are optional defaults so you don't repeat IDs.
Find IDs in Missive → **Settings → API → Resource IDs**, or run `npm run setup`.

| Variable | Required | Purpose |
| --- | --- | --- |
| `MISSIVE_API_TOKEN` | **yes** | Your `missive_pat-…` personal access token. |
| `MISSIVE_DEFAULT_ORGANIZATION` | no | Default org; org-scoped tools use it when you omit `organization`. |
| `MISSIVE_DEFAULT_CONTACT_BOOK` | no | Default contact book; contact tools use it when you omit `contact_book`. |
| `MISSIVE_DEFAULT_TEAM` | no | Default team for drafts/tasks/posts/messages that omit `team`. |
| `MISSIVE_DEFAULT_FROM_ADDRESS` | no | Default "from" address for drafts (must be one of your Missive aliases). |
| `MISSIVE_DEFAULT_FROM_NAME` | no | Display name paired with the default from address. |
| `MISSIVE_DEFAULT_ACCOUNT` | no | Default custom-channel account for `missive_create_message`. |

---

## What's *not* included (and why)

The Missive API can do a few things this server deliberately leaves out. In plain terms:

- **Sending emails or texts to people outside your team.** The assistant can *write*
  a draft and save it in Missive, but **you** press send. This is the main safety
  guardrail — an AI can't fire off a real email on your behalf. *(Technically: the
  drafts endpoint's `send` / `send_at` / `auto_followup` options are not exposed.)*
- **Deleting things.** There is no tool to delete a contact, draft, post, canned
  response, or label. The only irreversible action offered is **merging** two
  conversations, and it's clearly marked as such.
- **Analytics reports.** Missive can generate inbox/team analytics; those are slow,
  report-style requests that don't fit a back-and-forth assistant, so they're out.
- **Webhooks (real-time event subscriptions).** Missive can notify an external app
  when something happens — that's infrastructure plumbing to set up once, not
  something an assistant does mid-conversation.
- **A few niche send-time options** that only matter when actually sending: scheduled
  send, automated follow-up sequences, and WhatsApp message templates.

Everything else in the Missive REST API — reading and organizing conversations,
contacts, tasks, labels, teams, drafts, and internal posts — is available. Any of
the above is a small, self-contained addition if you want it later.

---

## Tools (36)

Read-only tools are marked _(ro)_; safely-repeatable updates _(idem)_; irreversible
ones _(!)_. See [`docs/TOOLS.md`](docs/TOOLS.md) for the full parameter reference, and
call `missive_help` with `topic: "usage"` for recipes.

### Contacts
| Tool | Does |
| --- | --- |
| `missive_list_contacts` _(ro)_ | List contacts in a contact book (search, order, pagination). |
| `missive_get_contact` _(ro)_ | Fetch one contact by UUID. |
| `missive_create_contacts` | Create one or more contacts (infos, memberships). |
| `missive_update_contacts` _(idem)_ | Update contacts by UUID. ⚠️ `infos`/`memberships` replace the whole array. |

### Contact books & groups
| Tool | Does |
| --- | --- |
| `missive_list_contact_books` _(ro)_ | List accessible contact books (find the `contact_book` id). |
| `missive_list_contact_groups` _(ro)_ | List groups/organizations in a contact book (`kind` = group/organization). |

### Conversations
| Tool | Does |
| --- | --- |
| `missive_list_conversations` _(ro)_ | List conversations — **needs a mailbox filter** (inbox/all/assigned/… or a label/team id). |
| `missive_get_conversation` _(ro)_ | Fetch one conversation by id. |
| `missive_update_conversations` _(idem)_ | Close/reopen, move, assign, label, recolor, or rename — without posting. |
| `missive_merge_conversations` _(!)_ | Merge one conversation into another. Irreversible. |
| `missive_list_conversation_messages` _(ro)_ | List a conversation's messages. |
| `missive_list_conversation_comments` _(ro)_ | List a conversation's comments. |
| `missive_list_conversation_drafts` _(ro)_ | List a conversation's drafts. |
| `missive_list_conversation_posts` _(ro)_ | List a conversation's posts. |

### Messages
| Tool | Does |
| --- | --- |
| `missive_get_message` _(ro)_ | Fetch one or many messages by id (batch with several ids). |
| `missive_list_messages` _(ro)_ | Find messages by RFC `Message-ID`. |
| `missive_create_message` | **Advanced** — inject an *incoming* custom-channel message (never sends externally). |

### Drafts & posts
| Tool | Does |
| --- | --- |
| `missive_create_draft` | Save a draft (email/SMS/etc.) with optional attachments for manual review — **does not send**. |
| `missive_create_post` | Post an internal comment/note into a conversation (visible to your team). ⚠️ Permanent, notifies the team. |

### Shared labels
| Tool | Does |
| --- | --- |
| `missive_list_shared_labels` _(ro)_ | List shared labels (team-shared conversation tags). |
| `missive_create_shared_labels` | Create shared labels. |
| `missive_update_shared_labels` _(idem)_ | Update shared labels. |

### Teams, users & organizations
| Tool | Does |
| --- | --- |
| `missive_list_teams` _(ro)_ | List teams. |
| `missive_create_teams` | Create teams (org admin/owner only). |
| `missive_update_teams` _(idem)_ | Update teams (org admin/owner only). |
| `missive_list_users` _(ro)_ | List users across your organizations. |
| `missive_list_organizations` _(ro)_ | List your organizations (find the `organization` id). |

### Responses (canned replies)
| Tool | Does |
| --- | --- |
| `missive_list_responses` _(ro)_ | List canned reply / template responses. |
| `missive_get_response` _(ro)_ | Fetch one response by id. |
| `missive_create_responses` | Create responses — scoped to an organization **xor** a user. |
| `missive_update_responses` _(idem)_ | Update responses. |

### Tasks
| Tool | Does |
| --- | --- |
| `missive_list_tasks` _(ro)_ | List tasks (filter by state/team/assignee/due; `until` cursor). |
| `missive_get_task` _(ro)_ | Fetch one task by id. |
| `missive_create_task` | Create a task, tasked conversation, or subtask. |
| `missive_update_task` _(idem)_ | Update a task's fields. |

### Help
| Tool | Does |
| --- | --- |
| `missive_help` _(ro)_ | Self-documentation: overview, usage, tools, safety, authentication, and more. |

---

## How the assistant calls it

A few rules the server teaches the model (and worth knowing yourself):

- **`missive_list_conversations` needs a mailbox filter** — a boolean like
  `inbox: true`, or an id like `shared_label` / `team_inbox`. To filter by who's
  involved, add exactly one of `email` / `domain` / `contact_organization`.
- **Contacts need a `contact_book`**; org-scoped writes need an `organization`
  (set the `MISSIVE_DEFAULT_*` vars to avoid repeating them).
- **`missive_update_contacts` replaces** the whole `infos`/`memberships` array you
  send — fetch first, then send the full merged array.
- **Replying?** Pass `conversation` or `references` to `missive_create_draft` and set
  `subject` to `"Re: …"`. If you set `MISSIVE_DEFAULT_FROM_ADDRESS`, the draft uses it
  automatically; otherwise the assistant takes the from-address from the thread.

**Example recipes** (the assistant chains these for you):

- *Triage:* `missive_list_conversations(inbox: true)` → `missive_update_conversations(close: true, …)`
- *Internal note:* `missive_create_post(markdown: "…")` — posts to the team; no email is sent.
- *Draft a reply:* `missive_get_conversation` + `missive_list_conversation_messages` → `missive_create_draft(conversation, to_fields, subject: "Re: …", body)`
- *Merge duplicates:* `missive_merge_conversations(source_conversation_id, target_conversation_id)`
- *Tasks:* `missive_list_tasks(state: "todo")` / `missive_create_task` / `missive_update_task`

## Rate limits

Missive allows 5 concurrent requests, 300/minute, and 900/15 minutes. The client
caps concurrency and automatically retries HTTP 429 honoring `Retry-After`. For
bulk reads, prefer the batch endpoints (e.g. `missive_get_message` with several ids).

## Development

```bash
npm run dev     # run with ts-node (no build)
npm run build   # compile to dist/
npm run lint    # eslint
npm test        # vitest
npm run format  # prettier
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md) to add a tool, [`CLAUDE.md`](CLAUDE.md) for
the architecture and conventions, and [`SECURITY.md`](SECURITY.md) for credential
handling. The design rationale lives in [`docs/superpowers/specs/`](docs/superpowers/specs/).

## License

[MIT](LICENSE) © kanjidoc
