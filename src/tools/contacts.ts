import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { missiveRequest } from "../missive-client";
import { handle, errorResult, resolveContactBook } from "../tool-helpers";
import { joinIds, validateBatchIds } from "../query-helpers";

/**
 * Contact tools — GET/POST/PATCH `/contacts`.
 *
 * All request bodies are assembled field-by-field from declared zod fields
 * (no `.passthrough()`, no freeform/raw body) so the exact wire shape is always
 * known. Missive wraps create/update payloads as `{ "contacts": [ … ] }` and a
 * key is only included when the caller actually supplied it.
 */

/**
 * A single contact `info` (email / phone / social / address / custom value).
 *
 * Missive's info shape is a flat object whose meaningful fields depend on
 * `kind`, so this is modeled as one schema rather than a per-kind union:
 *  - `value` carries the data for email/phone_number/twitter/url/custom.
 *  - `name` carries the data for facebook.
 *  - the address sub-fields (street…country) carry the data for physical_address.
 * `label` is a free string because its accepted values differ per `kind`
 * (documented inline); the API validates the combination.
 */
const contactInfoSchema = z.object({
  kind: z
    .enum(["email", "phone_number", "twitter", "facebook", "physical_address", "url", "custom"])
    .describe("Info type; determines which other fields apply."),
  value: z
    .string()
    .optional()
    .describe(
      "The info value for kind email/phone_number/twitter/url/custom (e.g. an email address, phone number, '@handle', URL, or custom string). Not used for facebook (use `name`) or physical_address (use the address sub-fields).",
    ),
  name: z
    .string()
    .optional()
    .describe("Facebook user name. Use only when kind is 'facebook'."),
  label: z
    .string()
    .describe(
      "Label/type for this info (required for every kind). Accepted values depend on kind: email home|work|personal|other; phone_number main|mobile|home|work|home_fax|work_fax|other_fax|pager|other; twitter|facebook work|personal|other; physical_address work|home|other; url homepage|profile|blog|work|personal|other; custom other.",
    ),
  custom_label: z
    .string()
    .optional()
    .describe("Custom label text; use only when `label` is 'other'."),
  street: z.string().optional().describe("Street address. Only for kind 'physical_address'."),
  extended_address: z
    .string()
    .optional()
    .describe("Extended address (suite/office/etc.). Only for kind 'physical_address'."),
  city: z.string().optional().describe("City. Only for kind 'physical_address'."),
  region: z
    .string()
    .optional()
    .describe("Region / state / province. Only for kind 'physical_address'."),
  postal_code: z.string().optional().describe("Postal / ZIP code. Only for kind 'physical_address'."),
  po_box: z.string().optional().describe("PO box. Only for kind 'physical_address'."),
  country: z.string().optional().describe("Country. Only for kind 'physical_address'."),
});

/** The group/organization a membership links to (both fields required). */
const membershipGroupSchema = z.object({
  kind: z
    .enum(["group", "organization"])
    .describe(
      "Group type: 'organization' (e.g. a workplace) or 'group' (a label-like collection of contacts).",
    ),
  name: z.string().describe("Name of the group or organization."),
});

/**
 * A contact `membership` linking the contact to a group/organization. The
 * `title`/`location`/`department`/`description` fields are only meaningful when
 * `group.kind` is 'organization'.
 */
const contactMembershipSchema = z.object({
  group: membershipGroupSchema.describe("The group or organization this membership links to (required)."),
  title: z
    .string()
    .optional()
    .describe("Job title; applies when group.kind is 'organization'."),
  location: z
    .string()
    .optional()
    .describe("Location; applies when group.kind is 'organization'."),
  department: z
    .string()
    .optional()
    .describe("Department; applies when group.kind is 'organization'."),
  description: z
    .string()
    .optional()
    .describe("Free-text description; applies when group.kind is 'organization'."),
});

type ContactInfoInput = z.infer<typeof contactInfoSchema>;
type ContactMembershipInput = z.infer<typeof contactMembershipSchema>;

/** Scalar contact attributes shared by create and update. */
interface ContactScalarFields {
  first_name?: string;
  last_name?: string;
  middle_name?: string;
  phonetic_first_name?: string;
  phonetic_last_name?: string;
  phonetic_middle_name?: string;
  prefix?: string;
  suffix?: string;
  nickname?: string;
  file_as?: string;
  notes?: string;
  starred?: boolean;
  gender?: string;
  infos?: ContactInfoInput[];
  memberships?: ContactMembershipInput[];
}

