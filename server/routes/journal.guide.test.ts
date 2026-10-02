/**
 * The guide's and the shaper's own guards, with no database: what reaches the
 * provider, what comes back to the page, and which buckets are counted.
 *
 * Same seam as server/routes/journal.test.ts: `register` runs against a fake
 * Express, the provider is stubbed through `wireAssistant`, and the request it
 * would have received is read back. A member's own key and their recent
 * entries are stubbed at their modules, so each case controls exactly the
 * input it is about.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/identity", () => ({ instanceIdentity: () => ({ instanceId: "village-test", bornAt: "" }) }));

const hooks = vi.hoisted(() => ({
  memberKey: null as null | { provider: "anthropic"; key: string; baseUrl: null; model: null },
  recent: [] as unknown[],
}));
vi.mock("../lib/memberSecrets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/memberSecrets")>()),
  resolveMemberKey: async () => hooks.memberKey,
}));
vi.mock("../lib/journal", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/journal")>()),
  recentForGuide: async () => hooks.recent,
}));

import { GUIDE_MAX_MESSAGES } from "../../shared/journal";
import { MAX_TURNS, wireAssistant } from "../lib/assistant";
import { register } from "./journal";

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

function handlersFor(extra: Record<string, unknown> = {}, who = () => "m-ana") {
  const handlers = new Map<string, Handler>();
  const record = (method: string) => (p: string, h: Handler) => void handlers.set(`${method} ${p}`, h);
  const app: any = { get: record("GET"), post: record("POST"), put: record("PUT"), patch: record("PATCH"), delete: record("DELETE"), use: () => {} };
  const pool = {
    // The recipient said yes to feedback; every other read finds nothing.
    async query(sql: string) {
      return sql.includes("journal_feedback_prefs") ? [[{ open: 1, style: "gentle", note: "" }], []] : [[], []];
    },
  };
  register(app, {
    authedUser: async () => ({ id: who(), name: "A member" }),
    getPool: () => pool,
    clientIp: () => "10.0.0.1",
    overLimit: async () => false,
    seasonState: () => ({ current: null, seasons: [], timezone: "UTC" }),
    projectName: () => "Riverbend",
    members: { byId: async (id: string) => ({ id, name: "Ben Ortiz" }) },
    isPresent: () => true,
    claimsRepo: { forUser: async () => [] },
    ...extra,
  } as any);
  return async (key: string, body: unknown) => {
    const out: { status: number; body: any } = { status: 200, body: undefined };
    const res: any = {
      status(code: number) {
        out.status = code;
        return res;
      },
      json(b: unknown) {
        out.body = b;
        return res;
      },
    };
    await handlers.get(key)!({ params: {}, query: {}, body }, res);
    return out;
  };
}

/** A provider that answers `text`, recording each request and each burst bucket asked. */
function provider(text: string, opts: { stopReason?: string; limited?: (bucket: string, max: number) => boolean } = {}) {
  const bodies: any[] = [];
  const buckets: { bucket: string; max: number }[] = [];
  wireAssistant({
    villageKey: () => "test-key",
    rateLimited: async (bucket, max) => {
      buckets.push({ bucket, max });
      return opts.limited?.(bucket, max) ?? false;
    },
    fetchImpl: (async (_url: string, init: any) => {
      bodies.push(JSON.parse(init.body));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          content: [{ type: "text", text }],
          usage: { input_tokens: 1, output_tokens: 1 },
          stop_reason: opts.stopReason ?? "end_turn",
        }),
        text: async () => "",
      };
    }) as unknown as typeof fetch,
  });
  return { bodies, buckets };
}

const GUIDE = "POST /api/journal/guide";
const SHAPE = "POST /api/journal/feedback/shape";
const ask = (messages: unknown[] = [{ role: "user", content: "Today was long." }], answers: unknown[] = []) => ({
  practice: "evening",
  depth: "light",
  answers,
  messages,
});
const draft = {
  recipientId: "m-ben",
  observation: "The kitchen was left open on Sunday night.",
  feeling: "worried",
  need: "to know the food is safe",
  request: "Could we close it together at nine?",
};
const guideJson = (reply: string, nextQuestion = "", reflection = "") => JSON.stringify({ reply, nextQuestion, reflection });

beforeEach(() => {
  delete process.env.PLATFORM_ASSISTANT_KEY;
  hooks.memberKey = null;
  hooks.recent = [];
});

