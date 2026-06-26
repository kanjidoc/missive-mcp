import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { allTools } from "./tool-registry";
import { getVersion } from "./version";
import { buildInstructions } from "./server-instructions";
import { loadRoster } from "./roster";
import { MISSIVE_ICONS } from "./server-icon";

/**
 * The Missive MCP server. Every tool is registered through `tool-registry.ts`.
 * Unlike the OAuth-based reference this was modeled on, there is no token-refresh
 * wrapper — Missive uses a static personal access token. The handshake version
 * comes from `getVersion()` (see `src/version.ts`).
 */
export const missiveServer = createSdkMcpServer({
  name: "missive",
  version: getVersion(),
  tools: allTools,
});

// `createSdkMcpServer` exposes no option for the MCP "instructions" field — the
// usage guidance that clients (e.g. Claude Desktop) surface to the model at
// connect time. So set it on the underlying low-level server. It is read lazily
// when the `initialize` request is handled (after `connect`), so assigning here
// takes effect. `instance.server` is a public readonly field; we set the
// documented `instructions` ServerOption via its backing field because the
// factory provides no setter. A smoke test asserts it appears in `initialize`,
// so a future SDK change here fails loudly in CI rather than silently.
(missiveServer.instance.server as unknown as { _instructions?: string })._instructions =
  buildInstructions(loadRoster());

// Advertise a human-friendly title and the server icon in `serverInfo`, which
// clients read at `initialize` to display the server. `createSdkMcpServer` only
// accepts name/version, so set these on the underlying server's serverInfo object
// (mutated here, before connect; read lazily when initialize is handled). A
// handshake test asserts the icon round-trips, so an SDK change fails loudly.
const serverInfo = (
  missiveServer.instance.server as unknown as {
    _serverInfo: { title?: string; icons?: typeof MISSIVE_ICONS };
  }
)._serverInfo;
serverInfo.title = "Missive";
serverInfo.icons = MISSIVE_ICONS;
