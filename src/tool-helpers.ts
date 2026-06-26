import type { MissiveResult } from "./missive-client";

/**
 * Shared tool-handler helpers. Every tool returns the MCP content shape below;
 * `handle` removes the repeated try/catch + ok-check boilerplate so each tool
 * file stays focused on building its request.
 */

// A `type` alias (not an `interface`) on purpose: TypeScript only synthesizes an
// implicit index signature for type aliases, so this stays assignable to the
// SDK's `CallToolResult` return type (which carries `[x: string]: unknown`).
export type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

/** Wrap a successful payload as pretty-printed JSON text. */
export function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

/** Wrap an error message as an MCP error result. */
export function errorResult(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * Run a tool body that returns a `MissiveResult` and map it to a `ToolResult`:
 *  - `ok: true`  → pretty-printed JSON of the data.
 *  - `ok: false` → an error result `Missive error (<status>): <error>`.
 *  - a thrown error (e.g. missing token, failed pre-flight validation) → error result.
 *
 * The wrapped fn MUST return the raw `MissiveResult` (not `res.data`), otherwise
 * the `ok:false` branch can never be reached and failures would look like success.
 */
export async function handle<T>(fn: () => Promise<MissiveResult<T>>): Promise<ToolResult> {
  try {
    const res = await fn();
    return res.ok
      ? jsonResult(res.data)
      : errorResult(`Missive error (${res.status}): ${res.error}`);
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Return the first value that is present and non-blank. Crucially, an env var set
 * to an empty string (the common `KEY=` case in a .env template) is treated as
 * ABSENT — otherwise an empty default would leak into a request as `organization=`
 * and the API would reject it (`'organization' must be a UUID`).
 */
function firstPresent(...values: (string | undefined)[]): string | undefined {
  for (const value of values) {
    if (value != null && value.trim() !== "") return value;
  }
  return undefined;
}

/**
 * Resolve a REQUIRED `organization` id: the explicit arg, else
 * `MISSIVE_DEFAULT_ORGANIZATION`, else throw a clear error (caught by `handle`).
 */
export function resolveOrg(arg?: string): string {
  const value = firstPresent(arg, process.env.MISSIVE_DEFAULT_ORGANIZATION);
  if (!value) {
    throw new Error(
      "organization is required: pass `organization` explicitly or set MISSIVE_DEFAULT_ORGANIZATION in .env.",
    );
  }
  return value;
}

/**
 * Resolve an OPTIONAL `organization` filter: the explicit arg, else the env
 * default, else `undefined` (so the caller omits the param entirely and the API
 * lists across all accessible organizations). Never throws.
 */
export function optionalOrg(arg?: string): string | undefined {
  return firstPresent(arg, process.env.MISSIVE_DEFAULT_ORGANIZATION);
}

/**
 * Resolve a REQUIRED `contact_book` id: the explicit arg, else
 * `MISSIVE_DEFAULT_CONTACT_BOOK`, else throw a clear error (caught by `handle`).
 */
export function resolveContactBook(arg?: string): string {
  const value = firstPresent(arg, process.env.MISSIVE_DEFAULT_CONTACT_BOOK);
  if (!value) {
    throw new Error(
      "contact_book is required: pass `contact_book` explicitly or set MISSIVE_DEFAULT_CONTACT_BOOK in .env.",
    );
  }
  return value;
}

/**
 * Resolve an OPTIONAL `team` id: the explicit arg, else `MISSIVE_DEFAULT_TEAM`,
 * else `undefined` (so the field is omitted). Lets a single-team workspace route
 * new conversations without passing `team` every time. Never throws.
 */
export function optionalTeam(arg?: string): string | undefined {
  return firstPresent(arg, process.env.MISSIVE_DEFAULT_TEAM);
}

/**
 * Resolve an OPTIONAL custom-channel `account` id: the explicit arg, else
 * `MISSIVE_DEFAULT_ACCOUNT`, else `undefined`. Never throws.
 */
export function optionalAccount(arg?: string): string | undefined {
  return firstPresent(arg, process.env.MISSIVE_DEFAULT_ACCOUNT);
}

/**
 * Resolve a REQUIRED custom-channel `account` id: arg, else
 * `MISSIVE_DEFAULT_ACCOUNT`, else throw a clear error (caught by `handle`).
 */
export function resolveAccount(arg?: string): string {
  const value = firstPresent(arg, process.env.MISSIVE_DEFAULT_ACCOUNT);
  if (!value) {
    throw new Error(
      "account is required: pass `account` explicitly or set MISSIVE_DEFAULT_ACCOUNT in .env.",
    );
  }
  return value;
}

/**
 * Default email `from_field` for drafts, taken from the environment, used when a
 * draft omits `from_field`. Returns `{ address, name? }` when
 * `MISSIVE_DEFAULT_FROM_ADDRESS` is set (and non-blank), otherwise `undefined`.
 * The address must be one of your Missive aliases (find it in Settings > API >
 * Resource IDs > Accounts). This only sets who a draft is *from* — it never sends.
 */
export function defaultFromField(): { address: string; name?: string } | undefined {
  const address = firstPresent(process.env.MISSIVE_DEFAULT_FROM_ADDRESS);
  if (!address) return undefined;
  const name = firstPresent(process.env.MISSIVE_DEFAULT_FROM_NAME);
  return name ? { address, name } : { address };
}