describe("an empty guide reply never reaches the conversation", () => {
  it("speaks the follow-up question when the reply came back empty", async () => {
    provider(guideJson("", "What made today feel heavy?"));
    const out = await handlersFor()(GUIDE, ask());
    expect(out.status).toBe(200);
    expect(out.body.reply).toBe("What made today feel heavy?");
    expect(out.body.nextQuestion).toBe("What made today feel heavy?");
  });

  it("speaks the fallback sentence when nothing came back at all", async () => {
    provider(guideJson(""));
    const out = await handlersFor()(GUIDE, ask());
    expect(out.status).toBe(200);
    expect(out.body.reply).toContain("I lost my words");
  });

  it("drops a blank turn a saved sitting already holds before it travels", async () => {
    const { bodies } = provider(guideJson("I am here."));
    const out = await handlersFor()(GUIDE, ask([
      { role: "user", content: "First." },
      { role: "assistant", content: "" },
      { role: "user", content: "Second." },
    ]));
    expect(out.status).toBe(200);
    expect(bodies[0].messages.map((m: any) => m.content)).toEqual(["First.", "Second."]);
  });

  it("refuses a conversation whose last turn is blank, and spends nothing", async () => {
    const { bodies } = provider(guideJson("I am here."));
    const out = await handlersFor()(GUIDE, ask([{ role: "user", content: "   " }]));
    expect(out.status).toBe(400);
    expect(bodies).toEqual([]);
  });
});

describe("the burst guard counts the member, never the house router", () => {
  /** A real sliding count per bucket, the way overLimit answers. */
  const counting = () => {
    const counts = new Map<string, number>();
    return (bucket: string, max: number) => {
      const n = counts.get(bucket) ?? 0;
      if (n >= max) return true;
      counts.set(bucket, n + 1);
      return false;
    };
  };

  it("lets a second member on the same network ask after the first has had a long evening", async () => {
    const { buckets } = provider(guideJson("I am here."), { limited: counting() });
    const ana = handlersFor({}, () => "m-ana");
    for (let i = 0; i < 31; i++) expect((await ana(GUIDE, ask())).status).toBe(200);
    const ben = await handlersFor({}, () => "m-ben")(GUIDE, ask());
    expect(ben.status).toBe(200);
    expect(buckets.filter((b) => b.bucket.startsWith("assist:")), "no network-wide bucket is counted").toEqual([]);
    expect(buckets).toContainEqual({ bucket: "assist-journal:m-ana", max: 80 });
    expect(buckets).toContainEqual({ bucket: "assist-journal:m-ben", max: 80 });
  });

  it("does the same for shaping feedback", async () => {
    const { buckets } = provider(JSON.stringify({ message: "When the kitchen was left open, I worried." }), {
      limited: (b) => b.startsWith("assist:"),
    });
    const out = await handlersFor()(SHAPE, draft);
    expect(out.status).toBe(200);
    expect(buckets[0]).toEqual({ bucket: "assist-journal:m-ana", max: 80 });
  });
});

describe("one member cannot spend the village's journal day", () => {
  const dayLimited = () => {
    const asked: { bucket: string; max: number; windowMs: number }[] = [];
    return {
      asked,
      overLimit: async (bucket: string, max: number, windowMs: number) => {
        asked.push({ bucket, max, windowMs });
        return bucket.startsWith("journal-member-day:");
      },
    };
  };

  it("refuses the guide and the shaper with a sentence once the member's day is spent, before any call", async () => {
    const { bodies } = provider(guideJson("I am here."));
    const day = dayLimited();
    const call = handlersFor({ overLimit: day.overLimit });
    const guide = await call(GUIDE, ask());
    expect(guide.status).toBe(429);
    expect(guide.body.error).toContain("rests until tomorrow");
    const shape = await call(SHAPE, draft);
    expect(shape.status).toBe(429);
    expect(shape.body.error).toContain("write the message yourself");
    expect(bodies).toEqual([]);
    const today = new Date().toISOString().slice(0, 10);
    expect(day.asked.filter((a) => a.bucket.startsWith("journal-member-day:"))).toEqual([
      { bucket: `journal-member-day:m-ana:${today}`, max: 40, windowMs: 24 * 60 * 60 * 1000 },
      { bucket: `journal-member-day:m-ana:${today}`, max: 40, windowMs: 24 * 60 * 60 * 1000 },
    ]);
  });

  it("never charges the day for a request it refuses as malformed", async () => {
    provider(guideJson("I am here."));
    const day = dayLimited();
    const out = await handlersFor({ overLimit: day.overLimit })(GUIDE, { practice: "nonsense", messages: [] });
    expect(out.status).toBe(400);
    expect(day.asked.some((a) => a.bucket.startsWith("journal-member-day:"))).toBe(false);
  });

  it("leaves a member who brought their own key to their own allowance", async () => {
    hooks.memberKey = { provider: "anthropic", key: "member-key", baseUrl: null, model: null };
    provider(guideJson("I am here."));
    const day = dayLimited();
    const out = await handlersFor({ overLimit: day.overLimit })(GUIDE, ask());
    expect(out.status).toBe(200);
    expect(day.asked.some((a) => a.bucket.startsWith("journal-member-day:"))).toBe(false);
  });
});

