import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the HTTP client so handlers run without any network call; we inspect the
// request the handler *would* have made. `vi.hoisted` lets the (hoisted) mock
// factory reference our spy.
const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock("../src/missive-client", () => ({ missiveRequest: requestMock }));

import { createDraft } from "../src/tools/drafts";
import {
  listConversations,
  updateConversations,
  mergeConversations,
} from "../src/tools/conversations";
import { createResponses } from "../src/tools/responses";

type ToolLike = {
  handler: (args: Record<string, unknown>) => Promise<{ isError?: boolean }>;
};
const run = (tool: unknown, args: Record<string, unknown>) =>
  (tool as ToolLike).handler(args);

function lastBody(): Record<string, unknown> | undefined {
  const call = requestMock.mock.calls.at(-1);
  return call ? (call[2] as { body?: Record<string, unknown> } | undefined)?.body : undefined;
}

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockResolvedValue({ ok: true, status: 200, data: {} });
});

describe("create_draft — the no-send guarantee", () => {
  it("never forwards send / send_at / auto_followup, even if injected into args", async () => {
    await run(createDraft, {
      subject: "Re: Hi",
      body: "hello",
      to_fields: [{ address: "a@b.com" }],
      from_field: { address: "me@org.com" },
      // none of these are declared params; the field-by-field body builder must ignore them
      send: true,
      send_at: 123,
      auto_followup: true,
      external_response_id: "x",
    });
    const drafts = lastBody()?.drafts as Record<string, unknown> | undefined;
    expect(drafts).toBeDefined();
    for (const forbidden of ["send", "send_at", "auto_followup", "external_response_id", "external_response_variables"]) {
      expect(forbidden in (drafts as Record<string, unknown>)).toBe(false);
    }
  });

  it("forwards attachments when provided", async () => {
    await run(createDraft, {
      body: "x",
      to_fields: [{ address: "a@b.com" }],
      from_field: { address: "me@org.com" },
      attachments: [{ base64_data: "AAAA", filename: "a.txt" }],
    });
    const drafts = lastBody()?.drafts as Record<string, unknown>;
    expect(drafts.attachments).toEqual([{ base64_data: "AAAA", filename: "a.txt" }]);
  });
});

describe("handler validation rejects bad input before any API call", () => {
  it("list_conversations requires at least one mailbox filter", async () => {
    const res = await run(listConversations, {});
    expect(res.isError).toBe(true);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("list_conversations rejects two mutually-exclusive contact filters", async () => {
    const res = await run(listConversations, { inbox: true, email: "a@b.com", domain: "b.com" });
    expect(res.isError).toBe(true);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("update_conversations requires organization when adding shared labels", async () => {
    const res = await run(updateConversations, {
      ids: ["c1"],
      conversations: [{ id: "c1", add_shared_labels: ["l1"] }],
    });
    expect(res.isError).toBe(true);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("create_responses rejects an item scoped to both organization and user", async () => {
    const res = await run(createResponses, {
      responses: [{ organization: "o1", user: "u1", body: "x" }],
    });
    expect(res.isError).toBe(true);
    expect(requestMock).not.toHaveBeenCalled();
  });
});

describe("merge_conversations", () => {
  it("POSTs to /conversations/:source/merge with the target in the body", async () => {
    await run(mergeConversations, {
      source_conversation_id: "src1",
      target_conversation_id: "tgt1",
      subject: "Merged",
    });
    const call = requestMock.mock.calls.at(-1);
    expect(call?.[0]).toBe("POST");
    expect(call?.[1]).toBe("/conversations/src1/merge");
    expect((call?.[2] as { body?: Record<string, unknown> })?.body).toEqual({
      target: "tgt1",
      subject: "Merged",
    });
  });
});

describe("create_draft env defaults", () => {
  it("uses MISSIVE_DEFAULT_FROM_ADDRESS / NAME when from_field is omitted", async () => {
    process.env.MISSIVE_DEFAULT_FROM_ADDRESS = "me@org.com";
    process.env.MISSIVE_DEFAULT_FROM_NAME = "Me";
    try {
      await run(createDraft, { body: "x", to_fields: [{ address: "a@b.com" }] });
      const drafts = lastBody()?.drafts as Record<string, unknown>;
      expect(drafts.from_field).toEqual({ address: "me@org.com", name: "Me" });
    } finally {
      delete process.env.MISSIVE_DEFAULT_FROM_ADDRESS;
      delete process.env.MISSIVE_DEFAULT_FROM_NAME;
    }
  });
});
