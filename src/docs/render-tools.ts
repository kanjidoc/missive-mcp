import { allTools } from "../tool-registry";

interface ToolMeta {
  name: string;
  description: string;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
  };
}

/**
 * Render the live tool inventory for the `missive_help` "tools" topic.
 *
 * Generated from the registry at call time, so adding or removing a tool is
 * reflected automatically with no documentation edit.
 *
 * There is a module-load cycle (tool-registry → tools/help → docs/render-tools →
 * tool-registry), but the top-level `import` is safe: in the compiled CommonJS,
 * `allTools` is read as a property at *call* time, by which point the registry
 * has finished initialising. (A lazy `require("../tool-registry")` also works at
 * runtime but can't be resolved by the test runner's module loader.)
 */
export function renderToolsTopic(): string {
  const tools = allTools as unknown as ToolMeta[];
  const lines: string[] = [
    "# Missive MCP — Tool Inventory",
    "",
    `${tools.length} tools are registered. Every name is prefixed \`missive_\`.`,
    "Annotations: read-only tools may run in parallel; idempotent tools can be",
    "safely repeated; destructive tools change state irreversibly. This server can",
    "post internal comments and merge conversations, but it has no delete tools and",
    "cannot send external email (drafts are saved in Missive for manual review).",
    "",
  ];
  for (const tool of tools) {
    const tags: string[] = [];
    if (tool.annotations?.readOnlyHint) tags.push("read-only");
    if (tool.annotations?.destructiveHint) tags.push("destructive");
    if (tool.annotations?.idempotentHint) tags.push("idempotent");
    const suffix = tags.length > 0 ? ` _(${tags.join(", ")})_` : "";
    lines.push(`- **${tool.name}**${suffix} — ${tool.description}`);
  }
  return lines.join("\n");
}
