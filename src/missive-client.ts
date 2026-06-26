import { buildQuery, type QueryValue } from "./query-helpers";

/**
 * Thin HTTP client for the Missive REST API.
 *
 * Missive uses a static personal access token (no OAuth refresh), so this is
 * deliberately small: build the request, send it with `fetch`, and shape the
 * outcome into a `MissiveResult`. Tool handlers never see a thrown error for an
 * API failure — they inspect `result.ok` (see `tool-helpers.ts#handle`).
 *
 * Cross-cutting concerns handled here, once, for every tool:
 *  - Bearer auth (token read lazily, per-call, so tests can stub the env var).
 *  - A hard per-request timeout via `AbortController`, distinguished from a
 *    genuine network error.
 *  - Rate limiting: a process-wide concurrency cap (semaphore) plus reactive
 *    retry on HTTP 429 honoring `Retry-After`.
 */

const BASE_URL = "https://public.missiveapp.com/v1";
const DEFAULT_TIMEOUT_MS = 30_000;

/** Missive allows 5 concurrent requests; stay one under to leave headroom. */
const MAX_CONCURRENT = 4;
/** Retries are only for 429 (the request was rejected, never processed). */
const MAX_RETRIES = 2;
/** Cap any single Retry-After wait so a pathological header can't hang a tool. */
const MAX_RETRY_WAIT_MS = 60_000;

export type MissiveResult<T = unknown> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string };

export interface RequestOptions {
  /** Query-string params; `undefined`/`null` are dropped, booleans → "true"/"false". */
  query?: Record<string, QueryValue>;
  /** Request body; JSON-serialized, with `Content-Type: application/json`. */
  body?: unknown;
  /** Per-request timeout; defaults to 30s. */
  timeoutMs?: number;
}

// No "DELETE": this server exposes no delete tools (a safety guarantee). Leaving
// DELETE out of the union makes any future delete call site a compile error.
export type HttpMethod = "GET" | "POST" | "PATCH";

/**
 * A counting semaphore using a drain loop. `acquire()` resolves once a permit
 * is free and returns a single-use `release`. Permits are granted in FIFO order.
 *
 * The release is idempotent (double-call is a no-op) and callers MUST invoke it
 * in a `finally`, so a throw/abort inside the critical section can never leak a
 * permit — otherwise effective concurrency would silently decay toward zero and
 * the server would eventually stall. Exported for direct unit testing.
 */
export class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly max: number) {}

  /** Current number of held permits — exposed for tests/introspection only. */
  get activeCount(): number {
    return this.active;
  }

  async acquire(): Promise<() => void> {
    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
      this.drain();
    });
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      this.drain();
    };
  }

  private drain(): void {
    while (this.active < this.max && this.waiters.length > 0) {
      this.active += 1;
      const resolve = this.waiters.shift()!;
      resolve();
    }
  }
}

const semaphore = new Semaphore(MAX_CONCURRENT);

/** Read the API token lazily so importing this module never requires it (tests). */
function getApiToken(): string {
  const token = process.env.MISSIVE_API_TOKEN;
  if (!token) {
    throw new Error(
      "MISSIVE_API_TOKEN is not set. Add it to .env (Missive > Preferences > API > Create a new token).",
    );
  }
  return token;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Parse a `Retry-After` header (seconds) into milliseconds; null if absent/invalid. */
function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(seconds * 1000, MAX_RETRY_WAIT_MS);
}

/** Best-effort extraction of a human-readable message from an error response body. */
function extractError(text: string, fallback: string): string {
  if (!text) return fallback || "Unknown error";
  try {
    const parsed = JSON.parse(text);
    // Missive errors look like { "errors": "message" } or { "message": "..." }.
    if (parsed && typeof parsed === "object") {
      const candidate =
        (parsed as Record<string, unknown>).errors ??
        (parsed as Record<string, unknown>).error ??
        (parsed as Record<string, unknown>).message;
      if (typeof candidate === "string" && candidate) return candidate;
    }
    return text;
  } catch {
    return text;
  }
}

/** Parse a 2xx body; tolerates an empty body (→ {}) and a non-JSON body (→ raw text). */
function parseSuccessBody<T>(text: string): T {
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

interface AttemptOutcome<T> {
  result: MissiveResult<T>;
  /** Present only on a 429 — how long to wait before retrying. */
  retryAfterMs: number | null;
}

/** A single HTTP attempt. Never throws — always resolves to an AttemptOutcome. */
async function fetchOnce<T>(
  method: HttpMethod,
  url: string,
  token: string,
  body: unknown,
  timeoutMs: number,
): Promise<AttemptOutcome<T>> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    };
    let payload: string | undefined;
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }

    const response = await fetch(url, { method, headers, body: payload, signal: controller.signal });
    const text = await response.text();
    const retryAfterMs =
      response.status === 429 ? parseRetryAfterMs(response.headers.get("Retry-After")) : null;

    if (response.status >= 200 && response.status < 300) {
      return { result: { ok: true, status: response.status, data: parseSuccessBody<T>(text) }, retryAfterMs };
    }
    return {
      result: { ok: false, status: response.status, error: extractError(text, response.statusText) },
      retryAfterMs,
    };
  } catch (err) {
    const result: MissiveResult<T> = timedOut
      ? { ok: false, status: 0, error: `request timed out after ${timeoutMs}ms` }
      : { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
    return { result, retryAfterMs: null };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Make a request to the Missive API.
 *
 * @param method HTTP method.
 * @param path   Path beginning with `/`, relative to `https://public.missiveapp.com/v1`.
 * @param opts   `query`, `body`, and optional `timeoutMs`.
 * @returns      A `MissiveResult` — never throws for an HTTP/network failure
 *               (it does throw if `MISSIVE_API_TOKEN` is unset, which `handle`
 *               turns into an error result).
 */
export async function missiveRequest<T = unknown>(
  method: HttpMethod,
  path: string,
  opts: RequestOptions = {},
): Promise<MissiveResult<T>> {
  const token = getApiToken();
  const url = `${BASE_URL}${path}${buildQuery(opts.query ?? {})}`;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Hold a permit for the whole request lifetime, INCLUDING any Retry-After
  // waits, so 429s create back-pressure rather than a retry stampede.
  const release = await semaphore.acquire();
  try {
    let attempt = 0;
    for (;;) {
      const { result, retryAfterMs } = await fetchOnce<T>(method, url, token, opts.body, timeoutMs);
      if (result.ok || result.status !== 429 || attempt >= MAX_RETRIES) {
        return result;
      }
      attempt += 1;
      // Honor Retry-After; fall back to a capped exponential backoff if absent.
      const waitMs = retryAfterMs ?? Math.min(1000 * 2 ** attempt, MAX_RETRY_WAIT_MS);
      await sleep(waitMs);
    }
  } finally {
    release();
  }
}
