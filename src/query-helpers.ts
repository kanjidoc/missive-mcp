/**
 * Query-string and batch-id helpers shared by every tool and the HTTP client.
 * Kept dependency-free and pure so they are trivially unit-testable.
 */

export type QueryValue = string | number | boolean | undefined | null;

/**
 * Build a URL query string from a flat params object.
 * - `undefined` / `null` values are dropped (so optional params simply vanish).
 * - booleans serialize as `"true"` / `"false"` (Missive's expected form).
 * - numbers are stringified.
 * Returns `""` when no params survive, else a string beginning with `?`.
 */
export function buildQuery(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    search.append(key, typeof value === "boolean" ? (value ? "true" : "false") : String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

/**
 * Join resource IDs into the comma-separated path segment Missive uses for
 * batch GET/PATCH endpoints (e.g. `/v1/contacts/:id1,:id2`). Trims blanks.
 */
export function joinIds(ids: string[]): string {
  return ids
    .map((id) => id.trim())
    .filter((id) => id.length > 0)
    .join(",");
}

/**
 * Validate a batch-PATCH request: the body must contain exactly one object per
 * URL id, and every object must carry its own `id` that appears in the URL list.
 * Returns an error message string if invalid, or `null` if everything lines up.
 *
 * Used by all comma-id update tools (contacts, conversations, shared labels,
 * teams, responses) so the alignment rule is enforced in exactly one place.
 */
export function validateBatchIds(ids: string[], items: Array<{ id?: string }>): string | null {
  const cleanIds = ids.map((id) => id.trim()).filter((id) => id.length > 0);
  if (cleanIds.length === 0) return "At least one id is required.";
  if (items.length !== cleanIds.length) {
    return `The body must contain exactly one object per id: got ${items.length} object(s) for ${cleanIds.length} id(s).`;
  }
  for (const item of items) {
    if (!item.id) return "Every object in the body must include its own 'id'.";
    if (!cleanIds.includes(item.id)) {
      return `Object id '${item.id}' is not present in the URL id list (${cleanIds.join(", ")}).`;
    }
  }
  return null;
}
