import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { missiveRequest } from "../missive-client";
import { handle } from "../tool-helpers";

/**
 * Contact books tool — a single read-only list endpoint.
 *
 * GET /contact_books lists the contact books the authenticated user has access
 * to (private or shared with an organization/team/users). A contact book `id` is
 * mandatory when creating a contact, so this is the lookup tool for that id. The
 * endpoint takes no organization filter; it only paginates via `limit`/`offset`.
 */
export const listContactBooks = tool(
  "missive_list_contact_books",
  "Lists the contact books the API token owner can access (id, name, user, organization, sharing flags, description, and import status). Use this to find the contact_book id required when creating contacts. Read-only.",
  {
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe("Number of contact books to return. Default 50, max 200."),
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
    return handle(() => missiveRequest("GET", "/contact_books", { query }));
  },
  { annotations: { readOnlyHint: true } },
);
