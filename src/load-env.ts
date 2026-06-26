import * as dotenv from "dotenv";
import { join } from "node:path";

/**
 * Options for loading the `.env` token store. Exported so the contract can be
 * asserted in tests (`test/load-env.test.ts`).
 *
 * - `path` — absolute, so the server's working directory is irrelevant. From
 *   `dist/load-env.js`, `../.env` resolves to the package root.
 * - `override: true` — `.env` is the single, authoritative home for the Missive
 *   token and optional defaults; it wins over any MISSIVE_* vars a launcher may
 *   have injected into the process, so there is nothing to keep in sync.
 * - `quiet: true` — load-bearing, NOT cosmetic. dotenv v17 prints an
 *   "injected env (N)" banner to stdout via `console.log`, and this process
 *   speaks the MCP JSON-RPC protocol over stdout. A single stray byte there
 *   corrupts the protocol stream, so the banner must be silenced. Do not remove.
 */
export const dotenvOptions = {
  path: join(__dirname, "..", ".env"),
  override: true,
  quiet: true,
};

// The Missive token lives in exactly one file — `.env`, next to this package.
// Loaded here, by absolute path, before anything else can read process.env.
dotenv.config(dotenvOptions);
