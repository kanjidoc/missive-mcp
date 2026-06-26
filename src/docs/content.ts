import { getVersion } from "../version";

/**
 * Embedded documentation for the `missive_help` tool. Static topics are exported
 * as strings; dynamic ones (version, overview) as render functions. Keeping the
 * prose here — compiled into the build — lets an assistant understand the
 * project without reading source.
 */

export function renderOverviewTopic(): string {
  return `# Missive MCP — Overview

An MCP server that exposes the Missive REST API (https://missiveapp.com/docs/developers/rest-api)
to AI assistants in Claude Desktop and Claude Code.

**What it can do:** read and manage contacts, conversations, messages, drafts,
posts (internal notes), shared labels, teams, users, organizations, canned
responses, and tasks.

**What it can and can't do (by design):**
- **Internal posts: yes.** \`missive_create_post\` adds internal comments/notes to a
  conversation (visible to your team) — internal "messaging" is fully supported.
- **Merge conversations: yes.** \`missive_merge_conversations\` merges one
  conversation into another (irreversible).
- **External email: no auto-send.** \`missive_create_draft\` saves a draft in Missive
  for a human to review and send; it exposes no \`send\` / \`send_at\` /
  \`auto_followup\` parameter, so it can never send an email/SMS on its own.
- **No deletes.** There are no delete tools.
- **Analytics / webhooks.** Out of scope for this build.

Call \`missive_help\` with a \`topic\` for more: overview, architecture, tools,
authentication, safety, conventions, extending, troubleshooting, version.`;
}

export function renderVersionTopic(): string {
  return `# Missive MCP — Version

Installed version: **${getVersion()}** (from package.json, the single source of truth).

To check for updates, compare against the repository's latest release. To update,
pull the latest code and run \`npm install && npm run build\`, then restart your
MCP client so it relaunches the server.`;
}

export const TOPIC_ARCHITECTURE = `# Missive MCP — Architecture

\`\`\`
src/
  index.ts          stdio entry: StdioServerTransport + server.instance.connect
  server.ts         createSdkMcpServer({ name:"missive", version, tools: allTools })
  load-env.ts       loads .env by absolute path (override:true, quiet:true)
  version.ts        single-source version (reads package.json)
  missive-client.ts fetch wrapper: auth, timeout, rate limiting, result shaping
  tool-helpers.ts   jsonResult / errorResult / handle / resolve(Org|ContactBook)
  query-helpers.ts  buildQuery / joinIds / validateBatchIds
  tool-registry.ts  allTools = [ every tool ]
  tools/*.ts        one file per Missive resource
  docs/             help content + live tool inventory renderer
\`\`\`

A request flows: tool handler → \`missiveRequest(method, path, { query, body })\`
→ \`fetch\` (with auth + timeout + concurrency cap + 429 retry) → \`MissiveResult\`
→ \`handle()\` maps it to the MCP content result. No OAuth/token-refresh layer
exists because the Missive token is static.`;

export const TOPIC_AUTHENTICATION = `# Missive MCP — Authentication

Missive uses a single **personal access token** (no OAuth, no refresh).

1. In Missive: Preferences > API > Create a new token (requires the Productive plan).
2. Put it in \`.env\` next to this package as \`MISSIVE_API_TOKEN=missive_pat-...\`.
3. The token is sent as \`Authorization: Bearer <token>\` on every request.

The token is read lazily, per call, from \`process.env\` (loaded from \`.env\` by
\`load-env.ts\`). Launcher configs (\`.mcp.json\`, Claude Desktop config) carry only
the command to start the server — never the token.

Optional convenience defaults (\`.env\`):
- \`MISSIVE_DEFAULT_ORGANIZATION\` — used by org-scoped tools when you omit \`organization\`.
- \`MISSIVE_DEFAULT_CONTACT_BOOK\` — used by contact tools when you omit \`contact_book\`.`;

export const TOPIC_SAFETY = `# Missive MCP — Safety & rate limits

**This server can post internal comments and merge conversations, but it never
sends external email/SMS and has no delete tools.** "Sending" an email in Missive
means the \`send\`/\`send_at\`/\`auto_followup\` flags on the drafts endpoint, and
\`missive_create_draft\` exposes none of them — every draft is saved for a human to
review and send. Internal actions (\`missive_create_post\`,
\`missive_merge_conversations\`) ARE available; they never email anyone outside.

**A few writes still mutate state — use with care:**
- \`missive_create_post\` leaves a permanent, visible post and notifies everyone
  with conversation access; it cannot be undone through this server.
- \`missive_merge_conversations\` is irreversible — the source conversation is
  merged into the target and cannot be split back.
- \`missive_update_contacts\` REPLACES the whole \`infos\`/\`memberships\` array when
  you pass one — omitted items are deleted. Read-merge before writing.
- \`missive_update_conversations\` can close/reopen/label/assign (all reversible).

**Rate limits** (enforced by Missive): 5 concurrent requests, 300/minute,
900/15 minutes. The client caps concurrency at 4 and retries on HTTP 429 honoring
\`Retry-After\`. For high volume, prefer the batch comma-id endpoints (e.g.
\`missive_get_message\` with multiple IDs) to reduce the number of calls.`;

export const TOPIC_CONVENTIONS = `# Missive MCP — Conventions

- **Naming:** snake_case, prefixed \`missive_\` (e.g. \`missive_list_contacts\`).
- **Errors:** tools never throw to the client; failures return an \`isError\` text
  result like \`Missive error (404): ...\`. API success is any 2xx.
- **Output:** tools return Missive's JSON response as-is (pretty-printed). Missive
  wraps payloads by resource, e.g. \`{ "contacts": [...] }\`, \`{ "drafts": {...} }\`.
- **Validation:** every field is a described zod field; bodies are assembled only
  from declared fields (no passthrough), which is what guarantees no-send.
- **Batch endpoints:** comma-separated IDs in the path; updates require one body
  object per id (validated by \`validateBatchIds\`).`;

export const TOPIC_EXTENDING = `# Missive MCP — Extending

To add a tool:
1. Find the endpoint in the Missive docs (https://missiveapp.com/docs/developers/rest-api/endpoints).
2. In the matching \`src/tools/<resource>.ts\`, export a \`tool(name, description, zodShape, handler, { annotations })\`.
3. In the handler, call \`handle(() => missiveRequest(method, path, { query, body }))\`.
   Build \`body\` field-by-field from validated args (never spread an unchecked object).
4. Register the export in \`src/tool-registry.ts\` (in display order).
5. Update the hard-coded tool count in \`test/doc-tool-count.test.ts\` and the docs.

Gotchas: keep \`module:"commonjs"\`; never write to stdout (it carries JSON-RPC);
read \`MISSIVE_API_TOKEN\` lazily, never at import time.`;

export const TOPIC_TROUBLESHOOTING = `# Missive MCP — Troubleshooting

- **"MISSIVE_API_TOKEN is not set"** — add the token to \`.env\` next to the package
  and restart your MCP client.
- **401 Unauthorized** — the token is invalid/revoked; create a new one in Missive.
- **429** — you hit a rate limit; the client retries automatically, but a large
  bulk loop can still exhaust retries. Slow down or use batch comma-id endpoints.
- **"organization is required"** — pass \`organization\` or set
  \`MISSIVE_DEFAULT_ORGANIZATION\` in \`.env\`.
- **list_conversations error about mailbox** — you must pass at least one mailbox
  filter (e.g. \`inbox: true\`, or a \`shared_label\` / \`team_inbox\` id).
- **Server won't start / garbled output** — ensure nothing writes to stdout; only
  stderr is safe (stdout is the protocol channel).`;
