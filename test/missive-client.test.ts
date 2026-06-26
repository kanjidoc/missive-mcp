import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { missiveRequest, Semaphore } from "../src/missive-client";

function makeResponse(status: number, body: string, headers: Record<string, string> = {}): Response {
  return {
    status,
    headers: {
      get: (name: string) => headers[name] ?? headers[name.toLowerCase()] ?? null,
    },
    text: async () => body,
  } as unknown as Response;
}

describe("missiveRequest", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.MISSIVE_API_TOKEN = "missive_pat-test";
  });
  afterEach(() => {
    process.env = { ...saved };
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("throws a clear error when the token is missing", async () => {
    delete process.env.MISSIVE_API_TOKEN;
    await expect(missiveRequest("GET", "/contacts")).rejects.toThrow(/MISSIVE_API_TOKEN/);
  });

  it("builds the URL+query, sets auth + json body, and parses a 200", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse(200, JSON.stringify({ drafts: { id: "1" } })));
    vi.stubGlobal("fetch", fetchMock);

    const res = await missiveRequest("POST", "/drafts", {
      query: { team: "t1", inbox: true },
      body: { drafts: { subject: "Hi" } },
    });

    expect(res).toEqual({ ok: true, status: 200, data: { drafts: { id: "1" } } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://public.missiveapp.com/v1/drafts?team=t1&inbox=true");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer missive_pat-test");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ drafts: { subject: "Hi" } }));
  });

  it("omits the body + Content-Type on a GET", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse(200, "{}"));
    vi.stubGlobal("fetch", fetchMock);

    await missiveRequest("GET", "/users");
    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBeUndefined();
    expect(init.headers["Content-Type"]).toBeUndefined();
  });

  it("treats an empty 2xx body as {}", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeResponse(201, "")));
    const res = await missiveRequest("POST", "/posts", { body: { posts: {} } });
    expect(res).toEqual({ ok: true, status: 201, data: {} });
  });

  it("returns raw text when a 2xx body is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeResponse(200, "<html>ok</html>")));
    const res = await missiveRequest("GET", "/x");
    expect(res).toEqual({ ok: true, status: 200, data: "<html>ok</html>" });
  });

  it("extracts a JSON error message from a non-2xx body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeResponse(404, JSON.stringify({ errors: "Not found" }))));
    const res = await missiveRequest("GET", "/contacts/zzz");
    expect(res).toEqual({ ok: false, status: 404, error: "Not found" });
  });

  it("falls back to raw text for a non-JSON error body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeResponse(500, "upstream boom")));
    const res = await missiveRequest("GET", "/x");
    expect(res).toEqual({ ok: false, status: 500, error: "upstream boom" });
  });

  it("distinguishes a timeout from a network error", async () => {
    // fetch never resolves but honors the abort signal.
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
      ),
    );
    const res = await missiveRequest("GET", "/slow", { timeoutMs: 15 });
    expect(res).toEqual({ ok: false, status: 0, error: "request timed out after 15ms" });
  });

  it("shapes a pre-response network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const res = await missiveRequest("GET", "/x");
    expect(res).toEqual({ ok: false, status: 0, error: "ECONNREFUSED" });
  });

  it("retries on 429 honoring Retry-After, then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeResponse(429, "rate limited", { "Retry-After": "0" }))
      .mockResolvedValueOnce(makeResponse(200, JSON.stringify({ ok: 1 })));
    vi.stubGlobal("fetch", fetchMock);

    const res = await missiveRequest("GET", "/x");
    expect(res).toEqual({ ok: true, status: 200, data: { ok: 1 } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces the 429 after exhausting retries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse(429, "rate limited", { "Retry-After": "0" }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await missiveRequest("GET", "/x");
    expect(res.ok).toBe(false);
    expect(res.status).toBe(429);
    // 1 initial + 2 retries
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("Semaphore", () => {
  it("grants up to max permits then queues, in FIFO order", async () => {
    const s = new Semaphore(2);
    const r1 = await s.acquire();
    const r2 = await s.acquire();
    expect(s.activeCount).toBe(2);

    let third = false;
    const p3 = s.acquire().then((r) => {
      third = true;
      return r;
    });
    await Promise.resolve();
    expect(third).toBe(false); // queued behind the two held permits

    r1();
    const r3 = await p3;
    expect(third).toBe(true);
    expect(s.activeCount).toBe(2);

    r2();
    r3();
    expect(s.activeCount).toBe(0);
  });

  it("release is idempotent — no permit leak, never goes negative", async () => {
    const s = new Semaphore(1);
    const r = await s.acquire();
    r();
    r();
    r();
    expect(s.activeCount).toBe(0);
    // A fresh acquire still works, proving the single permit was not lost.
    const r2 = await s.acquire();
    expect(s.activeCount).toBe(1);
    r2();
    expect(s.activeCount).toBe(0);
  });
});
