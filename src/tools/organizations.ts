import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { missiveRequest } from "../missive-client";
import { handle } from "../tool-helpers";

/**
 * Organizations tool — a single read-only list endpoint.
 *
 * GET /organizations lists the organizations the authenticated user is part of
 * (each with an `id` and `name`). The organization `id` is the value other tools
 * accept as their `organization` filter or default, so this is the lookup tool
 * for that id. The endpoint takes no filters; it only paginates via
 * `limit`/`offset`.
 */
export const listOrganizations = tool(
  "missive_list_organizations",
  "Lists the organizations the API token owner is part of (id, name). Use this to find the organization id used as a filter or default by other tools. Read-only.",
  {
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe("Number of organizations to return. Default 50, max 200."),
    offset: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Offset used to paginate results. Default 0."),
  },
  async (args) => {
    const query = {
      limit: args.limit,
      offset: args.offset,
    };
    return handle(() => missiveRequest("GET", "/organizations", { query }));
  },
  { annotations: { readOnlyHint: true } },
);
