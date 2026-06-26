import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

/**
 * Optional, private people/teams roster. Lets the model resolve names like
 * "assign this to Anj" or "route to TwoFabianos" to Missive user/team IDs with
 * ZERO tool calls, by injecting the IDs into the server `instructions` the client
 * (e.g. Claude Desktop) surfaces at connect time — see `buildInstructions` in
 * `server-instructions.ts`.
 *
 * The roster lives in `missive-roster.json` at the package root, NEXT TO `.env`,
 * and is GITIGNORED: it holds your org's real names + user IDs and this repo is
 * public. `missive-roster.example.json` (committed) documents the shape. Each
 * entry is a bare `name` + `id`, mirroring Missive > Settings > API > Resource IDs.
 */
const rosterEntrySchema = z.object({
  name: z.string().min(1),
  id: z.string().min(1),
});

const rosterSchema = z.object({
  users: z.array(rosterEntrySchema).default([]),
  teams: z.array(rosterEntrySchema).default([]),
});

export type Roster = z.infer<typeof rosterSchema>;

/** Absolute path to the roster file: package root, alongside `.env`. From
 * `dist/roster.js` (and from `src/roster.ts` under vitest) `../` is the root. */
const ROSTER_PATH = join(__dirname, "..", "missive-roster.json");

/**
 * Load the optional roster. Returns `undefined` when the feature is simply off
 * (no file) OR when the file is unusable (malformed JSON / wrong shape / empty),
 * so the server ALWAYS boots — a bad roster degrades to "no roster", never a
 * crash. A parse/shape problem is logged to STDERR only: this process speaks MCP
 * JSON-RPC over stdout, where a single stray byte corrupts the stream.
 *
 * `path` is injectable for tests; it defaults to the package-root file.
 */
export function loadRoster(path: string = ROSTER_PATH): Roster | undefined {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return undefined; // no roster file — feature off, nothing to log
  }
  try {
    const roster = rosterSchema.parse(JSON.parse(raw));
    if (roster.users.length === 0 && roster.teams.length === 0) return undefined;
    return roster;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[missive] Ignoring unusable missive-roster.json: ${message}`);
    return undefined;
  }
}

/**
 * Render the roster as a backtick-free text block to append to the instructions.
 * Backtick-free matches the `server-instructions.ts` convention (the text is read
 * by a model, where code formatting is unnecessary).
 */
export function renderRoster(roster: Roster): string {
  const lines: string[] = [
    "",
    "KNOWN PEOPLE & TEAMS (your private roster — use these IDs directly; no need to call missive_list_users / missive_list_teams):",
  ];
  if (roster.users.length > 0) {
    lines.push("Users — for add_assignees / add_users / @mentions:");
    for (const user of roster.users) lines.push(`- ${user.name} — ${user.id}`);
  }
  if (roster.teams.length > 0) {
    lines.push("Teams — for routing (the team param):");
    for (const team of roster.teams) lines.push(`- ${team.name} — ${team.id}`);
  }
  return lines.join("\n");
}
