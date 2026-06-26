import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildClaudeServerConfig, buildClaudeCodeServerJson } from "../src/mcp-config";

describe("buildClaudeServerConfig", () => {
  it("produces { command, args } pointing at dist/index.js, with NO env block", () => {
    const cfg = buildClaudeServerConfig("/somewhere/missive-mcp");
    expect(cfg.command).toBe("node");
    expect(cfg.args).toEqual([join("/somewhere/missive-mcp", "dist", "index.js")]);
    expect("env" in cfg).toBe(false);
  });

  it("the Claude Code variant adds type:stdio and still has no env block", () => {
    const cfg = buildClaudeCodeServerJson("/somewhere/missive-mcp");
    expect(cfg.type).toBe("stdio");
    expect(cfg.command).toBe("node");
    expect("env" in cfg).toBe(false);
  });
});

describe(".mcp.json", () => {
  const raw = readFileSync(join(__dirname, "..", ".mcp.json"), "utf8");

  it("is valid JSON and registers the missive server", () => {
    const parsed = JSON.parse(raw);
    expect(parsed.mcpServers.missive.command).toBe("node");
    expect(parsed.mcpServers.missive.args[0]).toMatch(/dist\/index\.js$/);
  });

  it("carries no token (the secret lives only in .env)", () => {
    expect(raw).not.toMatch(/missive_pat-/);
    expect(raw.toLowerCase()).not.toMatch(/token/);
  });
});
