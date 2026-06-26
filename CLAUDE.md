# CLAUDE.md

Guidance for Claude Code (and any AI agent or contributor) working in this
repository. This file is committed on purpose — it contains no secrets, only
project conventions. The credential lives only in `.env`, which is gitignored.

## What this is

A Model Context Protocol (MCP) **stdio server** that exposes the
[Missive REST API](https://missiveapp.com/docs/developers/rest-api) as **36 tools**
for AI assistants (Claude Desktop, Claude Code). Tools are prefixed `missive_`.
It is modeled on the FreshBooks-MCP project but has **no OAuth layer** — Missive
uses a static personal access token.

## Non-negotiables (read before editing)

1. **Never send external email/SMS.** Sending in Missive is the
   `send` / `send_at` / `auto_followup` flags on the drafts endpoint.
   `src/tools/drafts.ts` must never expose or set them. `test/tools.test.ts`
   asserts the draft body contains none of these keys — keep it green.
2. **No delete tools.** There is no `DELETE` in the client's `HttpMethod` union,
   so a delete call won't even type-check. Don't add one without explicit owner sign-off.
3. **Internal posts and conversation merge ARE allowed** (`missive_create_post`,
   `missive_merge_conversations`) — they act only within Missive. Merge is
   irreversible and annotated `destructiveHint: true`.
4. **Never write to stdout.** This process speaks MCP JSON-RPC over stdout; a
   single stray byte corrupts the stream. Only `console.error` (stderr) is safe.
   `src/load-env.ts` uses `dotenv … { quiet: true }` for exactly this reason.
5. **Read `MISSIVE_API_TOKEN` lazily**, never at import time, so tests can run
   without it (`getApiToken()` in `src/missive-client.ts`).
6. **CommonJS build.** `tsconfig` is `module:"commonjs"`, `target:"ES2022"`, no
   `"type":"module"` in package.json. The reused `require("../package.json")`
   (version.ts) and `__dirname` (load-env.ts) depend on this.
7. **No `any`.** `@typescript-eslint/no-explicit-any` is enabled for `src/`.

## Architecture

```
src/
  index.ts            stdio entry: StdioServerTransport + server.instance.connect
  server.ts           createSdkMcpServer({...}); sets MCP `instructions` on the server
  server-instructions.ts  the usage guidance the client shows the model at connect
  load-env.ts         loads .env by absolute path (override:true, quiet:true)
  version.ts          single-source version (require package.json)
  missive-client.ts   fetch wrapper: auth, timeout, concurrency cap, 429 retry, result shaping
  tool-helpers.ts     jsonResult / errorResult / handle / resolve(Org|Team|Account|ContactBook) / defaultFromField
  query-helpers.ts    buildQuery / joinIds / validateBatchIds
  tool-registry.ts    allTools = [ every tool, in display order ]
  tools/*.ts          one file per Missive resource (+ help.ts)
  docs/               help content + the live tool-inventory renderer
```

**Request flow:** a tool handler calls `handle(() => missiveRequest(method, path, { query, body }))`.
`missiveRequest` adds auth, enforces a per-request timeout (distinguished from a
network error via an internal `timedOut` flag), gates concurrency with a
permit-leak-safe semaphore, and retries HTTP 429 honoring `Retry-After`. It returns
a `MissiveResult` (never throws for an API/network failure); `handle` maps it to the
MCP content result, or to an error result on `ok:false` / a thrown error.

## Conventions for tools

- Author with the SDK helper: `tool(name, description, zodShape, handler, { annotations })`.
- Handler body returns `handle(() => missiveRequest(...))`. The wrapped fn must
  return the **raw `MissiveResult`** (not `res.data`) so `handle` can see `ok:false`.
- **Build request bodies field-by-field** from validated zod args. Never
  `.passthrough()`, never spread an unchecked object, never add a raw/freeform
  body field — this is what makes "no external send" unbreakable.
- Cross-field rules the schema can't express (mutually-exclusive filters,
  one-body-object-per-PATCH-id, conditional `organization`) are enforced in-handler
  and return `errorResult(...)` before calling `handle`.
- **Annotations:** read tools → `readOnlyHint: true`; additive updates →
  `{ idempotentHint: true, destructiveHint: false }`; array-replacing updates
  (`update_contacts`, `update_responses`) → `destructiveHint: true`; additive
  creates → `destructiveHint: false`; consequential creates (`create_post`) and
  `merge` → `destructiveHint: true`.
- **Env-default resolvers** (in `tool-helpers.ts`): `resolveOrg`/`resolveContactBook`/
  `resolveAccount` throw if missing (required params); `optionalOrg`/`optionalTeam`/
  `optionalAccount` return `undefined` (optional filters); `defaultFromField()`
  builds a draft `from_field` from `MISSIVE_DEFAULT_FROM_ADDRESS`. Use the throwing
  ones only where the API truly requires the value.
- **Output:** return Missive's JSON verbatim (pretty-printed), wrapped by resource
  key. Don't unwrap.

## Adding a tool

1. Add it to the matching `src/tools/<resource>.ts` (create a file for a new resource).
2. Register the export in `src/tool-registry.ts` (display order).
3. Bump `EXPECTED_TOOL_COUNT` in `test/doc-tool-count.test.ts`, and add the tool to
   the README table and `docs/TOOLS.md` (the doc-rot tests scan both for the count
   and every tool name).
4. `npm run build && npm run lint && npm test`.

## Gotchas worth knowing

- **`ToolResult` is a `type`, not an `interface`** (`tool-helpers.ts`). TypeScript
  only gives a type alias the implicit index signature needed to satisfy the SDK's
  `CallToolResult`; an `interface` fails to compile across all tool files.
- **`docs/render-tools.ts` imports `tool-registry` in a cycle.** The top-level
  `import` is safe because `allTools` is read at call time; do not "fix" it into a
  bare `require("../tool-registry")` (the test runner can't resolve that path).
- **MCP `instructions` is set via a backing field** in `server.ts`
  (`createSdkMcpServer` exposes no option for it). A handshake test asserts it
  appears at `initialize`, so an SDK rename fails loudly.
- **zod-v4 → JSON Schema** drops numeric `min`/`max` and `.int()` from the
  published schema; the bounds are still enforced server-side and restated in each
  field's `describe()`. Don't be surprised the wire schema is laxer.

## Safety & scope

What's supported: read/organize conversations, contacts, tasks, labels, teams;
internal posts; conversation merge; saving drafts; custom-channel messages.
What's deliberately out: external send, deletes, analytics reports, webhooks, and
a few send-time options — see the "What's not included" section in the README.

## Rate limits

Missive: 5 concurrent / 300 per minute / 900 per 15 minutes. The client caps
concurrency at 4 and retries 429 with `Retry-After`. Prefer batch comma-id calls
for bulk reads.

## Commands

```bash
npm run dev     # ts-node, no build       npm run build   # tsc → dist/
npm run lint    # eslint (src only)        npm test        # vitest
npm run format  # prettier                 npm run setup   # validate token + list IDs
```

## Reference

- Design spec & rationale: `docs/superpowers/specs/2026-06-26-missive-mcp-design.md`
- Full tool reference: `docs/TOOLS.md`
- Live, in-assistant help: the `missive_help` tool.
