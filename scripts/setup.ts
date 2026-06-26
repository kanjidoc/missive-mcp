// scripts/setup.ts — validate the Missive token and help fill in .env defaults.
//
// Unlike the OAuth reference this project was modeled on, there is no token
// exchange: Missive uses a static personal access token. This script just
// confirms the token works, lists the resource IDs you might want as defaults
// (organizations, contact books, teams, users), and prints a launcher config.
//
// Run with: npm run setup
import "../src/load-env";
import { resolve } from "node:path";
import { missiveRequest, type MissiveResult } from "../src/missive-client";
import { buildClaudeServerConfig, buildClaudeCodeServerJson } from "../src/mcp-config";

type Named = { id?: string; name?: string; email?: string };

function printList(key: string, result: MissiveResult<Record<string, Named[]>>): void {
  if (!result.ok) {
    console.log(`  (could not load: Missive error ${result.status}: ${result.error})`);
    return;
  }
  const items = (result.data?.[key] ?? []) as Named[];
  if (items.length === 0) {
    console.log("  (none found)");
    return;
  }
  for (const item of items) {
    const extra = item.email ? ` <${item.email}>` : "";
    console.log(`  ${item.id}  ${item.name ?? ""}${extra}`);
  }
}

async function main(): Promise<void> {
  const token = process.env.MISSIVE_API_TOKEN;
  if (!token) {
    console.error("MISSIVE_API_TOKEN is not set.");
    console.error(
      "Copy .env.example to .env and paste your token (Missive > Preferences > API > Create a new token).",
    );
    process.exit(1);
  }

  console.log("Validating your Missive API token...\n");
  const users = await missiveRequest<Record<string, Named[]>>("GET", "/users");
  if (!users.ok) {
    console.error(`Token check FAILED — Missive error (${users.status}): ${users.error}`);
    console.error("Confirm the token is valid and your organization is on the Productive plan.");
    process.exit(1);
  }
  console.log("✓ Token works.\n");

  const [orgs, books, teams] = await Promise.all([
    missiveRequest<Record<string, Named[]>>("GET", "/organizations"),
    missiveRequest<Record<string, Named[]>>("GET", "/contact_books"),
    missiveRequest<Record<string, Named[]>>("GET", "/teams"),
  ]);

  console.log("Organizations  (set one as MISSIVE_DEFAULT_ORGANIZATION in .env):");
  printList("organizations", orgs);
  console.log("\nContact books  (set one as MISSIVE_DEFAULT_CONTACT_BOOK in .env):");
  printList("contact_books", books);
  console.log("\nTeams:");
  printList("teams", teams);
  console.log("\nUsers:");
  printList("users", users);

  const projectDir = resolve(__dirname, "..");
  console.log("\n--- Claude Desktop: merge into claude_desktop_config.json ---");
  console.log(JSON.stringify({ mcpServers: { missive: buildClaudeServerConfig(projectDir) } }, null, 2));
  console.log("\n--- Claude Code: run this ---");
  console.log(`claude mcp add-json missive '${JSON.stringify(buildClaudeCodeServerJson(projectDir))}'`);
  console.log("\nRun `npm run build` before launching the server.");
}

main().catch((err) => {
  console.error("setup failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
