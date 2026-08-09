# Roadmap — staged forward work

Work that is **decided-or-deferred but not started**. Three neighbours, so nothing
lands in the wrong place:

- **`CHANGELOG.md`** — what shipped. Its `## [Unreleased]` section is published verbatim
  by the release workflow, so nothing undecided goes there.
- **`docs/superpowers/specs/YYYY-MM-DD-*.md`** — design work, once there is a design.
- **this file** — the staging area in between: assessed exposure, recorded decisions, and
  the trigger that should reopen them.

Top item first.

---

## 1. MCP spec `2026-07-28` — assessed, migration deferred (blocked upstream)

**Status: blocked upstream. This is a recorded decision, not a backlog item.**
Nothing to do until a trigger below fires.

**Assessed:** 9 August 2026. **Upstream release:** 28 July 2026.
**Decision:** stay on MCP SDK **v1**. Do not migrate, do not run the codemod, do not
bump dependencies for this reason.

### 1.1 Why it is blocked, not merely deprioritised

The route to MCP v2 runs through `@anthropic-ai/claude-agent-sdk`, and that SDK is
hard-bound to MCP SDK **v1** at npm `latest` (`0.3.226`) by a declared peer dependency:

```json
"peerDependencies": { "@modelcontextprotocol/sdk": "^1.29.0" }
```

MCP v2 is not a newer version of `@modelcontextprotocol/sdk` — it is a **different set of
packages** (`@modelcontextprotocol/server`, `/client`, `/core`, all at `2.0.0`). A caret
range on `^1.29.0` can never resolve to any of them. There is no version bump that gets
there. `createSdkMcpServer` also still returns a config whose `instance: McpServer` is
imported from `@modelcontextprotocol/sdk/server/mcp.js` — v1's path — unchanged across
~130 releases from `0.2.97`.

Full evidence and reproduce-it commands:
`~/Documents/Cursor/artifacts/answer-agent-sdk-v1-coupling.md` (answered centrally for
this repo, FreshBooks-MCP, and the `api-to-mcp` skill). Independently re-verified here on
9 August 2026 against the published `0.3.226` tarball.

**Consequence:** "wait for the Agent SDK" has no end date and no announced signal. The
only self-directed path to v2 is dropping `createSdkMcpServer` and building on
`@modelcontextprotocol/server` directly — which touches this repo's stated tool-authoring
conventions, i.e. an architectural decision, not a mechanical one.

### 1.2 Why deferring is defensible here

This is a **local, single-user stdio server**. Compatibility is decided entirely by the
client's era: a *dual-era* or *legacy* client works fine against this legacy server; only a
**modern-only** client fails, and no such client exists yet.

Measured, not assumed — the installed Claude Desktop negotiates **`2025-11-25`** (a
pre-`2026-07-28`, `initialize`-based handshake). Across `~/Library/Logs/Claude/mcp.log`:
1829 handshakes at `2025-11-25`, 33 at `2025-06-18`, 37 at `2024-11-05`, and **zero** at
`2026-07-28`. Claude Code CLI is `2.1.226`.

Cost of being late: the server stops connecting until it's fixed. An afternoon, not an
outage.

### 1.3 Triggers — revisit when ANY of these fires

1. **The Agent SDK unblocks.** Its peer range stops being `^1.29.0`, or it gains a v2
   construction path. Check:
   `npm view @anthropic-ai/claude-agent-sdk peerDependencies`
2. **A client enters the modern era.** Any `"protocolVersion":"2026-07-28"` appears in
   `~/Library/Logs/Claude/mcp.log` or `~/Library/Logs/Claude/mcp-server-missive.log`.
   This is the trigger that actually matters. Check:
   `grep -o '"protocolVersion":"[^"]*"' ~/Library/Logs/Claude/mcp.log | sort -u`
3. **An end of v1 support is announced.** v1 (`@modelcontextprotocol/sdk`, latest `1.30.0`)
   is maintenance-only, with bug and security fixes guaranteed for **at least** six months
   after v2's release. Read that as a **floor, not an expiry**: it means support cannot end
   before roughly late January 2027 — it does **not** mean it ends then, and **no v1
   end-of-life date has been announced.** So this trigger is an announcement to watch for,
   not a date to diary. Do not treat late January 2027 as a deadline; if nothing has been
   announced by then, nothing has expired.
