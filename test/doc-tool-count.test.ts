import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { allTools } from "../src/tool-registry";
import { renderToolsTopic } from "../src/docs/render-tools";

/**
 * The expected number of registered tools. Bump this deliberately when adding or
 * removing a tool — the assertions below then force the docs to stay in sync,
 * so an accidental drop/duplicate of a registry entry (or stale doc count) fails
 * loudly rather than shipping silently.
 */
const EXPECTED_TOOL_COUNT = 36;

interface ToolMeta {
  name: string;
}

describe("tool registry", () => {
  const tools = allTools as unknown as ToolMeta[];

  it(`registers exactly ${EXPECTED_TOOL_COUNT} tools`, () => {
    expect(tools.length).toBe(EXPECTED_TOOL_COUNT);
  });

  it("gives every tool a unique, missive_-prefixed name", () => {
    const names = tools.map((t) => t.name);
    for (const name of names) expect(name).toMatch(/^missive_[a-z_]+$/);
    expect(new Set(names).size).toBe(names.length);
  });

  it("lists every registered tool in the help 'tools' inventory", () => {
    const topic = renderToolsTopic();
    expect(topic).toContain(`${EXPECTED_TOOL_COUNT} tools are registered`);
    for (const tool of tools) expect(topic).toContain(tool.name);
  });

  it("matches the tool count quoted in the README (doc-rot guard)", () => {
    const readme = readFileSync(join(__dirname, "..", "README.md"), "utf8");
    expect(readme).toContain(String(EXPECTED_TOOL_COUNT));
    for (const tool of tools) expect(readme).toContain(tool.name);
  });

  it("documents the count and every tool in docs/TOOLS.md (doc-rot guard)", () => {
    const doc = readFileSync(join(__dirname, "..", "docs", "TOOLS.md"), "utf8");
    expect(doc).toContain(String(EXPECTED_TOOL_COUNT));
    for (const tool of tools) expect(doc).toContain(tool.name);
  });
});