describe("the client's window and the engine's limit agree", () => {
  // The client trims each ask to GUIDE_MAX_MESSAGES. If it ever exceeded the
  // engine's MAX_TURNS, every ask past that length would be refused again.
  it("keeps the contract's window inside the engine's turn limit", () => {
    expect(GUIDE_MAX_MESSAGES).toBeLessThanOrEqual(MAX_TURNS);
  });
});

describe("what one guide turn carries has a ceiling", () => {
  it("bounds the sitting, the recent entries and the conversation, keeping every question and the newest entry", async () => {
    const { bodies } = provider(guideJson("I am here."));
    const answers = Array.from({ length: 20 }, (_, i) => ({
      questionKey: `q${i}`,
      prompt: `QSIT${String(i).padStart(2, "0")} ${"p".repeat(490)}`,
      text: "a".repeat(8000),
    }));
    hooks.recent = Array.from({ length: 10 }, (_, i) => ({
      date: `2026-09-${String(30 - i).padStart(2, "0")}`,
      practice: "evening",
      answers: Array.from({ length: 20 }, () => ({ question: `${i === 0 ? "NEWEST" : "OLDER"} ${"q".repeat(494)}`, answer: "r".repeat(400) })),
    }));
    const messages = Array.from({ length: 39 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `${i === 38 ? "LATEST" : "turn"} ${"m".repeat(3990)}`,
    }));
    const out = await handlersFor()(GUIDE, ask(messages, answers));
    expect(out.status).toBe(200);
    const system: string = bodies[0].system;
    expect(system.length, "the whole system prompt, prefetch included").toBeLessThan(30_000);
    for (let i = 0; i < 20; i++) expect(system).toContain(`QSIT${String(i).padStart(2, "0")}`);
    expect(system, "the newest entry is clipped, never dropped for an older one").toContain("NEWEST");
    expect(system).not.toContain("OLDER");
    const sent: { role: string; content: string }[] = bodies[0].messages;
    expect(sent.reduce((n, m) => n + m.content.length, 0)).toBeLessThanOrEqual(24_000);
    expect(sent[0].role).toBe("user");
    expect(sent[sent.length - 1].content.startsWith("LATEST")).toBe(true);
  });

  /*
   * Quotes and newlines are two characters each in JSON. A share counted in
   * raw characters let a sitting like this overflow its ceiling and lose its
   * last answers (13 of 20 kept, measured by the fix round's verifier).
   */
  it("keeps every answer of a sitting full of quotes and line breaks", async () => {
    const { bodies } = provider(guideJson("I am here."));
    const answers = Array.from({ length: 20 }, (_, i) => ({
      questionKey: `q${i}`,
      prompt: `QQ${String(i).padStart(2, "0")} "${"w".repeat(180)}"`,
      text: `ANS${String(i).padStart(2, "0")} ` + '"she said"\n'.repeat(700),
    }));
    const out = await handlersFor()(GUIDE, ask(undefined, answers));
    expect(out.status).toBe(200);
    const system: string = bodies[0].system;
    for (let i = 0; i < 20; i++) {
      expect(system).toContain(`QQ${String(i).padStart(2, "0")}`);
      expect(system).toContain(`ANS${String(i).padStart(2, "0")}`);
    }
  });
});

describe("what cannot be read as the guide's words is never shown", () => {
  it("keeps the reply of an answer the token cap cut off in its reflection", async () => {
    provider('{"reply": "I hear how much this weighs.", "nextQuestion": "What would help tonight?", "reflection": "You are tir', {
      stopReason: "max_tokens",
    });
    const out = await handlersFor()(GUIDE, ask());
    expect(out.body).toEqual({ reply: "I hear how much this weighs.", nextQuestion: "What would help tonight?", reflection: "" });
  });

  it("serves the fallback sentence for a reply cut off mid-sentence, with no fragment of it", async () => {
    provider('{"reply": "I hear how much', { stopReason: "max_tokens" });
    const out = await handlersFor()(GUIDE, ask());
    expect(out.body.reply).toContain("I lost my words");
    expect(JSON.stringify(out.body)).not.toContain("I hear how much");
  });

  it("reads valid JSON followed by prose holding a brace", async () => {
    // The last brace is in the prose, so slicing first-to-last brace fails.
    provider('{"reply":"That sounds steady.","nextQuestion":"","reflection":""}\nNote: see {above}');
    const out = await handlersFor()(GUIDE, ask());
    expect(out.body.reply).toBe("That sounds steady.");
  });

  it("still serves an answer the model gave in plain prose", async () => {
    provider("That sounds like a full day.");
    const out = await handlersFor()(GUIDE, ask());
    expect(out.body.reply).toBe("That sounds like a full day.");
  });

  it("gives the author no draft from a fragment, so they write it themselves", async () => {
    provider('{"message": ');
    expect((await handlersFor()(SHAPE, draft)).status).toBe(502);
    provider('{"message": "When the kitchen was left open, I', { stopReason: "max_tokens" });
    expect((await handlersFor()(SHAPE, draft)).status).toBe(502);
  });
});
