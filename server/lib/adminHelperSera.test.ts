/**
 * The Admin helper's Sera road (server/lib/adminHelperSera.ts): the real
 * client against a fake library that speaks the service's wire, and the one
 * question it sends.
 */
import { describe, expect, it } from "vitest";
import type { ClientOptions } from "./saberraClient";
import { SERA_QUESTION_MAX, asksAboutOrg, makeSeraAsk, seraHelperQuestion, seraReplyText } from "./adminHelperSera";

const sse = (payload: unknown) => `event: message\ndata: ${JSON.stringify(payload)}\n\n`;

function fakeLibrary(answer: string, asked: Array<Record<string, unknown>>, opts: { noAskTool?: boolean } = {}): ClientOptions {
  return {
    baseUrl: "https://library.example.test/mcp",
    token: "t",
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init.body));
      if (body.method === "initialize") return new Response("", { status: 200, headers: { "mcp-session-id": "s-1" } });
      if (body.method === "tools/list") {
        const tools = opts.noAskTool ? [{ name: "list_records" }] : [{ name: "ask_sera", inputSchema: { type: "object", properties: { question: { type: "string" }, owner_id: { type: "string" } }, required: ["question"] } }];
        return new Response(sse({ jsonrpc: "2.0", id: body.id, result: { tools } }), { status: 200 });
      }
      asked.push(body.params);
      return new Response(sse({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: answer }] } }), { status: 200 });
    },
  };
}

describe("makeSeraAsk", () => {
  it("asks ask_sera once, under the schema's own argument, with no person attached", async () => {
    const asked: Array<Record<string, unknown>> = [];
    const out = await makeSeraAsk(fakeLibrary('{"reply":"Open Game Mechanics."}', asked))("where are the rules?");
    // The client parses a JSON answer into an object; the reply shape must survive that.
    expect(out).toEqual({ ok: true, text: '{"reply":"Open Game Mechanics."}' });
    expect(asked).toEqual([{ name: "ask_sera", arguments: { question: "where are the rules?" } }]);
  });

  it("reads a prose answer as words, and a wrapped answer by its text field", async () => {
    expect(await makeSeraAsk(fakeLibrary("Open Game Mechanics, under the Platform group.", []))("q")).toEqual({ ok: true, text: "Open Game Mechanics, under the Platform group." });
    expect(seraReplyText({ answer: "Plain words." })).toBe("Plain words.");
    expect(seraReplyText({ reply: "x", open: null })).toBe('{"reply":"x","open":null}');
  });

  it("fails plainly when the service offers no ask_sera, and asks nothing", async () => {
    const asked: Array<Record<string, unknown>> = [];
    expect(await makeSeraAsk(fakeLibrary("x", asked, { noAskTool: true }))("q")).toEqual({ ok: false });
    expect(asked).toEqual([]);
  });

  it("fails plainly when the service cannot be reached", async () => {
    const down: ClientOptions = { baseUrl: "https://library.example.test/mcp", token: "t", fetchImpl: async () => { throw new Error("ECONNREFUSED"); } };
    expect(await makeSeraAsk(down)("q")).toEqual({ ok: false });
  });
});

describe("seraHelperQuestion", () => {
  const base = {
    guide: "Sera",
    village: "North Wind",
    openTab: { key: "home", label: "Home", group: "Today", help: "" },
    readings: [{ key: "admin.find", data: { pages: [{ key: "variables", label: "Game Mechanics" }] } }],
    conversation: [{ role: "user" as const, content: "where are the rules?" }],
  };

  it("carries the rules, the fenced readings, the open page, the conversation and the answer's shape", () => {
    const q = seraHelperQuestion(base);
    expect(q).toContain("You are Sera, helping an admin of North Wind");
    expect(q).toContain("you cannot help with selection");
    expect(q).toContain("Never draft, rank, compare or recommend anything about a candidate");
    expect(q).toContain("<village-data");
    expect(q).toContain("Game Mechanics");
    expect(q).toContain('The admin has "Home" open right now.');
    expect(q).toContain("Admin: where are the rules?");
    expect(q).toContain('{"reply": "<what you say>"');
  });

  it("stays under its ceiling by dropping the oldest turns first", () => {
    const conversation = Array.from({ length: 40 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", content: `turn-${i} ${"x".repeat(900)}` }));
    const q = seraHelperQuestion({ ...base, conversation });
    expect(q.length).toBeLessThanOrEqual(SERA_QUESTION_MAX + 1000);
    expect(q).toContain("turn-39");
    expect(q).not.toContain("turn-0 ");
  });

  it("sends the org chart's shape only when the question is about the org", () => {
    expect(asksAboutOrg("which roles are open in the land circle?")).toBe(true);
    expect(asksAboutOrg("how do I change the welcome email?")).toBe(false);
  });
});
