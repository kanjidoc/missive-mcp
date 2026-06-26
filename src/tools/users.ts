import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { missiveRequest } from "../missive-client";
import { handle, optionalOrg } from "../tool-helpers";

/**
 * Users tool — a single read-only list endpoint.
 *
 * GET /users lists users across the organizations the authenticated token owner
 * belongs to. `organization` is an OPTIONAL filter (resolved via env default,
 * omitted entirely when absent — never an error); the API otherwise lists across
 * all accessible organizations. User status (availability / away / out-of-office)
 * is not exposed by the Missive API and so is not available here.
 */
export const listUsers = tool(
  "missive_list_users",
  "Lists users across the organizations the API token owner belongs to (id, name, email, avatar_url, and `me` for the token owner). `organization` is an optional filter; when omitted (and no default is set) users from all accessible organizations are returned. Read-only.",
  {
    organization: z
      .string()
      .optional()
      .describe(
        "Optional organization UUID to filter users. Defaults to MISSIVE_DEFAULT_ORGANIZATION; if neither is set, lists users across all accessible organizations.",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe("Number of users to return. Default 50, max 200."),
    offset: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Offset used to paginate results. Default 0."),
  },
  async (args) => {
    const query = {
      organization: optionalOrg(args.organization),
      limit: args.limit,
      offset: args.offset,
    };
    return handle(() => missiveRequest("GET", "/users", { query }));
  },
  { annotations: { readOnlyHint: true } },
);
