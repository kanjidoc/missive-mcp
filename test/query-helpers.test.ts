import { describe, it, expect } from "vitest";
import { buildQuery, joinIds, validateBatchIds } from "../src/query-helpers";

describe("buildQuery", () => {
  it("drops undefined and null, keeps falsy-but-present values", () => {
    expect(buildQuery({ a: 1, b: undefined, c: null, d: 0, e: "" })).toBe("?a=1&d=0&e=");
  });

  it("serializes booleans as true/false strings", () => {
    expect(buildQuery({ inbox: true, closed: false })).toBe("?inbox=true&closed=false");
  });

  it("returns empty string when nothing survives", () => {
    expect(buildQuery({ a: undefined, b: null })).toBe("");
    expect(buildQuery({})).toBe("");
  });

  it("url-encodes values", () => {
    expect(buildQuery({ email: "a b@x.com" })).toBe("?email=a+b%40x.com");
  });
});

describe("joinIds", () => {
  it("joins, trims, and drops blanks", () => {
    expect(joinIds([" a ", "b", "", "  ", "c"])).toBe("a,b,c");
  });
});

describe("validateBatchIds", () => {
  it("returns null when counts match and every item carries a listed id", () => {
    expect(validateBatchIds(["a", "b"], [{ id: "a" }, { id: "b" }])).toBeNull();
  });

  it("rejects an empty id list", () => {
    expect(validateBatchIds([], [])).toMatch(/at least one id/i);
  });

  it("rejects a count mismatch", () => {
    expect(validateBatchIds(["a", "b"], [{ id: "a" }])).toMatch(/exactly one object per id/i);
  });

  it("rejects an item missing its id", () => {
    expect(validateBatchIds(["a"], [{}])).toMatch(/must include its own 'id'/i);
  });

  it("rejects an item whose id is not in the URL list", () => {
    expect(validateBatchIds(["a"], [{ id: "z" }])).toMatch(/not present in the URL id list/i);
  });
});
