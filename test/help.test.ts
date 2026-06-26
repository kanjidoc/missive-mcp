import { describe, it, expect, vi } from "vitest";

// Force a roster so the injected branch flows through the real missive_help(usage)
// path deterministically (CI has no missive-roster.json). Preserve renderRoster —
// server-instructions.ts imports it — and only override loadRoster.
vi.mock("../src/roster", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/roster")>();
  return {
    ...actual,
    loadRoster: () => ({ users: [{ name: "Anj Afable", id: "user-anj" }], teams: [] }),
  };
});

import { missiveHelp } from "../src/tools/help";
import { MISSIVE_INSTRUCTIONS } from "../src/server-instructions";

type ToolLike = {
  handler: (
    args: Record<string, unknown>,
  ) => Promise<{ content: { text: string }[]; isError?: boolean }>;
};

describe("missive_help(usage)", () => {
  it("returns the composed instructions: base prefix + injected roster", async () => {
    const res = await (missiveHelp as unknown as ToolLike).handler({ topic: "usage" });
    const text = res.content[0].text;
    // Guards that help and the connect-time handshake share buildInstructions: a
    // regression reverting `usage` to the static constant drops the roster line.
    expect(text.startsWith(MISSIVE_INSTRUCTIONS)).toBe(true);
    expect(text).toContain("Anj Afable — user-anj");
    expect(res.isError).toBeFalsy();
  });
});
