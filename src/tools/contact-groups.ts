import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { missiveRequest } from "../missive-client";
import { handle, resolveContactBook } from "../tool-helpers";

/**
 * Contact-groups tool: list the contact groups or organizations linked to a
 * contact book. Read-only — there is no create/update endpoint for groups here.
 *
 * `contact_book` and `kind` are both required by the API. `contact_book` falls
 * back to MISSIVE_DEFAULT_CONTACT_BOOK (resolveContactBook throws a clear error
 * when neither is present); `kind` selects between unrelated-contact "group"s
 * (think labels) and "organization"s (related contacts, e.g. businesses).
 */
export const listContactGroups = tool(
  "missive_list_contact_groups",
  "Lists the contact groups or organizations linked to a contact book (GET /contact_groups). Provide `kind` = 'group' (labels for unrelated contacts) or 'organization' (related contacts such as a business). `contact_book` is required (or set MISSIVE_DEFAULT_CONTACT_BOOK). Read-only.",
  {
    contact_book: z
      .string()
      .optional()
      .describe(
        "Contact book ID to list groups from. Required; falls back to MISSIVE_DEFAULT_CONTACT_BOOK when omitted.",
      ),
    kind: z
      .enum(["group", "organization"])
      .describe(
        "Which kind to list: 'group' (labels grouping unrelated contacts) or 'organization' (related contacts, e.g. businesses). Required.",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe("Number of contact groups to return. Default 50, max 200."),
    offset: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Offset used to paginate results. Default 0."),
  },
  async (args) => {
    // resolveContactBook throws (caught by handle) when neither the arg nor
    // MISSIVE_DEFAULT_CONTACT_BOOK is set, so it stays inside the handle callback.
    return handle(() => {
      const query = {
        contact_book: resolveContactBook(args.contact_book),
        kind: args.kind,
        limit: args.limit,
        offset: args.offset,
      };
      return missiveRequest("GET", "/contact_groups", { query });
    });
  },
  { annotations: { readOnlyHint: true } },
);
