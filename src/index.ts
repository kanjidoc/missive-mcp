import "./load-env";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { missiveServer } from "./server";

async function main() {
  const transport = new StdioServerTransport();
  await missiveServer.instance.connect(transport);
}

main().catch((err) => {
  console.error("Failed to start Missive MCP server:", err);
  process.exit(1);
});
