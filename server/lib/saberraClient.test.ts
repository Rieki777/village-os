/**
 * The transport is measured, the payload is not, and these tests are written to
 * that difference. The transport cases assert. The payload cases assert that an
 * unexpected shape is REPORTED and never mistaken for an empty village.
 */
import { describe, expect, it } from "vitest";
import { callTool, openSession, type FetchLike } from "./saberraClient";

const reply = (body: string, init: { status?: number; sessionId?: string } = {}) =>
  new Response(body, {
    status: init.status ?? 200,
    headers: init.sessionId ? { "mcp-session-id": init.sessionId } : {},
  });

const framed = (payload: unknown, opts: { keepalives?: number } = {}) =>
  `${": keepalive\n\n".repeat(opts.keepalives ?? 0)}event: message\ndata: ${JSON.stringify(payload)}\n\n`;

function spy(handler: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return { fetchImpl, calls };
}

const opts = (fetchImpl: FetchLike) => ({ baseUrl: "https://example.test/", token: "t0ken", fetchImpl });

describe("talking to the outside service", () => {
  it("ALWAYS OFFERS BOTH CONTENT TYPES, because their server answers 406 to one", () => {
    // Measured against the live service: offering only application/json is
    // refused with "Client must accept both application/json and
    // text/event-stream". This is the header that stops that happening.
    const s = spy(() => reply("", { sessionId: "sess-1" }));
    return openSession(opts(s.fetchImpl)).then(() => {
      const accept = String((s.calls[0].init.headers as Record<string, string>).Accept);
      expect(accept).toContain("application/json");
      expect(accept).toContain("text/event-stream");
      expect((s.calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer t0ken");
    });
  });

  it("takes the session id off the RESPONSE HEADER, which is easy to miss", async () => {
    const s = spy(() => reply("", { sessionId: "sess-9" }));
    expect(await openSession(opts(s.fetchImpl))).toBe("sess-9");
  });

  it("answers null when no session id comes back, instead of calling with an empty one", async () => {
    const s = spy(() => reply(""));
    expect(await openSession(opts(s.fetchImpl))).toBeNull();
  });

  it("sends the session id on every call after it", async () => {
    const s = spy(() => reply(framed({ result: { records: [] } })));
    await callTool(opts(s.fetchImpl), "sess-3", "list_records", { kind: "role" });
    expect((s.calls[0].init.headers as Record<string, string>)["mcp-session-id"]).toBe("sess-3");
  });

  it("reads records through the keepalives a slow answer arrives behind", async () => {
    const s = spy(() => reply(framed({ result: { records: [{ id: "r-1" }, { id: "r-2" }] } }, { keepalives: 3 })));
    const r = await callTool(opts(s.fetchImpl), "s", "list_records", {});
    expect(r).toEqual({ ok: true, records: [{ id: "r-1" }, { id: "r-2" }], cursor: null });
  });

  it("reads records out of a text block carrying JSON, and keeps the cursor", async () => {
    const inner = JSON.stringify({ records: [{ id: "r-1" }], cursor: "next-page" });
    const s = spy(() => reply(framed({ result: { content: [{ type: "text", text: inner }] } })));
    const r = await callTool(opts(s.fetchImpl), "s", "list_records", {});
    expect(r).toEqual({ ok: true, records: [{ id: "r-1" }], cursor: "next-page" });
  });

  it("REPORTS PROSE AS UNREADABLE, because prose is what their old read tools answer", async () => {
    // Their `ask_sera` answers sentences. A sentence is not a typed read and
    // must never be turned into a record, or a village gets a circle called
    // "Based on the query result, here are the properties".
    const s = spy(() => reply(framed({ result: { content: [{ type: "text", text: "Here are the circles: ..." }] } })));
    const r = await callTool(opts(s.fetchImpl), "s", "list_records", {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.why).toBe("unreadable");
  });

  it("NEVER TURNS A SHAPE IT CANNOT READ INTO AN EMPTY LIST", async () => {
    // The whole point. An empty village and a broken sync look identical to a
    // caller unless this distinction is kept.
    const s = spy(() => reply(framed({ result: { somethingElse: true } })));
    const r = await callTool(opts(s.fetchImpl), "s", "list_records", {});
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.why).toBe("unreadable");
      expect(r.detail).toContain("somethingElse");
    }
  });

  it("still reads a genuinely empty list as success", async () => {
    const s = spy(() => reply(framed({ result: { records: [] } })));
    expect(await callTool(opts(s.fetchImpl), "s", "list_records", {})).toEqual({
      ok: true,
      records: [],
      cursor: null,
    });
  });

  it("names a vendor error instead of swallowing it", async () => {
    const s = spy(() => reply(framed({ error: { code: -32000, message: "scope does not permit this tool" } })));
    const r = await callTool(opts(s.fetchImpl), "s", "list_records", {});
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.why).toBe("vendor-error");
      expect(r.detail).toContain("scope");
    }
  });

  it("names an http refusal with its status", async () => {
    const s = spy(() => reply("", { status: 403 }));
    const r = await callTool(opts(s.fetchImpl), "s", "list_records", {});
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.why).toBe("refused");
      expect(r.detail).toContain("403");
    }
  });

  it("survives the network throwing, instead of taking the sync down with it", async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    };
    const r = await callTool(opts(fetchImpl), "s", "list_records", {});
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.why).toBe("refused");
      expect(r.detail).toContain("ENOTFOUND");
    }
  });

  it("refuses a list whose items are not records, instead of half-reading it", async () => {
    const s = spy(() => reply(framed({ result: { records: [{ id: "ok" }, "not a record"] } })));
    const r = await callTool(opts(s.fetchImpl), "s", "list_records", {});
    expect(r.ok).toBe(false);
  });
});
