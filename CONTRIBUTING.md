# Contributing

Thanks for your interest in improving Missive MCP. This is a small project — bug
reports, fixes, and new tools are all welcome.

## Setup

Requires Node.js 18 or newer.

```bash
git clone https://github.com/kanjidoc/missive-mcp.git
cd missive-mcp
npm install
cp .env.example .env      # then paste your Missive personal access token
npm run setup             # validates the token + lists resource IDs for .env
npm run build
```

`npm run setup` confirms your token works and prints your organizations, contact
books, teams, and users so you can fill the optional `MISSIVE_DEFAULT_*` defaults.

## Dev scripts

```bash
npm run dev       # run the server with ts-node (no build step)
npm run lint      # ESLint
npm run format    # Prettier
npm test          # test suite (vitest)
npm run build     # compile to dist/ — run this before opening a PR
```

## Adding a new tool

1. Define the tool with the `tool()` helper in the relevant
   `src/tools/<resource>.ts` file (create a new file for a new resource).
2. In the handler, call `handle(() => missiveRequest(method, path, { query, body }))`.
   Build the request `body` field-by-field from validated zod args — never spread
   an unchecked object, and never add a passthrough/raw-body field.
3. Register the export in `src/tool-registry.ts` (in display order).
4. Bump the expected count in `test/doc-tool-count.test.ts` and update the README.
5. Run `npm run build && npm run lint && npm test`.

The `missive_help` tool has an "extending" topic that walks through this in
detail. Two hard rules worth repeating: handlers must never throw to the client
(use `handle`), and the server must never write to stdout (it carries the MCP
JSON-RPC stream).

### Safety boundaries (do not regress)

Two boundaries keep an assistant from causing irreversible external harm:

1. **No external send.** Sending an email/SMS in Missive is the
   `send`/`send_at`/`auto_followup` flags on the drafts endpoint —
   `missive_create_draft` must never expose or set them. Drafts are always saved
   for a human to send. There is a regression test (`test/tools.test.ts`) that
   asserts the draft body never contains those keys; keep it passing.
2. **No delete tools.**

Internal posts (`missive_create_post`) and conversation merge
(`missive_merge_conversations`) are intentionally allowed — they act only within
Missive and email no one outside. Keep new tools within these boundaries unless
the project owner decides otherwise.

## Commits and pull requests

- Branch off `main` for your work.
- Use prefixed commit messages: `fix:`, `feat:`, `docs:`, `chore:` — one logical
  change per commit.
- Run `npm run build`, `npm run lint`, and `npm test` before pushing.
- Open a PR against `main` describing what changed and why. If you added or fixed
  a tool, note how you verified it.
