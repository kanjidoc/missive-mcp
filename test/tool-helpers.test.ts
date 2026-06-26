import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  jsonResult,
  errorResult,
  handle,
  resolveOrg,
  optionalOrg,
  resolveContactBook,
} from "../src/tool-helpers";

describe("jsonResult / errorResult", () => {
  it("pretty-prints data as text content", () => {
    expect(jsonResult({ a: 1 })).toEqual({
      content: [{ type: "text", text: JSON.stringify({ a: 1 }, null, 2) }],
    });
  });

  it("marks errors with isError", () => {
    expect(errorResult("boom")).toEqual({
      content: [{ type: "text", text: "boom" }],
      isError: true,
    });
  });
});

describe("handle", () => {
  it("maps ok:true to a json result", async () => {
    const res = await handle(async () => ({ ok: true, status: 200, data: { x: 1 } }));
    expect(res).toEqual(jsonResult({ x: 1 }));
  });

  it("maps ok:false to a formatted error result", async () => {
    const res = await handle(async () => ({ ok: false, status: 404, error: "Not found" }));
    expect(res).toEqual(errorResult("Missive error (404): Not found"));
  });

  it("catches a thrown error", async () => {
    const res = await handle(async () => {
      throw new Error("missing token");
    });
    expect(res).toEqual(errorResult("missing token"));
  });
});

describe("org / contact_book resolvers", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.MISSIVE_DEFAULT_ORGANIZATION;
    delete process.env.MISSIVE_DEFAULT_CONTACT_BOOK;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("resolveOrg prefers the arg, then env, else throws", () => {
    expect(resolveOrg("explicit")).toBe("explicit");
    process.env.MISSIVE_DEFAULT_ORGANIZATION = "env-org";
    expect(resolveOrg()).toBe("env-org");
    delete process.env.MISSIVE_DEFAULT_ORGANIZATION;
    expect(() => resolveOrg()).toThrow(/organization is required/i);
  });

  it("optionalOrg returns undefined instead of throwing", () => {
    expect(optionalOrg()).toBeUndefined();
    expect(optionalOrg("x")).toBe("x");
    process.env.MISSIVE_DEFAULT_ORGANIZATION = "env-org";
    expect(optionalOrg()).toBe("env-org");
  });

  it("treats an empty/blank env default as ABSENT (the KEY= footgun)", () => {
    // A .env line like `MISSIVE_DEFAULT_ORGANIZATION=` yields "" at runtime, which
    // must NOT leak into a request as `organization=` (the API rejects that).
    process.env.MISSIVE_DEFAULT_ORGANIZATION = "";
    expect(optionalOrg()).toBeUndefined();
    process.env.MISSIVE_DEFAULT_ORGANIZATION = "   ";
    expect(optionalOrg()).toBeUndefined();
    expect(() => resolveOrg()).toThrow(/organization is required/i);
  });

  it("resolveContactBook prefers the arg, then env, else throws", () => {
    expect(resolveContactBook("cb")).toBe("cb");
    process.env.MISSIVE_DEFAULT_CONTACT_BOOK = "env-cb";
    expect(resolveContactBook()).toBe("env-cb");
    delete process.env.MISSIVE_DEFAULT_CONTACT_BOOK;
    expect(() => resolveContactBook()).toThrow(/contact_book is required/i);
  });
});
