# Missive MCP — Design Spec

**Date:** 2026-06-26
**Status:** Approved & hardened via 3-lens multi-agent review (human approval gates delegated to agents per user instruction). §11 records the binding review corrections and **takes precedence** over any conflicting earlier prose.
**Modeled on:** `/Users/tonyfabiano/Documents/Cursor/FreshBooks-MCP`
**API reference (canonical, local copy):** `…/scratchpad/missive-docs/rest-api_endpoints.md` (3,383 lines) + `rest-api.md`, `rest-api_rate-limits.md`

---

## 1. Goal & success criteria

A standalone **stdio MCP server** exposing the Missive REST API to Claude Desktop and Claude Code, structurally modeled on FreshBooks-MCP but **without the OAuth subsystem** (Missive uses a static personal token).

**Definition of done (objective, agent-verifiable):**
1. `npm run build` (tsc) — zero errors.
2. `npm run lint` (eslint) — zero errors.
3. `npm test` (vitest) — all green, including a `doc-tool-count` test asserting the `help` tool inventory equals the registry.
4. A final multi-agent adversarial review pass produces **zero confirmed defects** (bugs, silent failures, type-design, comment accuracy).
5. The server boots over stdio and lists all tools (smoke check).

---

## 2. Scope

**In scope — Core (~35 tools):** contacts, contact books, contact groups, conversations (+ nested messages/comments/drafts/posts lists), messages, drafts (create only), posts (create only), shared labels, teams, users, organizations, responses (canned), tasks, plus a `help` self-doc tool.

**Out of scope (excluded by decision):**
- **Analytics** (`/v1/analytics/reports`) — async report polling, poor interactive fit.
- **Webhooks / Hooks** (`/v1/hooks`) — integration plumbing.
- **All `DELETE` endpoints** — drafts, posts, responses (no hard deletes).
- **The send path** — `create_draft` exposes no `send`, `send_at`, or `auto_followup` params.
- **`merge_conversations`** (`POST /v1/conversations/:id/merge`) — irreversible; deferred.

**Borderline decisions (resolved):**
- `create_message` (custom-channel incoming message) — **included**, labeled advanced; not an email send.
- `update_conversations` — **kept** (core triage: close/reopen/label/assign); `close`/trash-like fields documented clearly.

---

## 3. Architecture & file layout

```
missive-mcp/
  package.json  tsconfig.json  eslint.config.js  .prettierrc  .gitignore
  .env.example  .mcp.json  LICENSE
  README.md  SETUP.md  CHANGELOG.md  CONTRIBUTING.md  SECURITY.md
  .github/workflows/{ci.yml,release.yml}
  scripts/setup.ts            # validate token; print orgs / contact books / teams / users for .env defaults
  src/
    index.ts                  # stdio entry: StdioServerTransport + server.instance.connect
    server.ts                 # createSdkMcpServer({ name:"missive", version, tools: allTools })
    load-env.ts               # dotenv: absolute ../.env, override:true, quiet:true  (stdout safety)
    version.ts                # single-source version (reads package.json)
    missive-client.ts         # fetch wrapper: auth, timeout, rate-limit (semaphore + 429 retry), result shaping
    tool-helpers.ts           # jsonResult / errorResult / handle() — shared tool boilerplate
    query-helpers.ts          # buildQuery(), joinIds(), validateBatchIds(), pagination param helpers
    mcp-config.ts             # buildClaudeServerConfig() — used by scripts/setup.ts to print launcher JSON
    tool-registry.ts          # allTools = [ ...every tool ]  (NO token-refresh wrapper)
    tools/
      contacts.ts  contact-books.ts  contact-groups.ts
      conversations.ts  messages.ts  drafts.ts  posts.ts
      shared-labels.ts  teams.ts  users.ts  organizations.ts
      responses.ts  tasks.ts  help.ts
    docs/
      content.ts              # help-tool prose (overview, auth, rate limits, resource notes)
      render-tools.ts         # renders the registry into the help tool's inventory
  test/
    missive-client.test.ts  query-helpers.test.ts  tool-helpers.test.ts
    mcp-config.test.ts  version.test.ts  doc-tool-count.test.ts  load-env.test.ts
```