4. **The server stops connecting** from Claude Desktop or Claude Code.

### 1.4 Verified exposure (9 August 2026)

Baseline at time of assessment: `npm run build` ✅, `npm run lint` ✅, `npm test` ✅
(12 files, 69 tests). No files were changed by this assessment.

| Item | Status |
|---|---|
| Deprecated/removed MCP features in `src/` | **None.** Grep for sampling, roots, elicitation, MCP logging, `resources/subscribe`, `setLevel`, `ping`, `notifications/*` returns only `createMessage` in `src/tools/messages.ts` + `src/tool-registry.ts` — that is the **Missive API**'s message-create tool, unrelated to MCP's `sampling/createMessage`. Unaffected. |
| Error-code renumbering (`-32002` → `-32602`) | **Zero impact.** No `McpError`, `ErrorCode`, or numeric JSON-RPC code appears anywhere in `src/` — this server returns plain result objects via `tool-helpers.ts`. (Not checked by the intake briefing.) |
| stdio transport | **Survives.** Only HTTP+SSE is deprecated. `src/index.ts` and `src/mcp-config.ts` are unaffected. |
| Zod floor | **Already satisfied.** Declared `^4.3.6`, resolved `4.4.3`; v2 needs `≥4.2.0`. |
| v2 module format | **CJS available.** `@modelcontextprotocol/server@2.0.0` ships a `require` condition (`dist/*.cjs` + `.d.cts` types), so `module:"commonjs"`, `require("../package.json")` in `src/version.ts`, and `__dirname` in `src/load-env.ts` are likely survivable — worth confirming at migration time, not assuming. |
| `engines.node` | **Must rise.** Declares `>=18`; `@modelcontextprotocol/server@2.0.0` declares `>=20`. Local Node is `v22.16.0`, so this is a declaration change with no local tooling consequence. |
| Era-bound test | **One test, and it guards two era-bound things.** `test/server-instructions.test.ts` drives a real `initialize` over `InMemoryTransport` and asserts (a) `client.getInstructions()` starts with `MISSIVE_INSTRUCTIONS`, (b) `client.getServerVersion()` carries `title: "Missive"` + one base64 PNG icon, (c) 36 tools. Under the new spec `initialize` does not exist and `serverInfo` moves to `_meta['io.modelcontextprotocol/serverInfo']` on every response. Needs rewriting, not patching. It is the only test that touches the protocol. |
| Private-backing-field hacks in `src/server.ts` | **Two, not one.** `_instructions` **and** `_serverInfo` (sets `title` + `icons`, via `src/server-icon.ts`). The intake briefing only knew about `_instructions`; the second was added afterwards and is exposed the same way. |

**Corrections to the intake briefing's §2** (`^` ranges floated since it was written):

- Installed Agent SDK is **`0.2.141`**, not `0.2.97` (that is the declared floor, `^0.2.97`).
- Installed MCP SDK is **`1.29.0`**, not `1.27.1` (declared floor `^1.27.1`).
- `src/server.ts` carries two backing-field hacks, not one (above).

**Precision on the peer-range note.** The claim "`^1.27.1` doesn't satisfy `^1.29.0`" needs
care: npm checks peers against the **resolved** version, and this tree already resolves
`1.29.0`, which satisfies it. So an Agent SDK bump would not error here today. The problem
is that the **declared floor understates the real requirement** — a fresh install or a
lockfile resolving to `1.27.x` would violate the peer range. Raise the declared floor to
`^1.29.0` (or `^1.30.0`) *as part of* any Agent SDK bump, not as a separate change.

### 1.5 Open decisions — still open, deliberately

1. **Wait, or decouple?** With the Agent SDK blocked indefinitely, "wait" has no end date.
   Decoupling onto `@modelcontextprotocol/server` is the only self-directed route, and it
   touches all 36 tools' authoring pattern plus the conventions written down in
   `CLAUDE.md`. **Not decided.** The recorded decision is only *"not now"*.
