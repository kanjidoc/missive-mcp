import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadRoster, renderRoster } from "../src/roster";
import { buildInstructions, MISSIVE_INSTRUCTIONS } from "../src/server-instructions";

let dir: string;
const fixture = (name: string) => join(dir, name);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "missive-roster-"));
  writeFileSync(
    fixture("valid.json"),
    JSON.stringify({
      users: [{ name: "Anj Afable", id: "user-anj" }],
      teams: [{ name: "TwoFabianos", id: "team-two" }],
    }),
  );
  writeFileSync(fixture("empty.json"), JSON.stringify({ users: [], teams: [] }));
  writeFileSync(fixture("invalid-shape.json"), JSON.stringify({ users: [{ name: "No Id" }] }));
  writeFileSync(fixture("malformed.json"), "{ this is not valid json");
  // No top-level `teams` key — should parse via `.default([])`, not be rejected.
  writeFileSync(fixture("users-only.json"), JSON.stringify({ users: [{ name: "Anj Afable", id: "user-anj" }] }));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("loadRoster", () => {
  it("parses a valid roster", () => {
    const roster = loadRoster(fixture("valid.json"));
    expect(roster?.users).toEqual([{ name: "Anj Afable", id: "user-anj" }]);
    expect(roster?.teams).toEqual([{ name: "TwoFabianos", id: "team-two" }]);
  });

  it("returns undefined when the file is missing (feature off)", () => {
    expect(loadRoster(fixture("does-not-exist.json"))).toBeUndefined();
  });

  it("returns undefined for an empty roster", () => {
    expect(loadRoster(fixture("empty.json"))).toBeUndefined();
  });

  it("applies the teams default when the top-level teams key is absent", () => {
    const roster = loadRoster(fixture("users-only.json"));
    expect(roster?.users).toHaveLength(1);
    expect(roster?.teams).toEqual([]);
  });

  it("returns undefined (no throw) for the wrong shape, logging to stderr", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(loadRoster(fixture("invalid-shape.json"))).toBeUndefined();
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it("returns undefined (no throw) for malformed JSON, logging to stderr", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(loadRoster(fixture("malformed.json"))).toBeUndefined();
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});

describe("renderRoster", () => {
  it("lists names and ids and is backtick-free", () => {
    const text = renderRoster({
      users: [{ name: "Anj Afable", id: "user-anj" }],
      teams: [{ name: "TwoFabianos", id: "team-two" }],
    });
    expect(text).toContain("Anj Afable — user-anj");
    expect(text).toContain("TwoFabianos — team-two");
    expect(text).toContain("use these IDs directly");
    expect(text).not.toContain("`");
  });

  it("omits the Teams section when there are no teams", () => {
    const usersOnly = renderRoster({
      users: [{ name: "Anj Afable", id: "user-anj" }],
      teams: [],
    });
    expect(usersOnly).toContain("Users");
    expect(usersOnly).not.toContain("Teams —");
  });

  it("omits the Users section when there are no users", () => {
    const teamsOnly = renderRoster({
      users: [],
      teams: [{ name: "TwoFabianos", id: "team-two" }],
    });
    expect(teamsOnly).toContain("TwoFabianos — team-two");
    expect(teamsOnly).toContain("Teams —");
    expect(teamsOnly).not.toContain("Users —");
  });
});

describe("buildInstructions", () => {
  it("returns the base instructions unchanged when there is no roster", () => {
    expect(buildInstructions(undefined)).toBe(MISSIVE_INSTRUCTIONS);
  });

  it("appends the roster block after the base when a roster is present", () => {
    const out = buildInstructions({
      users: [{ name: "Anj Afable", id: "user-anj" }],
      teams: [],
    });
    expect(out.startsWith(MISSIVE_INSTRUCTIONS)).toBe(true);
    expect(out).toContain("Anj Afable — user-anj");
  });
});
