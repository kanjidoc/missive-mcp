import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/extract-changelog.mjs", import.meta.url));

function run(arg: string): { status: number; stdout: string } {
  try {
    const stdout = execFileSync("node", [script, arg], { encoding: "utf8" });
    return { status: 0, stdout };
  } catch (e) {
    const err = e as { status?: number; stdout?: string };
    return { status: err.status ?? 1, stdout: err.stdout ?? "" };
  }
}

describe("extract-changelog", () => {
  it("prints the section body for an existing version", () => {
    const { status, stdout } = run("0.1.0");
    expect(status).toBe(0);
    expect(stdout).toContain("Missive");
    expect(stdout.startsWith("## [")).toBe(false); // heading line is not emitted
  });

  it("exits non-zero for a missing version section", () => {
    expect(run("9.9.9").status).not.toBe(0);
  });
});