**What disappears vs. FreshBooks-MCP:** `with-refresh.ts`, `refresh-tokens.ts`, JWT decode, atomic `.env` rewrite, single-flight refresh, `config-paths.ts`. Missive's token is static — none of it is needed.

**Server bootstrap** mirrors FreshBooks exactly: `server.ts` uses `createSdkMcpServer` from `@anthropic-ai/claude-agent-sdk`; `index.ts` connects `server.instance` to a `StdioServerTransport` from `@modelcontextprotocol/sdk`. Tools are authored with the SDK's `tool(name, description, zodShape, handler, { annotations })` helper.

**Build config (pinned — load-bearing):** **CommonJS**, matching the reference. `tsconfig.json`: `module:"commonjs"`, `target:"ES2022"`, `moduleResolution:"node"`, `outDir:"dist"`, `strict:true`. `package.json` has **no `"type":"module"`**. This is mandatory because the reused `version.ts` (`require("../package.json")`), `docs/render-tools.ts` (`require("../tool-registry")`), and `load-env.ts` (`__dirname`) all depend on CJS semantics. Global `fetch`/`AbortController` are available under CJS on Node ≥18, so nothing forces ESM.

---

## 4. The HTTP client contract (`missive-client.ts`)

Every tool depends on this; it is the load-bearing interface. Hand-written over Node global `fetch` (Node ≥18).

```ts
const BASE_URL = "https://public.missiveapp.com/v1";

export type MissiveResult<T = unknown> =
  | { ok: true;  status: number; data: T }
  | { ok: false; status: number; error: string };

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;                 // serialized as JSON; sets Content-Type: application/json
  timeoutMs?: number;             // default 30_000
}

export async function missiveRequest<T = unknown>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,                   // e.g. "/contacts", `/conversations/${id}/messages`
  opts?: RequestOptions,
): Promise<MissiveResult<T>>;
```

**Behavior:**
- **Auth:** `Authorization: Bearer ${MISSIVE_API_TOKEN}`. Throws a clear error at call time if the env var is missing (lazy — never read at import, so tests can stub).
- **Query:** `undefined`/`null` params dropped; booleans serialized as `"true"`/`"false"`; numbers stringified.
- **Body:** JSON-stringified; `Content-Type: application/json` header set only when a body is present.
- **Success:** `status >= 200 && status < 300` → `{ ok:true, status, data }` (covers 200/201/202/204). Empty body (e.g. 201/204 with no content) → `data` is `{}`. The success path **guards `JSON.parse`** — a 2xx with a non-JSON body yields `data` = the raw text rather than throwing.
- **Errors:** any non-2xx → `{ ok:false, status, error }` where `error` is the parsed JSON error message if present, else the raw text, else the status text.
- **Timeout vs network error (must be distinguished):** an `AbortController` (default 30s) aborts the request; the client sets an internal `timedOut` flag before aborting so the resulting `AbortError` maps to `{ ok:false, status:0, error:"request timed out after 30000ms" }`, while any other pre-response failure maps to `{ ok:false, status:0, error:<network message> }`. The abort timer is always cleared in a `finally` (no timer leak / late abort).
- **Rate limiting (semaphore + retry):**
  - A process-wide **semaphore caps concurrency at 4** (Missive allows 5; stay under). Acquire → `try { … } finally { release() }` so a throw/abort inside the critical section **can never leak a permit** (otherwise concurrency silently decays to 0 and the server hangs over time). This is a unit-tested invariant.
  - On **429**, read `Retry-After` (seconds), wait, and retry **up to 2 times** with capped backoff. The permit is **held across the `Retry-After` wait** (natural back-pressure). Exhausted retries surface the 429 as `{ ok:false, status:429, error }`.
  - Note: the semaphore only bounds the **5-concurrent** ceiling. The sustained **300/min** and **900/15min** caps are handled reactively via 429+Retry-After; a large bulk loop can still exhaust retries (acceptable for interactive use — documented in `help`, with batch comma-id endpoints recommended).

