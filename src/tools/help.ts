import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  renderOverviewTopic,
  renderVersionTopic,
  TOPIC_ARCHITECTURE,
  TOPIC_AUTHENTICATION,
  TOPIC_SAFETY,
  TOPIC_CONVENTIONS,
  TOPIC_EXTENDING,
  TOPIC_TROUBLESHOOTING,
} from "../docs/content";
import { renderToolsTopic } from "../docs/render-tools";
import { buildInstructions } from "../server-instructions";
import { loadRoster } from "../roster";
import { getVersion } from "../version";

/** Render the `index` topic — the list of all help topics, headed by the version. */
function renderIndexTopic(): string {
  return `# Missive MCP — Help

Version ${getVersion()}. This server documents itself. Call \`missive_help\`
with a \`topic\`:

- **overview** — what this server is and what it can/can't do (start here)
- **architecture** — file layout and how a request flows
- **tools** — the full live inventory of every registered tool
- **usage** — how to call the tools: rules, recipes, and safety (the guidance surfaced to the model at connect time)
- **authentication** — the personal access token and optional defaults
- **safety** — the no-send / no-delete guarantees and rate limits
- **conventions** — naming, error handling, output shape
- **extending** — how to add a new tool, and the gotchas to avoid
- **troubleshooting** — common failures and how to fix them
- **version** — the installed version and how to update`;
}

/**
 * `missive_help` — the self-documenting tool. Returns embedded documentation so
 * an AI assistant (or a developer) can understand how this project is built and
 * what is safe to call, without reading the source.
 */
export const missiveHelp = tool(
  "missive_help",
  "Returns embedded documentation about this Missive MCP server — overview, architecture, the full tool inventory, authentication, safety guarantees (it cannot send email or delete records), conventions, how to add tools, troubleshooting, and the installed version. Call this to understand the project or answer 'what version do I have?'.",
  {
    topic: z
      .enum([
        "index",
        "overview",
        "architecture",
        "tools",
        "usage",
        "authentication",
        "safety",
        "conventions",
        "extending",
        "troubleshooting",
        "version",
      ])
      .default("index")
      .describe("Which documentation section to retrieve. 'index' lists all sections."),
  },
  async (args) => {
    try {
      const sections: Record<string, string | (() => string)> = {
        index: renderIndexTopic,
        overview: renderOverviewTopic,
        architecture: TOPIC_ARCHITECTURE,
        tools: renderToolsTopic,
        usage: () => buildInstructions(loadRoster()),
        authentication: TOPIC_AUTHENTICATION,
        safety: TOPIC_SAFETY,
        conventions: TOPIC_CONVENTIONS,
        extending: TOPIC_EXTENDING,
        troubleshooting: TOPIC_TROUBLESHOOTING,
        version: renderVersionTopic,
      };
      const entry = sections[args.topic] ?? renderIndexTopic;
      const text = typeof entry === "function" ? entry() : entry;
      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to render help: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
  { annotations: { readOnlyHint: true } },
);
