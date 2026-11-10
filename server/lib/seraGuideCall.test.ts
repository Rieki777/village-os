/**
 * Sera as a guide (server/lib/seraGuideCall.ts) and the engine's Sera road
 * (`callAssistant` with `sera`, server/lib/assistant.ts).
 */
import { afterEach, describe, expect, it } from "vitest";
import type { ClientOptions } from "./saberraClient";
import { SERA_QUESTION_MAX, makeSeraAsk, seraGuideQuestion, seraReplyText } from "./seraGuideCall";
import { callAssistant, wireAssistant } from "./assistant";

const sse = (payload: unknown) => `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
function fakeLibrary(answer: string, asked: Array<Record<string, unknown>>): ClientOptions {
  return {
    baseUrl: "https://library.example.test/mcp",
    token: "t",
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init.body));
      if (body.method === "initialize") return new Response("", { status: 200, headers: { "mcp-session-id": "s-1" } });
      if (body.method === "tools/list") {
        return new Response(sse({ jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "ask_sera", inputSchema: { type: "object", properties: { question: { type: "string" }, owner_id: { type: "string" } }, required: ["question"] } }] } }), { status: 200 });
      }
      asked.push(body.params);
      return new Response(sse({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: answer }] } }), { status: 200 });
    },
  };
}

afterEach(() => wireAssistant({ villageKey: () => "", rateLimited: async () => false }));

describe("the guide question", () => {
  it("carries the route's instructions, the fenced reads and the conversation, and never a name", () => {
    const q = seraGuideQuestion({
      system: "You are Sera. ALWAYS respond with JSON {\"reply\": \"...\"}",
      prefetch: [{ key: "journal.sitting", data: { answers: ["slept badly"] } }],
      conversation: [{ role: "user", content: "I'm tired" }, { role: "assistant", content: "Tell me more." }, { role: "user", content: "the bed is broken" }],
    });
    expect(q.startsWith("You are Sera.")).toBe(true);
    expect(q).toContain("<village-data");
    expect(q).toContain("slept badly");
    expect(q).toContain("Member: I'm tired");
    expect(q).toContain("You: Tell me more.");
    expect(q.trim().endsWith("Answer now, in the JSON shape the instructions above ask for.")).toBe(true);
  });

  it("drops the oldest turns to stay under its ceiling", () => {
    const conversation = Array.from({ length: 30 }, (_, i) => ({ role: "user" as const, content: `turn-${i} ${"x".repeat(1000)}` }));
    const q = seraGuideQuestion({ system: "S", prefetch: [], conversation });
    expect(q.length).toBeLessThan(SERA_QUESTION_MAX + 2000);
    expect(q).toContain("turn-29");
    expect(q).not.toContain("turn-0 ");
  });
});

describe("reading Sera's answer", () => {
  it("keeps a JSON reply the client already parsed, and reads words as words", async () => {
    expect(seraReplyText({ reply: "hi", draft: "" })).toBe('{"reply":"hi","draft":""}');
    expect(seraReplyText({ answer: "plain" })).toBe("plain");
    expect(seraReplyText("prose")).toBe("prose");
    const asked: Array<Record<string, unknown>> = [];
    expect(await makeSeraAsk(fakeLibrary('{"reply":"ok"}', asked))("q")).toEqual({ ok: true, text: '{"reply":"ok"}' });
    expect(asked).toEqual([{ name: "ask_sera", arguments: { question: "q" } }]);
  });
});

describe("the engine's Sera road", () => {
  const harness = (limited: (b: string) => boolean = () => false) => {
    const buckets: string[] = [];
    const posts: unknown[] = [];
    wireAssistant({
      villageKey: () => "village-key",
      rateLimited: async (b) => {
        buckets.push(b);
        return limited(b);
      },
      fetchImpl: (async (...a: unknown[]) => {
        posts.push(a);
        throw new Error("Anthropic must not be called on the Sera road");
      }) as unknown as typeof fetch,
    });
    return { buckets, posts };
  };

  it("asks Sera once, with the prefetch, spends the mode's day bucket, and no Anthropic call", async () => {
    const h = harness();
    const questions: string[] = [];
    const r = await callAssistant({
      mode: "journal",
      system: "SYSTEM",
      messages: [{ role: "user", content: "hello" }],
      model: "m",
      clientIp: "1.1.1.1",
      burstKey: "b:u1",
      prefetch: [{ key: "member.tasks", data: [{ id: "t1", title: "Water" }] }],
      tools: [{ name: "x", description: "x", input_schema: { type: "object", properties: {} } }],
      sera: async (q) => {
        questions.push(q);
        return { ok: true, text: '{"reply":"from sera"}' };
      },
    });
    expect(r).toMatchObject({ ok: true, text: '{"reply":"from sera"}', keySource: "sera", iterations: 1, toolsUsed: ["member.tasks"] });
    expect(questions.length).toBe(1);
    expect(questions[0]).toContain("SYSTEM");
    expect(questions[0]).toContain("Water");
    expect(h.posts).toEqual([]);
    expect(h.buckets).toEqual(["b:u1", expect.stringMatching(/^assistant-day:journal:/)]);
  });

  it("refuses when the burst guard or the day budget says so, and asks nothing", async () => {
    let asked = 0;
    const sera = async () => { asked += 1; return { ok: true as const, text: "x" }; };
    harness((b) => b === "b:u1");
    expect((await callAssistant({ mode: "journal", system: "S", messages: [{ role: "user", content: "h" }], model: "m", clientIp: "i", burstKey: "b:u1", sera })).ok).toBe(false);
    harness((b) => b.startsWith("assistant-day:"));
    expect(await callAssistant({ mode: "journal", system: "S", messages: [{ role: "user", content: "h" }], model: "m", clientIp: "i", burstKey: "b:u2", sera })).toEqual({ ok: false, status: 503, error: "assistant-unavailable" });
    expect(asked).toBe(0);
  });

  it("answers 502 when Sera cannot answer", async () => {
    harness();
    expect(await callAssistant({ mode: "journal", system: "S", messages: [{ role: "user", content: "h" }], model: "m", clientIp: "i", sera: async () => ({ ok: false }) })).toEqual({ ok: false, status: 502, error: "assistant-error" });
  });
});
