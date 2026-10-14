import { describe, expect, it, vi } from "vitest";
import type { AssistantRequest, AssistantResult } from "../assistant";
import { polishRecap, RECAP_POLISH_MODE } from "./recapPolish";

/**
 * "Draft it for me", polished (the comms build spec 5.14). The assistant is
 * stood in for by a recording function, so nothing here reaches a provider.
 * What is pinned: it only runs with notes and a key, it hands the facts over
 * prefetched on the existing call path, and anything it cannot trust falls
 * back to the plain draft, which is what `null` means to the route.
 */

const pool = { query: vi.fn(async () => [[], []]) } as any;
const DRAFT = "2 of us came to Seed swap on Sunday, October 5.\n\nWe sorted the seed bank.\n\nThank you to everyone who came.";

const ok = (text: string, stopReason: string | null = "end_turn"): AssistantResult => ({
  ok: true,
  text,
  keySource: "village",
  usage: { input_tokens: 10, output_tokens: 20 } as any,
  stopReason,
  iterations: 1,
  toolsUsed: ["recap.draft"],
});

function caller(answer: AssistantResult) {
  const calls: AssistantRequest[] = [];
  return { calls, call: async (req: AssistantRequest) => (calls.push(req), answer) };
}

const input = { draft: DRAFT, notes: "We sorted the seed bank.", userId: "u-host", clientIp: "127.0.0.1" };

describe("polishing the host's recap", () => {
  it("asks the assistant on the existing path, facts prefetched, and serves its words", async () => {
    const polished = "2 of us came to Seed swap on Sunday, October 5.\n\nWe spent the afternoon sorting the seed bank together.";
    const { calls, call } = caller(ok(JSON.stringify({ recap: polished })));
    expect(await polishRecap({ getPool: () => pool, call, ready: () => true }, input)).toBe(polished);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ mode: RECAP_POLISH_MODE, burstKey: "assist-recap:u-host", userId: "u-host" });
    expect(calls[0].prefetch).toEqual([{ key: "recap.draft", data: { draft: DRAFT, notes: "We sorted the seed bank." } }]);
  });

  it("does nothing with no notes, or with no assistant set", async () => {
    const { calls, call } = caller(ok(JSON.stringify({ recap: "x" })));
    expect(await polishRecap({ getPool: () => pool, call, ready: () => true }, { ...input, notes: "   " })).toBeNull();
    expect(await polishRecap({ getPool: () => pool, call, ready: () => false }, input)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("serves the plain draft when the assistant refuses, is cut off, or writes what the voice check refuses", async () => {
    const refused = caller({ ok: false, status: 429, error: "Slow down a moment, then keep going." });
    expect(await polishRecap({ getPool: () => pool, call: refused.call, ready: () => true }, input)).toBeNull();
    const cut = caller(ok('{"recap": "We sorted the se', "max_tokens"));
    expect(await polishRecap({ getPool: () => pool, call: cut.call, ready: () => true }, input)).toBeNull();
    const filler = caller(ok(JSON.stringify({ recap: "A vibrant afternoon of seed sorting." })));
    expect(await polishRecap({ getPool: () => pool, call: filler.call, ready: () => true }, input)).toBeNull();
  });

  it("turns a dash between clauses into a comma", async () => {
    const { call } = caller(ok(JSON.stringify({ recap: "We sorted the seed bank — all of it." })));
    expect(await polishRecap({ getPool: () => pool, call, ready: () => true }, input)).toBe("We sorted the seed bank, all of it.");
  });
});