**Response envelope note:** Missive wraps payloads by resource, e.g. `{ "contacts": [...] }`, `{ "conversations": [...] }`, `{ "drafts": {...} }`. Tools return the parsed body **as-is** (pretty-printed JSON) so no information is lost; they do not unwrap.

---

## 5. Conventions (every tool follows these)

- **Naming:** snake_case, prefixed `missive_` (e.g. `missive_list_contacts`, `missive_create_draft`).
- **Shared helpers (`tool-helpers.ts`):**
  ```ts
  jsonResult(data): { content:[{type:"text",text: JSON.stringify(data,null,2)}] }
  errorResult(msg): { content:[{type:"text",text: msg}], isError:true }
  // handle() takes a fn returning a MissiveResult, unwraps it, and catches throws:
  async function handle<T>(fn: () => Promise<MissiveResult<T>>): Promise<ToolResult> {
    try {
      const res = await fn();
      return res.ok ? jsonResult(res.data) : errorResult(`Missive error (${res.status}): ${res.error}`);
    } catch (e) {
      return errorResult(e instanceof Error ? e.message : String(e));
    }
  }
  ```
  Tools call `handle(() => missiveRequest("GET", "/contacts", { query }))` — the wrapped fn **returns the raw `MissiveResult`** (NOT `res.data`), so `handle` can map `ok:false` to an error result. This removes the repeated try/catch boilerplate from FreshBooks tools while keeping behavior identical. (For tools needing pre-flight validation, do it before the `handle` call or have the fn `throw` — the catch turns it into an `errorResult`.)