/** The reusable zod shape for the writable contact attributes (excl. id/contact_book). */
const contactFieldsShape = {
  first_name: z.string().optional().describe("First name."),
  last_name: z.string().optional().describe("Last name."),
  middle_name: z.string().optional().describe("Middle name."),
  phonetic_first_name: z.string().optional().describe("Phonetic spelling of the first name."),
  phonetic_last_name: z.string().optional().describe("Phonetic spelling of the last name."),
  phonetic_middle_name: z.string().optional().describe("Phonetic spelling of the middle name."),
  prefix: z.string().optional().describe("Name prefix, e.g. 'Mr.'."),
  suffix: z.string().optional().describe("Name suffix, e.g. 'Jr.'."),
  nickname: z.string().optional().describe("Nickname."),
  file_as: z.string().optional().describe("Name to file/sort the contact under."),
  notes: z.string().optional().describe("Free-text notes about the contact."),
  starred: z.boolean().optional().describe("Whether the contact is starred."),
  gender: z.string().optional().describe("Gender, e.g. 'Male'."),
  infos: z
    .array(contactInfoSchema)
    .optional()
    .describe("Contact infos (emails, phones, socials, addresses, custom values)."),
  memberships: z
    .array(contactMembershipSchema)
    .optional()
    .describe("Memberships linking the contact to organizations or groups."),
} as const;

/** Build an `info` body object, including only the keys the caller supplied. */
function buildInfo(info: ContactInfoInput): Record<string, unknown> {
  const out: Record<string, unknown> = { kind: info.kind };
  if (info.value !== undefined) out.value = info.value;
  if (info.name !== undefined) out.name = info.name;
  if (info.label !== undefined) out.label = info.label;
  if (info.custom_label !== undefined) out.custom_label = info.custom_label;
  if (info.street !== undefined) out.street = info.street;
  if (info.extended_address !== undefined) out.extended_address = info.extended_address;
  if (info.city !== undefined) out.city = info.city;
  if (info.region !== undefined) out.region = info.region;
  if (info.postal_code !== undefined) out.postal_code = info.postal_code;
  if (info.po_box !== undefined) out.po_box = info.po_box;
  if (info.country !== undefined) out.country = info.country;
  return out;
}

/** Build a `membership` body object, including only the keys the caller supplied. */
function buildMembership(membership: ContactMembershipInput): Record<string, unknown> {
  const out: Record<string, unknown> = {
    group: { kind: membership.group.kind, name: membership.group.name },
  };
  if (membership.title !== undefined) out.title = membership.title;
  if (membership.location !== undefined) out.location = membership.location;
  if (membership.department !== undefined) out.department = membership.department;
  if (membership.description !== undefined) out.description = membership.description;
  return out;
}

/** Copy the shared scalar/array fields onto a contact body, omitting undefined keys. */
function applyContactFields(target: Record<string, unknown>, c: ContactScalarFields): void {
  if (c.first_name !== undefined) target.first_name = c.first_name;
  if (c.last_name !== undefined) target.last_name = c.last_name;
  if (c.middle_name !== undefined) target.middle_name = c.middle_name;
  if (c.phonetic_first_name !== undefined) target.phonetic_first_name = c.phonetic_first_name;
  if (c.phonetic_last_name !== undefined) target.phonetic_last_name = c.phonetic_last_name;
  if (c.phonetic_middle_name !== undefined) target.phonetic_middle_name = c.phonetic_middle_name;
  if (c.prefix !== undefined) target.prefix = c.prefix;
  if (c.suffix !== undefined) target.suffix = c.suffix;
  if (c.nickname !== undefined) target.nickname = c.nickname;
  if (c.file_as !== undefined) target.file_as = c.file_as;
  if (c.notes !== undefined) target.notes = c.notes;
  if (c.starred !== undefined) target.starred = c.starred;
  if (c.gender !== undefined) target.gender = c.gender;
  if (c.infos !== undefined) target.infos = c.infos.map(buildInfo);
  if (c.memberships !== undefined) target.memberships = c.memberships.map(buildMembership);
}

/** A contact to create. `contact_book` falls back to MISSIVE_DEFAULT_CONTACT_BOOK. */
const createContactSchema = z.object({
  contact_book: z
    .string()
    .optional()
    .describe(
      "Contact book UUID this contact belongs to. Falls back to MISSIVE_DEFAULT_CONTACT_BOOK; required (errors if neither is set).",
    ),
  ...contactFieldsShape,
});

