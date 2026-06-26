import { describe, it, expect } from "vitest";
import { getVersion } from "../src/version";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pkg = require("../package.json") as { version: string };

describe("getVersion", () => {
  it("returns package.json's version (the single source of truth)", () => {
    expect(getVersion()).toBe(pkg.version);
    expect(getVersion()).not.toBe("unknown");
  });
});