2. **How much of the Agent SDK's `tool()` helper survives?** The coupling is specifically
   the *server construction* path, but `tool()` produces definitions typed against v1's
   `CallToolResult` / `ToolAnnotations`. How much survives a move to v2's
   `registerTool(name, {description, inputSchema}, handler)` is unscoped — worth measuring
   before choosing a route, not assuming either way.
3. **What replaces the handshake test?** The property to preserve is *loud failure on
   silent SDK contract drift* — it exists to catch instructions/serverInfo being dropped,
   not to test the SDK. Under the new spec the equivalent probe is `server/discover` plus
   asserting `_meta['io.modelcontextprotocol/serverInfo']` on an ordinary response.
4. **Do `ttlMs` / `cacheScope` matter here?** Probably **not a repo-level decision at this
   layer** — those are `tools/list` response fields emitted by the server library, not
   something tool authors set. It only becomes a real choice if this repo decouples and
   owns the list handler. 36 tools is a meaningful manifest, so revisit then.

### 1.6 What the next session should do first

Nothing in this section is urgent. In order:

1. **Re-check trigger 2** (`grep` the Claude logs for `2026-07-28`). If it is still absent,
   the decision above stands and there is nothing further to do.
2. If a trigger has fired: **scope open decision 1.5.2 first** — how much of the `tool()`
   authoring pattern survives — because that number, not the spec text, decides whether
   decoupling is an afternoon or a rewrite.
3. Only then write the spec, per convention in `docs/superpowers/specs/YYYY-MM-DD-*.md`
   (`superpowers:brainstorming` is the intended route in). **This file is that spec's
   input, not a substitute for it.**

### 1.7 Sources

- Release post — <https://blog.modelcontextprotocol.io/posts/2026-07-28/>
- Changelog — <https://modelcontextprotocol.io/specification/2026-07-28/changelog>
- Era matrix / lifecycle — <https://modelcontextprotocol.io/specification/2026-07-28/basic/lifecycle>
- stdio backwards-compatibility probe — <https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio>
- TS SDK v1→v2 upgrade guide — <https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2.html>
- Agent SDK coupling evidence — `~/Documents/Cursor/artifacts/answer-agent-sdk-v1-coupling.md`
- Intake briefing this section was produced from — `~/Documents/Cursor/artifacts/mcp-2026-07-28-handoff-missive-mcp.md`

---

## 2. Unblocked today, independent of §1 — Agent SDK `0.3.x` bump

Not part of the MCP v2 question, and **not yet done**. Recorded here so it isn't
rediscovered later.

`CreateSdkMcpServerOptions` in Agent SDK `0.3.226` gained a first-class option the
installed `0.2.141` does not have:

```ts
instructions?: string;   // "Server instructions returned from `initialize` and
                         //  surfaced to the model as an MCP instructions block"
```

That makes the `_instructions` private-backing-field hack in `src/server.ts` **removable** —
`createSdkMcpServer({ ..., instructions: buildInstructions(loadRoster()) })` becomes
supported API. Worth doing on its own merits; it deletes a documented workaround and a
comment block.

Caveats, so this is priced honestly:

- **The `_serverInfo` hack survives.** `0.3.226` still offers no option for `title` or
  `icons`, so that second backing-field assignment stays, along with the handshake test
  that guards it.
- **`CLAUDE.md` is correct as written today.** Its gotcha note — "`createSdkMcpServer`
  exposes no option for MCP `instructions`" — is true of the *installed* `0.2.141`. It
  becomes false only once the SDK is bumped; update it in the same change, not before.
- **Bump the MCP SDK floor in the same commit** (see the precision note in §1.4): Agent
  SDK `0.3.x` peers on `@modelcontextprotocol/sdk@^1.29.0`, while this repo declares
  `^1.27.1`. One coordinated dependency change, not two.
- Agent SDK `0.3.226` still declares `engines.node >= 18.0.0`, so this bump does **not**
  force the Node floor up. That is a §1 concern only.
