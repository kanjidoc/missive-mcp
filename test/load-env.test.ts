import { describe, it, expect } from "vitest";
import { dotenvOptions } from "../src/load-env";
import { isAbsolute } from "node:path";

describe("dotenvOptions", () => {
  it("loads .env by an absolute path", () => {
    expect(isAbsolute(dotenvOptions.path)).toBe(true);
    expect(dotenvOptions.path.endsWith(".env")).toBe(true);
  });

  it("overrides launcher-injected vars (.env is authoritative)", () => {
    expect(dotenvOptions.override).toBe(true);
  });

  it("stays quiet so no banner corrupts the stdout JSON-RPC stream", () => {
    expect(dotenvOptions.quiet).toBe(true);
  });
});
