import { describe, it, expect } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { MISSIVE_INSTRUCTIONS } from "../src/server-instructions";
import { missiveServer } from "../src/server";

describe("MISSIVE_INSTRUCTIONS content", () => {
  it("states the safety boundary and the rules that trip callers up", () => {
    expect(MISSIVE_INSTRUCTIONS).toContain("SAFETY");
    expect(MISSIVE_INSTRUCTIONS).toMatch(/cannot[\s\S]*send/i);
    expect(MISSIVE_INSTRUCTIONS).toContain("missive_list_conversations");
    expect(MISSIVE_INSTRUCTIONS).toContain("contact_book");
  });
});

describe("initialize handshake (real round-trip)", () => {
  it("surfaces the instructions and the 35 tools to a connected client", async () => {
    // Drive an actual MCP initialize over an in-memory transport pair, so this
    // genuinely guards the `_instructions` wiring in server.ts: if a future SDK
    // reads instructions from a different field, getInstructions() returns
    // undefined here and the test fails (rather than silently dropping them).
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([
      missiveServer.instance.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    // The base instructions are always surfaced; an optional, gitignored private
    // roster (missive-roster.json) may be appended AFTER them — the base is always
    // a PREFIX (the documented buildInstructions contract), so assert startsWith
    // rather than exact-equal. This still guards the `_instructions` wiring: if it
    // breaks, getInstructions() is undefined and the assertion fails.
    expect(client.getInstructions()?.startsWith(MISSIVE_INSTRUCTIONS)).toBe(true);

    // serverInfo advertises the title and the embedded PNG icon.
    const info = client.getServerVersion();
    expect(info?.title).toBe("Missive");
    const icons = (info as { icons?: { src: string; mimeType?: string }[] } | undefined)?.icons;
    expect(icons?.length).toBe(1);
    expect(icons?.[0].src.startsWith("data:image/png;base64,")).toBe(true);
    expect(icons?.[0].mimeType).toBe("image/png");

    const { tools } = await client.listTools();
    expect(tools.length).toBe(36);
    expect(tools.every((t) => t.name.startsWith("missive_"))).toBe(true);

    await client.close();
  });
});
