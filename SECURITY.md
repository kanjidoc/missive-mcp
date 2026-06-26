# Security Policy

## Supported versions

Security fixes are provided for the latest release.

## Reporting a vulnerability

Open an issue on [kanjidoc/missive-mcp](https://github.com/kanjidoc/missive-mcp/issues),
or contact the maintainer directly.

For sensitive reports, please do **not** include exploit details in a public issue —
open a minimal issue and request a private channel to share the details.

## Handling credentials

This server connects to a **live Missive account** with a personal access token.
That token can read and modify any account you can access in Missive (including
shared accounts). Treat it accordingly.

- `.env` holds your `MISSIVE_API_TOKEN` — the one file where the credential
  lives. `.env` is listed in `.gitignore`. **Never commit or share it**, and
  never paste its contents into issues, pull requests, or logs.
- The MCP launcher configs (`.mcp.json`, the Claude Desktop / Claude Code configs)
  carry only the start command — no token.
- If you suspect the token has leaked, revoke it in Missive (Preferences > API)
  and create a new one.

## Safety posture

This build is deliberately scoped to limit what an assistant can do irreversibly
to the outside world on a live account:

- It **never sends external email or SMS.** `missive_create_draft` saves a draft
  in Missive for a person to review and send — it exposes no `send` / `send_at` /
  `auto_followup` parameter.
- It has **no delete tools.**

Internal actions are allowed and act only within Missive: posting internal
comments (`missive_create_post`) and merging conversations
(`missive_merge_conversations`, which is irreversible). Neither emails anyone
outside your team. Keep these boundaries in mind before widening scope — see
CONTRIBUTING.md.