/** A contact to update. `id` is required; only supplied attributes change. */
const updateContactSchema = z.object({
  id: z.string().describe("UUID of the contact to update (must also appear in the URL id list)."),
  contact_book: z
    .string()
    .optional()
    .describe("Move the contact to this contact book UUID. Omit to leave unchanged."),
  ...contactFieldsShape,
});

export const listContacts = tool(
  "missive_list_contacts",
  "List contacts in a contact book. Requires `contact_book` (or MISSIVE_DEFAULT_CONTACT_BOOK). Supports `search`, `order`, `limit` (max 200), `offset`, `modified_since`, and `include_deleted`. Read-only.",
  {
    contact_book: z
      .string()
      .optional()
      .describe(
        "Contact book UUID to list from. Falls back to MISSIVE_DEFAULT_CONTACT_BOOK; required (errors if neither is set).",
      ),
    search: z
      .string()
      .optional()
      .describe(
        "Text filter matched against all contact infos (name, email, phone, organization, custom fields, notes, etc.).",
      ),
    order: z
      .enum(["last_name", "last_modified"])
      .default("last_name")
      .describe("Sort order: 'last_name' (default) or 'last_modified' (most recently updated first)."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .default(50)
      .describe("Number of contacts to return. Default 50, max 200."),
    offset: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Offset for pagination (default 0)."),
    modified_since: z
      .number()
      .int()
      .optional()
      .describe("Unix epoch seconds; return only contacts created/modified since this time."),
    include_deleted: z
      .boolean()
      .optional()
      .describe(
        "When used with `modified_since`, include deleted contacts (they return only id, deleted, and modified_at). Default false.",
      ),
  },
  async (args) =>
    handle(() => {
      const contactBook = resolveContactBook(args.contact_book);
      return missiveRequest("GET", "/contacts", {
        query: {
          contact_book: contactBook,
          search: args.search,
          order: args.order,
          limit: args.limit,
          offset: args.offset,
          modified_since: args.modified_since,
          include_deleted: args.include_deleted,
        },
      });
    }),
  { annotations: { readOnlyHint: true } },
);

export const getContact = tool(
  "missive_get_contact",
  "Fetch a single contact by its UUID. A deleted contact returns 404. Read-only.",
  {
    contact_id: z.string().describe("UUID of the contact to fetch."),
  },
  async (args) => handle(() => missiveRequest("GET", `/contacts/${args.contact_id}`)),
  { annotations: { readOnlyHint: true } },
);

export const createContacts = tool(
  "missive_create_contacts",
  "Create one or more contacts. Body shape `{ contacts: [...] }`. Each contact's `contact_book` falls back to MISSIVE_DEFAULT_CONTACT_BOOK. Supports names, `starred`, `gender`, `infos[]` (emails/phones/socials/addresses/custom), and `memberships[]` (organizations/groups).",
  {
    contacts: z
      .array(createContactSchema)
      .min(1)
      .describe("One or more contacts to create."),
  },
  async (args) =>
    handle(() => {
      const contacts = args.contacts.map((c) => {
        const body: Record<string, unknown> = { contact_book: resolveContactBook(c.contact_book) };
        applyContactFields(body, c);
        return body;
      });
      return missiveRequest("POST", "/contacts", { body: { contacts } });
    }),
  { annotations: { destructiveHint: false } },
);

export const updateContacts = tool(
  "missive_update_contacts",
  "Update one or more contacts by UUID (PATCH /contacts/:id1,:id2,...). Each object in `contacts[]` must include its `id`; only the attributes you supply are changed. WARNING: passing `infos` or `memberships` REPLACES the whole array — omitted items are deleted, so read-merge before writing. Idempotent.",
  {
    contacts: z
      .array(updateContactSchema)
      .min(1)
      .describe("One or more contacts to update; each must include its `id`."),
  },
  async (args) => {
    const ids = args.contacts.map((c) => c.id);
    const validationError = validateBatchIds(ids, args.contacts);
    if (validationError) return errorResult(validationError);
    return handle(() => {
      const contacts = args.contacts.map((c) => {
        const body: Record<string, unknown> = { id: c.id };
        if (c.contact_book !== undefined) body.contact_book = c.contact_book;
        applyContactFields(body, c);
        return body;
      });
      return missiveRequest("PATCH", `/contacts/${joinIds(ids)}`, { body: { contacts } });
    });
  },
  { annotations: { idempotentHint: true, destructiveHint: true } },
);