- **Lazy env-default resolvers (`tool-helpers.ts`):** `resolveOrg(arg?)` and `resolveContactBook(arg?)` read `process.env` **at call time** and return the explicit arg ?? the env default, or `throw` a clear "missing X — pass it explicitly or set MISSIVE_DEFAULT_…" error (caught by `handle`). Mirrors the reference `getAccountId()` lazy pattern. **Used only by tools where the param is genuinely required** (see §11: list-filter `organization` is optional and must NOT use the throwing resolver).
- **Validation:** zod shapes with `.describe()` on every field. **Object schemas strip unknown keys (zod default; never `.passthrough()`), and no tool exposes a raw/freeform JSON body field** — request bodies are assembled field-by-field from declared zod fields only (this is what structurally guarantees no-send; see §11). Cross-field rules the schema can't express (e.g. mutually-exclusive conversation filters, one-body-object-per-PATCH-id) are enforced in-handler with a clear `errorResult`.
- **Annotations:**
  - Read tools → `readOnlyHint: true`.
  - Updates → `idempotentHint: true`.
  - `create_message`, `create_draft` → no destructive hint (drafts don't send), but descriptions state exactly what they do.
  - There are **no** `destructiveHint`/delete tools in this build.
- **Env-default fallbacks (two distinct cases — see §11):**
  - **Required** params (`create_contacts.contact_book`, `list_contacts`/`list_contact_groups` `contact_book`): use `resolveContactBook()` which falls back to `MISSIVE_DEFAULT_CONTACT_BOOK` and **errors** if still absent.
  - **Optional filter** params (`organization` on the *list* tools `list_shared_labels`/`list_teams`/`list_users`/`list_responses`/`list_tasks`/`list_conversations`): use `args.organization ?? process.env.MISSIVE_DEFAULT_ORGANIZATION` and **omit the param entirely when both are absent — never error** (the API lists across all accessible orgs).
  - `organization` that the API requires *conditionally* (e.g. `update_conversations` with `add_assignees`/`add_users`/`add_shared_labels`; `create_responses` org-XOR-user) is enforced in-handler per §11.

---

## 6. Tool catalog (~35 tools)

Each entry: `tool_name` — METHOD path — key params/notes.

### Contacts (`tools/contacts.ts`)
- `missive_list_contacts` — GET `/contacts` — requires `contact_book` (or env default); `search`, `order` (`last_name`|`last_modified`), `limit`(≤200), `offset`, `modified_since`, `include_deleted`. **readOnly**
- `missive_get_contact` — GET `/contacts/:id` — `contact_id`. **readOnly**
- `missive_create_contacts` — POST `/contacts` — `contacts[]` (each: `contact_book` req'd/default, names, `starred`, `infos[]`, `memberships[]`). Body shape `{ contacts: [...] }`.
- `missive_update_contacts` — PATCH `/contacts/:id1,:id2,…` — `contacts[]` each with `id`. **Warn in description:** passing `infos`/`memberships` replaces the whole array (omitted items are deleted). **idempotent**

### Contact books (`tools/contact-books.ts`)
- `missive_list_contact_books` — GET `/contact_books` — `limit`(≤200), `offset`. **readOnly**

### Contact groups (`tools/contact-groups.ts`)
- `missive_list_contact_groups` — GET `/contact_groups` — requires `contact_book` (or default) + `kind` (`group`|`organization`); `limit`, `offset`. **readOnly**

### Conversations (`tools/conversations.ts`)
- `missive_list_conversations` — GET `/conversations` — **requires ≥1 mailbox filter** (`inbox`/`all`/`assigned`/`closed`/`snoozed`/`flagged`/`trashed`/`junked`/`drafts` booleans, or `shared_label`/`team_inbox`/`team_closed`/`team_all` IDs); enforce in-handler. Optional `organization`, and **mutually exclusive** `email`|`domain`|`contact_organization` (enforce). `limit`(≤50), `until`. **readOnly**
- `missive_get_conversation` — GET `/conversations/:id` — `conversation_id`. **readOnly**
- `missive_update_conversations` — PATCH `/conversations/:id[,:id2,…]` — `conversations[]` each with `id`; fields: `subject`, `color`, `add/remove_shared_labels`, `add_assignees`/`remove_assignees`/`add_users` (require `organization`), `team`/`force_team`, `add_to_inbox`/`add_to_team_inbox`, `close`, `reopen`. Body must have one object per URL id. **idempotent**
- `missive_list_conversation_messages` — GET `/conversations/:id/messages` — `conversation_id`, `limit`, `until`. **readOnly**
- `missive_list_conversation_comments` — GET `/conversations/:id/comments` — `conversation_id`, `limit`, `until`. **readOnly**
- `missive_list_conversation_drafts` — GET `/conversations/:id/drafts` — `conversation_id`. **readOnly**
- `missive_list_conversation_posts` — GET `/conversations/:id/posts` — `conversation_id`. **readOnly**

### Messages (`tools/messages.ts`)
- `missive_get_message` — GET `/messages/:id[,:id2,…]` — `message_ids` (1+; comma-joined for batch). **readOnly**
- `missive_list_messages` — GET `/messages?email_message_id=…` — `email_message_id` (RFC Message-ID). **readOnly**
- `missive_create_message` — POST `/messages` — **advanced; custom channels only.** Inject an incoming message into a custom channel. Body `{ messages: {...} }` per docs. Description clearly states it is not an email send.

### Drafts (`tools/drafts.ts`)
- `missive_create_draft` — POST `/drafts` — body `{ drafts: {...} }`. Exposed params: `subject`, `body` (HTML/text), `to_fields[]`, `cc_fields[]`, `bcc_fields[]`, `from_field`, `account`, `references[]`, `conversation`, `conversation_subject`, `organization`, `team`/`force_team`, `add_shared_labels`/`remove_shared_labels`, `add_to_inbox`, `quote_previous_message` (default **false**, description carries the data-leak warning). **Deliberately NOT exposed:** `send`, `send_at`, `auto_followup`. Description: "Creates a draft saved in Missive for manual review/sending — it does NOT send."

### Posts (`tools/posts.ts`)
- `missive_create_post` — POST `/posts` — body `{ posts: {...} }`. A post adds visible content/notification into a conversation (text/markdown, optional `attachments`, `notification`, conversation targeting via `conversation`/`references`, label/assignee/inbox fields). Read the endpoints doc Posts section for the full field list. **idempotent? no** — a plain create.

### Shared labels (`tools/shared-labels.ts`)
- `missive_list_shared_labels` — GET `/shared_labels` — `organization` (or default), pagination. **readOnly**
- `missive_create_shared_labels` — POST `/shared_labels` — `shared_labels[]` (`name`, `organization`, optional `parent`, `color`, `share_with_organization`/`share_with_team`).
- `missive_update_shared_labels` — PATCH `/shared_labels/:id1,…` — `shared_labels[]` each with `id`. **idempotent**

### Teams (`tools/teams.ts`)
- `missive_list_teams` — GET `/teams` — `organization` (or default), pagination. **readOnly**
- `missive_create_teams` — POST `/teams` — `teams[]` (`name`, `organization`, members…).
- `missive_update_teams` — PATCH `/teams/:id1,…` — `teams[]` each with `id`. **idempotent**

### Users (`tools/users.ts`)
- `missive_list_users` — GET `/users` — `organization` (or default), pagination. **readOnly**

### Organizations (`tools/organizations.ts`)
- `missive_list_organizations` — GET `/organizations` — pagination. **readOnly**

### Responses / canned (`tools/responses.ts`)
- `missive_list_responses` — GET `/responses` — `organization` (or default), pagination. **readOnly**
- `missive_get_response` — GET `/responses/:id` — `response_id`. **readOnly**
- `missive_create_responses` — POST `/responses` — `responses[]`.
- `missive_update_responses` — PATCH `/responses/:id1,…` — `responses[]` each with `id`. **idempotent**

### Tasks (`tools/tasks.ts`)
- `missive_list_tasks` — GET `/tasks` — `organization` (or default), `state` (`todo`|…), `limit`, pagination. **readOnly**
- `missive_get_task` — GET `/tasks/:id` — `task_id`. **readOnly**
- `missive_create_task` — POST `/tasks` — body `{ tasks: {...} }` (`title`/`description`, `organization`, `team`/`assignees`, `due_at`, `state`…).
- `missive_update_task` — PATCH `/tasks/:id` — `task_id` + updatable fields. **idempotent**

### Self-documentation (`tools/help.ts`)
- `missive_help` — no API call. Returns: auth/setup summary, rate-limit notes, env-default explanation, and a generated inventory of every registered tool (name + one-line description) via `docs/render-tools.ts`. The `doc-tool-count` test asserts this inventory length equals the registry length.

> **Per-tool exact fields:** implementation agents MUST read the matching section of the local `rest-api_endpoints.md` for authoritative field names, required markers, and accepted enum values before writing each tool.

---

## 7. Configuration

`.env` (loaded by absolute path, `override:true`, `quiet:true`):
- `MISSIVE_API_TOKEN` — **required**, `missive_pat-…`.
- `MISSIVE_DEFAULT_ORGANIZATION` — optional UUID; fallback for org-scoped tools.
- `MISSIVE_DEFAULT_CONTACT_BOOK` — optional UUID; fallback for contact tools.

`.mcp.json` and the Claude Desktop config carry **only** the launch command — never the token. `scripts/setup.ts` validates the token against `GET /v1/users` (or `/organizations`) and prints the user's orgs / contact books / teams so they can populate the optional defaults.

---

## 8. Testing strategy (vitest)

- **`missive-client.test.ts`** — mock global `fetch`: asserts URL+query construction, auth header, JSON body + Content-Type, 200/201-empty handling, non-2xx error shaping, timeout shaping, and 429 `Retry-After` retry logic. Stub `MISSIVE_API_TOKEN`.
- **`query-helpers.test.ts`** — query-string building (drops undefined, bool serialization), `joinIds`.
- **`tool-helpers.test.ts`** — `jsonResult`/`errorResult`/`handle` (throw → errorResult; `ok:false` → formatted error).
- **`mcp-config.test.ts`** — `.mcp.json` parses, references the built entry, carries no token.
- **`version.test.ts`** — `getVersion()` equals `package.json` version (single source).
- **`doc-tool-count.test.ts`** — help inventory length === `allTools` length; every tool name appears.
- **`load-env.test.ts`** — dotenv options contract (absolute path, override, quiet).

---

## 9. Workflow-driven build & review (how "perfection" is reached)

1. **Foundation (direct, verified):** config files + `load-env`, `version`, `missive-client`, `tool-helpers`, `query-helpers`, `server`, `index`, registry stub. Establishes the contract every tool compiles against.
2. **Tool implementation — `/workflows` fan-out:** one agent per tool file, each given (this spec + the relevant `endpoints.md` section + the client contract). Agents write directly to `src/tools/*.ts` (files are independent → no write conflicts).
3. **Adversarial review — `/workflows` pipeline:** each implemented file is reviewed by independent lenses (correctness/bugs, silent-failure, type-design, doc/comment accuracy). Findings flow back as fix tasks.
4. **Integrate + verify (direct loop):** wire `tool-registry` + `help`, write tests, run `tsc` + `eslint` + `vitest`; loop fixes (re-dispatch a fix workflow if many issues) until all green.
5. **Docs + CI + final review:** author README/SETUP/CHANGELOG/etc. and CI workflows; final multi-agent review pass; fix until zero confirmed findings.

**Gate to ship:** §1 Definition of Done fully satisfied.

---

## 10. Non-goals / explicitly deferred

Analytics reports, webhook management, all deletes, the email send path, and conversation merge. Each is a small, isolated add-on if wanted later — none affect the architecture above.

---

## 11. Review-driven hardening (BINDING — overrides any conflicting earlier prose)

These corrections came out of the 3-lens multi-agent spec review. Implementation MUST follow them.

### 11.1 Safety hardening (no-send is structural, not incidental)
- **Allow-list body builder.** `create_draft`, `create_message`, `create_post`, and every create/update tool MUST build the request body field-by-field from declared zod fields only. No `.passthrough()`, no `extra`/`raw_body`/freeform-JSON field, no spreading an un-validated object into the body. This is what makes "no send" unbreakable.
- **`create_draft` exposes none of `send`, `send_at`, `auto_followup`** (the complete outbound surface — confirmed against endpoints.md L1474-1476). `external_response_id`/`external_response_variables` (WhatsApp template init) are also intentionally omitted because they pair with `send`; do not add them back.
- **Regression test:** assert that calling `create_draft` with an injected `send:true` (and `send_at`) does NOT forward it — the serialized body must contain no `send`/`send_at`/`auto_followup` key.
- **Descriptions carry the warnings (in the live `.describe()`, not just here):**
  - `create_draft`: "Creates a draft saved in Missive for manual review/sending — it does NOT send." `quote_previous_message` default **false** + carry the doc's data-leak warning.
  - `create_message`: "Custom channels only. Creates an INCOMING message record (simulated inbound); never transmits externally. `account` required." Enforce `account` (or a custom-channel id) in-handler.
  - `create_post`: "Leaves a permanent, visible post in the conversation and notifies everyone with access; it cannot be undone through this server."
  - `update_contacts`: "Passing `infos` or `memberships` REPLACES the whole array — omitted items are deleted. Read-merge before writing."

### 11.2 API-correctness corrections
- **`organization` is an OPTIONAL filter** (not required, no error when absent) on `list_shared_labels`, `list_teams`, `list_users`, `list_responses`, `list_tasks`, `list_conversations`. Resolve as `args.organization ?? env default ?? omit`.
- **`update_conversations`: `add_shared_labels` ALSO requires `organization`** (alongside `add_users`/`add_assignees`/`remove_assignees`) — endpoints.md L935. Same conditional applies wherever those fields appear on `create_draft`.
- **`create_responses`: `organization` XOR `user`** — exactly one is required, never both (L2158-2159). Inject `MISSIVE_DEFAULT_ORGANIZATION` ONLY when `user` is not supplied. `title` is NOT required.
- **`list_tasks` pagination:** cursor-style `until` (Unix `last_activity_at`; subtract 1 to avoid dupes), `limit` **min 2 / max 50** — NOT offset/limit-200.
- **Nested conversation lists** (`list_conversation_messages`/`comments`/`drafts`/`posts`): `limit` **default 10 / max 10**. Expose `limit` AND `until` on ALL FOUR (the spec earlier under-listed drafts/posts as taking only `conversation_id`).
- **`create_post.notification`:** the doc's attribute table marks it required but its Validations block says only one of `text`/`markdown`/`attachments` is required (self-contradictory, L2368 vs L2387). Treat `notification` as **optional**; verify against a live call before asserting requiredness.
- **Request-body envelopes confirmed correct** (no change, listed for implementers): contacts/responses/shared_labels/teams updates → `{ <plural>: [ … ] }` (array); `drafts`→`{drafts:{…}}`, `messages`→`{messages:{…}}`, `posts`→`{posts:{…}}`, `tasks`→`{tasks:{…}}` (objects). PATCH paths use comma-joined ids with one body object per id.

### 11.3 Architecture corrections
- **`handle()` contract** = the corrected signature in §5 (wrapped fn returns the raw `MissiveResult`).
- **Success = 2xx range**, empty body → `data:{}`, `JSON.parse` guarded (§4).
- **Semaphore:** acquire→try/finally→release (no permit leak); hold permit across `Retry-After`; unit-test the no-leak invariant.
- **Timeout vs network error distinguished** via an internal `timedOut` flag; `clearTimeout` in `finally` (§4).
- **`validateBatchIds(ids, bodyObjects)`** helper in `query-helpers.ts` — used by all 5 batch-PATCH update tools to assert one body object per URL id (each carrying its `id`) and to build the comma path. Don't re-implement per tool.
- **`load-env.ts` comment** must be REWRITTEN for a static token: justify `override:true` as "`.env` is the authoritative token store" and `quiet:true` as stdout/JSON-RPC safety — DROP the FreshBooks "kept fresh by refresh logic" rationale (it's false here; copying it verbatim would fail the comment-accuracy gate).
- **eslint:** keep `@typescript-eslint/no-explicit-any` **enabled** (the hand-written `fetch` client needs no `any`, unlike the reference's axios/SDK glue). Lint `src/` only (match reference; `test/**` not linted).

### 11.4 Testing / Definition-of-Done corrections
- **`doc-tool-count.test.ts` must actually guard something** (the naive "help length === registry length" is tautological because the help inventory is generated from the registry). Instead: (a) assert `allTools.length === <hardcoded expected total>` so an accidental drop/dup of a registry entry fails loudly, and (b) scan README/SETUP for the literal tool count and assert it matches the registry (doc-rot guard, mirroring the reference).
- **Keep `mcp-config.ts` + `mcp-config.test.ts`** (parses/validates the emitted launcher config; carries no token) since `scripts/setup.ts` uses `buildClaudeServerConfig()` to print a ready-to-paste config block.
- **Keep `extract-changelog` + its test** if `release.yml` is kept (it is) — the release workflow extracts the CHANGELOG section for the GitHub release.
- Add `test/missive-client.test.ts` cases for: 2xx-empty body, non-JSON 2xx body, timeout-vs-network distinction, 429 Retry-After retry + exhaustion, and the semaphore permit-release-on-throw invariant.

### 11.5 `help` tool content additions
Document the rate-limit reality (5 concurrent / 300 per min / 900 per 15 min; bulk loops may hit 429; prefer batch comma-id endpoints), the two optional env defaults, and the explicit "this server cannot send email or delete records" safety statement.
