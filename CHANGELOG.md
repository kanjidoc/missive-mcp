# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and this project adheres to
[Semantic Versioning](https://semver.org/). Each released version has its own
`## [x.y.z]` section; the release workflow publishes that section's notes.

## [Unreleased]

_Nothing yet._

## [0.1.0] - 2026-06-26

Initial release — a Model Context Protocol server exposing the Missive REST API
to AI assistants in Claude Desktop and Claude Code.

### Tools (36, all prefixed `missive_`)

- **Contacts** — list, get, create, update (with full `infos`/`memberships`).
- **Contact books & groups** — list contact books; list groups/organizations.
- **Conversations** — list (with required mailbox filter), get, update (close /
  reopen / assign / label / move / rename), **merge**, and list a conversation's
  messages / comments / drafts / posts.
- **Messages** — get (single or batched by id), find by RFC `Message-ID`, and
  create an incoming custom-channel message.
- **Drafts** — create a draft (email/SMS/custom-channel) with attachments,
  recipients, threading, labels, and routing. Saved for review — never sent.
- **Posts** — create an internal comment/note in a conversation.
- **Shared labels** — list, create, update.
- **Teams** — list, create, update.
- **Users / Organizations** — list.
- **Responses (canned replies)** — list, get, create, update.
- **Tasks** — list (with `until` cursor + filters), get, create, update.
- **Self-documentation** — `missive_help` with topics including `usage`, `tools`,
  and `safety`.

### Safety model

- **No external send.** `missive_create_draft` saves a draft for a human to
  send; the `send` / `send_at` / `auto_followup` parameters are intentionally not
  exposed, enforced by a regression test.
- **No delete tools.**
- **Internal posting and conversation merge are supported** — they act only
  within Missive and never email anyone outside the team. Merge is marked
  irreversible.
- Tool annotations advertise read-only / idempotent / destructive intent so MCP
  clients can gate confirmation appropriately.

### Authentication & configuration

- Static personal-access-token auth loaded from `.env`; the token never appears
  in any launcher config.
- Optional defaults to avoid repeating IDs: `MISSIVE_DEFAULT_ORGANIZATION`,
  `MISSIVE_DEFAULT_CONTACT_BOOK`, `MISSIVE_DEFAULT_TEAM`,
  `MISSIVE_DEFAULT_FROM_ADDRESS` (+ `MISSIVE_DEFAULT_FROM_NAME`), and
  `MISSIVE_DEFAULT_ACCOUNT`.
- `npm run setup` validates the token and prints your organizations, contact
  books, teams, and users, plus a ready-to-paste launcher config.

### Architecture

- A hand-written `fetch` client with a concurrency cap, HTTP-429 retry honoring
  `Retry-After`, a per-request timeout distinguished from network errors, and
  uniform result shaping.
- MCP `instructions` surfaced to the client at connect time, so the assistant
  learns the API's rules and recipes up front.

### Docs & tests

- README, a friendly step-by-step `SETUP.md`, a complete `docs/TOOLS.md` tool
  reference, `CLAUDE.md`, `CONTRIBUTING.md`, and `SECURITY.md`.
- A vitest suite covering the HTTP client (including the rate-limit semaphore and
  timeout handling), the helpers, the live MCP handshake, handler validation, and
  the no-send guarantee, plus doc-rot guards that keep the tool count in sync.
- GitHub Actions for CI and releases.
