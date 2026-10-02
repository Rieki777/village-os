/**
 * The journal routes: who may reach which door, with a stub pool, and the
 * privacy line held against a real schema.
 *
 * `register` runs against a fake Express that records handlers by method and
 * path, the shape server/routes/needs.test.ts uses, so what runs is the real
 * registration and the real handler bodies. The module gate is recorded too
 * (`USE /api/journal`), and the cases below call handlers directly, as if the
 * module were on, because what they test is the handlers.
 *
 * THE PRIVACY CASES ASSERT ON THE WIRE. Each reads the JSON a second member,
 * or an admin, or a recipient actually receives, and looks for the words or
 * the id that must not be there. A test that checked a mapper would pass
 * while a new column rode a spread out to the page.
 *
 * The guide's provider is stubbed with `wireAssistant`, the seam
 * server/lib/assistant.test.ts uses, so the request the provider would have
 * received is read back and searched for another member's words.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/identity", () => ({ instanceIdentity: () => ({ instanceId: "village-test", bornAt: "" }) }));

import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { wireAssistant } from "../lib/assistant";
import { exportMemberJournal, forgetMemberJournal } from "../lib/journal";
import { loadVariables } from "../lib/variables";
import { guideSystemPrompt, register, shapeSystemPrompt } from "./journal";

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

const DOORS = [
  "GET /api/journal/practices",
  "GET /api/journal/entries",
  "POST /api/journal/entries",
  "PATCH /api/journal/entries/:id",
  "DELETE /api/journal/entries/:id",
  "POST /api/journal/guide",
  "GET /api/journal/pulse",
  "GET /api/journal/pulse/aggregate",
  "GET /api/journal/feedback/prefs",
  "PUT /api/journal/feedback/prefs",
  "GET /api/journal/feedback/people",
  "POST /api/journal/feedback/shape",
  "POST /api/journal/feedback",
  "GET /api/journal/feedback/sent",
  "POST /api/journal/feedback/:id/withdraw",
  "GET /api/journal/feedback/received",
  "POST /api/journal/feedback/:id/respond",
  "GET /api/journal/export.md",
];

function collect(): { app: any; handlers: Map<string, Handler>; mounts: string[] } {
  const handlers = new Map<string, Handler>();
  const mounts: string[] = [];
  const record = (method: string) => (p: string, handler: Handler) => {
    handlers.set(`${method} ${p}`, handler);
  };
  return {
    app: {
      get: record("GET"),
      post: record("POST"),
      put: record("PUT"),
      patch: record("PATCH"),
      delete: record("DELETE"),
      use: (p: string) => mounts.push(p),
    },
    handlers,
    mounts,
  };
}

function makeRes() {
  const out: { status: number; body: any; headers: Record<string, string>; text: string | null } = {
    status: 200,
    body: undefined,
    headers: {},
    text: null,
  };
  const res: any = {
    status(code: number) {
      out.status = code;
      return res;
    },
    json(body: unknown) {
      out.body = body;
      return res;
    },
    setHeader(k: string, v: string) {
      out.headers[k.toLowerCase()] = v;
    },
    send(text: string) {
      out.text = text;
      return res;
    },
  };
  return { res, out };
}

const call = async (handlers: Map<string, Handler>, key: string, req: any = {}) => {
  const handler = handlers.get(key);
  if (!handler) throw new Error(`no handler registered for ${key}`);
  const { res, out } = makeRes();
  await handler({ params: {}, body: {}, query: {}, ...req }, res);
  return out;
};

function deadPool() {
  const queries: string[] = [];
  return {
    queries,
    pool: {
      async query(sql: string) {
        queries.push(sql);
        return [[], []];
      },
    } as any,
  };
}

/** The people this village holds, as `members.byId` answers. */
const PEOPLE: Record<string, any> = {
  "m-ana": { id: "m-ana", name: "Ana Reyes" },
  "m-ben": { id: "m-ben", name: "Ben Ortiz" },
  "m-cai": { id: "m-cai", name: "Cai Moreno" },
  "m-dee": { id: "m-dee", name: "Dee Lund" },
  "m-founder": { id: "m-founder", name: "Founding Admin", role: "admin" },
  "m-gone": { id: "m-gone", name: "A departed member", gone: true },
};

function deps(pool: any, who: () => string | null, extra: Partial<Record<string, unknown>> = {}) {
  return {
    authedUser: async () => {
      const id = who();
      return id ? { ...(PEOPLE[id] ?? { id }), id } : null;
    },
    getPool: () => pool,
    clientIp: () => "10.0.0.1",
    overLimit: async () => false,
    seasonState: () => ({ current: { id: "s-autumn", name: "Autumn" }, seasons: [], timezone: "UTC" }),
    projectName: () => "Riverbend",
    members: { byId: async (id: string) => PEOPLE[id] ?? null },
    isPresent: (m: any) => !!m && !m.gone,
    claimsRepo: { forUser: async () => [{ questTitle: "Mend the long bench", status: "claimed" }] },
    ...extra,
  } as any;
}

/** A stand-in provider that records what it was asked and answers `reply`. */
function stubProvider(reply: unknown) {
  const bodies: any[] = [];
  wireAssistant({
    villageKey: () => "test-key",
    rateLimited: async () => false,
    fetchImpl: (async (_url: string, init: any) => {
      bodies.push(JSON.parse(init.body));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          content: [{ type: "text", text: typeof reply === "string" ? reply : JSON.stringify(reply) }],
          usage: { input_tokens: 12, output_tokens: 7 },
          stop_reason: "end_turn",
        }),
        text: async () => "",
      };
    }) as unknown as typeof fetch,
  });
  return bodies;
}

const OLD_KEY = process.env.PLATFORM_ASSISTANT_KEY;

beforeEach(() => {
  delete process.env.PLATFORM_ASSISTANT_KEY;
});
afterAll(() => {
  if (OLD_KEY === undefined) delete process.env.PLATFORM_ASSISTANT_KEY;
  else process.env.PLATFORM_ASSISTANT_KEY = OLD_KEY;
});

/* ========================================================================== *
 * The doors, with no database.
 * ========================================================================== */

describe("who may reach the journal", () => {
  it("registers exactly the contract's doors, behind the module gate", () => {
    const { app, handlers, mounts } = collect();
    register(app, deps(deadPool().pool, () => "m-ana"));
    expect([...handlers.keys()].sort()).toEqual([...DOORS].sort());
    expect(mounts).toEqual(["/api/journal"]);
  });

  /**
   * THE REFUSAL IS A MISSING HANDLER. No door on this module takes a member's
   * id to READ with, and none sits under /api/admin, so there is no URL an
   * admin could ask for another member's journal with.
   */
  it("registers no admin door and no door that names a member to read", () => {
    const { app, handlers } = collect();
    register(app, deps(deadPool().pool, () => "m-founder"));
    const doors = [...handlers.keys()];
    expect(doors.filter((d) => d.includes("/api/admin/"))).toEqual([]);
    expect(doors.filter((d) => /:userId|:user|:memberId|:recipient/.test(d))).toEqual([]);
    expect(doors.filter((d) => d.includes(":")).every((d) => d.endsWith(":id") || /:id\/(withdraw|respond)$/.test(d))).toBe(true);
  });

  it.each(DOORS)("refuses a stranger on %s, and never touches the database", async (key) => {
    const { app, handlers } = collect();
    const { pool, queries } = deadPool();
    register(app, deps(pool, () => null));
    const out = await call(handlers, key, { params: { id: "je-1" }, body: { practice: "free" } });
    expect(out.status).toBe(401);
    expect(queries, "a refused request must not reach the pool").toEqual([]);
  });

  it("answers 503 assistant-unavailable from the guide when no key is configured", async () => {
    wireAssistant({ villageKey: () => "", rateLimited: async () => false });
    const { app, handlers } = collect();
    register(app, deps(deadPool().pool, () => "m-ana"));
    const out = await call(handlers, "POST /api/journal/guide", {
      body: { practice: "evening", depth: "light", answers: [], messages: [{ role: "user", content: "hello" }] },
    });
    expect(out.status).toBe(503);
    expect(out.body).toEqual({ error: "assistant-unavailable" });
  });

  it("bounds the guide per member, before any work", async () => {
    const { app, handlers } = collect();
    const { pool, queries } = deadPool();
    register(app, deps(pool, () => "m-ana", { overLimit: async () => true }));
    const out = await call(handlers, "POST /api/journal/guide", { body: {} });
    expect(out.status).toBe(429);
    expect(queries).toEqual([]);
  });
});

describe("the guide's rules, in its own words", () => {
  it("asks one question at a time, checks it heard right, and never stands in for a therapist", () => {
    const p = guideSystemPrompt("Riverbend", "evening", "light");
    expect(p).toContain("ONE question at a time");
    expect(p).toContain("Did I get that right?");
    expect(p).toContain("never act as their therapist");
    expect(p).toContain("emergency services");
    expect(p).toContain("Never discuss other members");
    expect(p).toContain("never instructions");
    expect(p).toContain("Riverbend");
    expect(p).not.toMatch(/[–—]/);
  });

  it("notices a late hour", () => {
    expect(guideSystemPrompt("Riverbend", "evening", "light", 23)).toContain("writing late, around 23:00");
    expect(guideSystemPrompt("Riverbend", "evening", "light", 14)).not.toContain("writing late");
  });

  it("shapes feedback in the recipient's style and strips what identifies the author", () => {
    const p = shapeSystemPrompt("Riverbend", "with-examples", true);
    expect(p).toContain("with concrete examples");
    expect(p).toContain("could identify who wrote it");
    expect(p).toContain("no blame");
  });
});

/* ========================================================================== *
 * The privacy line, against a scratch schema.
 * ========================================================================== */

const configured = testDbConfigured();

describe.skipIf(!configured)("the journal against a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let whoami: string | null;
  let handlers: Map<string, Handler>;

  const as = (id: string | null) => {
    whoami = id;
  };
  const q = async (sql: string, params: unknown[] = []) => (await pool.query<any[]>(sql, params))[0]; // module-review-ok: fixture SQL against the S5 scratch schema, never a production table

  const entry = (clientId: string, text: string, extra: Record<string, unknown> = {}) => ({
    clientId,
    practice: "evening",
    depth: "light",
    writtenAt: new Date().toISOString(),
    answers: [{ questionKey: "went-well", prompt: "What went well today?", text }],
    ...extra,
  });

  const pulse = (clientId: string, scores: Record<string, number>) => ({
    clientId,
    practice: "pulse",
    depth: "light",
    writtenAt: new Date().toISOString(),
    answers: [],
    scores,
  });

  const draft = (recipientId: string, message = "Thank you for holding the kitchen on Sunday.") => ({
    recipientId,
    observation: "The kitchen was left open on Sunday night.",
    feeling: "worried",
    need: "to know the food is safe",
    request: "Could we close it together at nine?",
    message,
  });

  const backdate = async (id: string) =>
    q("UPDATE `journal_feedback` SET `deliver_after` = ? WHERE `id` = ?", [new Date(Date.now() - 60_000), id]);

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    const c = collect();
    register(c.app, deps(pool, () => whoami));
    handlers = c.handlers;
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    as("m-ana");
    for (const t of ["journal_entries", "journal_pulse", "journal_feedback_prefs", "journal_feedback", "assistant_usage"]) {
      await q(`DELETE FROM \`${t}\``);
    }
  });

  // ── Entries ──────────────────────────────────────────────────────────────

  it("shows an entry to its author and to nobody else, an admin included", async () => {
    const saved = await call(handlers, "POST /api/journal/entries", { body: entry("c-1", "I swam before sunrise") });
    expect(saved.status).toBe(200);
    const id = saved.body.id;
    const mine = await call(handlers, "GET /api/journal/entries");
    expect(mine.body.map((e: any) => e.id)).toEqual([id]);

    for (const other of ["m-ben", "m-founder"]) {
      as(other);
      const list = await call(handlers, "GET /api/journal/entries");
      expect(list.body, other).toEqual([]);
      expect(JSON.stringify(list.body)).not.toContain("sunrise");
      const edit = await call(handlers, "PATCH /api/journal/entries/:id", { params: { id }, body: { privacy: "clear" } });
      expect(edit.status, `${other} editing another member's entry`).toBe(404);
      expect(JSON.stringify(edit.body)).not.toContain("sunrise");
      const del = await call(handlers, "DELETE /api/journal/entries/:id", { params: { id } });
      expect(del.status, `${other} deleting another member's entry`).toBe(404);
      const md = await call(handlers, "GET /api/journal/export.md");
      expect(md.text ?? "").not.toContain("sunrise");
    }
    expect(await q("SELECT `privacy` FROM `journal_entries` WHERE `id` = ?", [id])).toEqual([{ privacy: "private" }]);
  });

  it("writes a retried save once, and answers the retry with the first row", async () => {
    const first = await call(handlers, "POST /api/journal/entries", { body: pulse("c-retry", { load: 4 }) });
    const again = await call(handlers, "POST /api/journal/entries", { body: pulse("c-retry", { load: 1 }) });
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(first.body.id);
    expect(again.body.scores).toEqual({ load: 4 });
    expect(await q("SELECT COUNT(*) AS n FROM `journal_entries`")).toEqual([{ n: 1 }]);
    // The retry moved no number either.
    expect(await q("SELECT `value` FROM `journal_pulse`")).toEqual([{ value: 4 }]);
  });

  /*
   * A LATE RETRY MAY NOT MOVE A NUMBER A LATER ENTRY REPLACED.
   *
   * The case the one above cannot see: it retries straight away, so the first
   * entry's numbers and the retry's are the same numbers. Here a second pulse
   * lands in between, and the retry of the first must leave its number alone.
   * The driver's CLIENT_FOUND_ROWS makes a duplicate report one affected row,
   * the same as an insert, so a store that read `affectedRows` would rewrite it.
   */
  it("lets a late retry of an older pulse leave the newer number standing", async () => {
    await call(handlers, "POST /api/journal/entries", { body: pulse("c-early", { load: 5 }) });
    await call(handlers, "POST /api/journal/entries", { body: pulse("c-later", { load: 2 }) });
    const retry = await call(handlers, "POST /api/journal/entries", { body: pulse("c-early", { load: 5 }) });
    expect(retry.status).toBe(200);
    expect(await q("SELECT `value` FROM `journal_pulse` WHERE `user_id` = 'm-ana'")).toEqual([{ value: 2 }]);
  });

  it("pages with a marker that keeps two entries written in the same second", async () => {
    const second = "2026-09-30T08:00:00.000Z";
    for (const c of ["c-a", "c-b", "c-c"]) {
      await call(handlers, "POST /api/journal/entries", { body: entry(c, `note ${c}`, { writtenAt: second }) });
    }
    await call(handlers, "POST /api/journal/entries", { body: entry("c-older", "older", { writtenAt: "2026-09-29T08:00:00.000Z" }) });
    const seen: string[] = [];
    let before: string | undefined;
    for (let page = 0; page < 5; page += 1) {
      const out = await call(handlers, "GET /api/journal/entries", { query: { limit: "2", ...(before ? { before } : {}) } });
      expect(out.status).toBe(200);
      if (out.body.length === 0) break;
      seen.push(...out.body.map((e: any) => e.clientId));
      const last = out.body[out.body.length - 1];
      before = `${last.writtenAt}|${last.id}`;
    }
    expect(seen).toHaveLength(4);
    expect(new Set(seen)).toEqual(new Set(["c-a", "c-b", "c-c", "c-older"]));
    expect(seen[3]).toBe("c-older");
    // A bare instant still works, and pages strictly before it.
    const bare = await call(handlers, "GET /api/journal/entries", { query: { before: second } });
    expect(bare.body.map((e: any) => e.clientId)).toEqual(["c-older"]);
  });

  it("confirms a reflection on edit, takes it back with null, and forgets an entry with its numbers", async () => {
    const saved = await call(handlers, "POST /api/journal/entries", { body: pulse("c-p", { energy: -1 }) });
    const id = saved.body.id;
    const confirmed = await call(handlers, "PATCH /api/journal/entries/:id", {
      params: { id },
      body: { reflection: "I gave more than I had." },
    });
    expect(confirmed.body.confirmed).toBe(true);
    const back = await call(handlers, "PATCH /api/journal/entries/:id", { params: { id }, body: { reflection: null } });
    expect(back.body.confirmed).toBe(false);
    expect(back.body.reflection).toBeNull();
    const gone = await call(handlers, "DELETE /api/journal/entries/:id", { params: { id } });
    expect(gone.status).toBe(200);
    expect(await q("SELECT COUNT(*) AS n FROM `journal_pulse`")).toEqual([{ n: 0 }]);
  });

  // ── The pulse ────────────────────────────────────────────────────────────

  it("withholds a week's average below a raised floor and shows it at the floor", async () => {
    try {
      await q(
        "INSERT INTO `game_variables` (`config_key`, `value`, `value_type`) VALUES ('journal.pulse_floor','4','text') " +
          "ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)",
      );
      await loadVariables(pool);
      for (const [who, load] of [["m-ana", 5], ["m-ben", 4], ["m-cai", 4]] as const) {
        as(who);
        await call(handlers, "POST /api/journal/entries", { body: pulse(`c-${who}`, { load }) });
      }
      as("m-dee");
      const three = await call(handlers, "GET /api/journal/pulse/aggregate");
      expect(three.body.floor).toBe(4);
      const load3 = three.body.weeks[0].cells.find((c: any) => c.metric === "load");
      expect(load3).toEqual({ metric: "load", n: null, mean: null, suppressed: true });

      await call(handlers, "POST /api/journal/entries", { body: pulse("c-m-dee", { load: 5 }) });
      const four = await call(handlers, "GET /api/journal/pulse/aggregate");
      const load4 = four.body.weeks[0].cells.find((c: any) => c.metric === "load");
      expect(load4).toEqual({ metric: "load", n: 4, mean: 4.5, suppressed: false });
      // Means and counts only: nobody's id reaches the wire.
      const wire = JSON.stringify(four.body);
      for (const who of ["m-ana", "m-ben", "m-cai", "m-dee"]) expect(wire).not.toContain(who);
    } finally {
      await q("DELETE FROM `game_variables` WHERE `config_key` = 'journal.pulse_floor'");
      await loadVariables(pool);
    }
  });

  it("shows a single member's week at the default floor, by ruling", async () => {
    await call(handlers, "POST /api/journal/entries", { body: pulse("c-solo", { confidence: 2, coherence: 4 }) });
    as("m-ben");
    const out = await call(handlers, "GET /api/journal/pulse/aggregate");
    expect(out.body.floor).toBe(1);
    const confidence = out.body.weeks[0].cells.find((c: any) => c.metric === "confidence");
    expect(confidence).toEqual({ metric: "confidence", n: 1, mean: 2, suppressed: false });
    expect(out.body.signals.map((s: any) => s.key)).toEqual(["confidence"]);
    // The member's own scores by week, for the member alone.
    as("m-ana");
    const own = await call(handlers, "GET /api/journal/pulse");
    expect(own.body).toHaveLength(1);
    expect(own.body[0].scores).toEqual({ confidence: 2, coherence: 4 });
    as("m-ben");
    expect((await call(handlers, "GET /api/journal/pulse")).body).toEqual([]);
  });

  // ── Feedback ─────────────────────────────────────────────────────────────

  it("refuses feedback to somebody who has not said yes, and to oneself", async () => {
    const closed = await call(handlers, "POST /api/journal/feedback", { body: draft("m-ben") });
    expect(closed.status).toBe(409);
    as("m-ben");
    await call(handlers, "PUT /api/journal/feedback/prefs", { body: { open: false, style: "gentle" } });
    as("m-ana");
    expect((await call(handlers, "POST /api/journal/feedback", { body: draft("m-ben") })).status).toBe(409);
    await call(handlers, "PUT /api/journal/feedback/prefs", { body: { open: true, style: "direct" } });
    const self = await call(handlers, "POST /api/journal/feedback", { body: draft("m-ana") });
    expect(self.status).toBe(400);
    expect(await q("SELECT COUNT(*) AS n FROM `journal_feedback`")).toEqual([{ n: 0 }]);
  });

  it("holds one message per author per recipient per week", async () => {
    for (const who of ["m-ben", "m-cai"]) {
      as(who);
      await call(handlers, "PUT /api/journal/feedback/prefs", { body: { open: true, style: "gentle", note: "kindly" } });
    }
    as("m-ana");
    const people = await call(handlers, "GET /api/journal/feedback/people");
    expect(people.body.map((p: any) => p.id)).toEqual(["m-ben", "m-cai"]);
    const first = await call(handlers, "POST /api/journal/feedback", { body: draft("m-ben") });
    expect(first.status).toBe(200);
    expect(first.body.status).toBe("queued");
    expect(first.body.delivered).toBe(false);
    expect(first.body.recipientName).toBe("Ben Ortiz");
    const second = await call(handlers, "POST /api/journal/feedback", { body: draft("m-ben", "And another thing.") });
    expect(second.status).toBe(409);
    expect(second.body.error).toContain("this week");
    // The cap is per recipient: somebody else is still reachable.
    expect((await call(handlers, "POST /api/journal/feedback", { body: draft("m-cai") })).status).toBe(200);
  });

  it("hides a message until its batch, then shows it with no author at any depth", async () => {
    as("m-ben");
    await call(handlers, "PUT /api/journal/feedback/prefs", { body: { open: true, style: "gentle" } });
    as("m-ana");
    const sent = await call(handlers, "POST /api/journal/feedback", { body: draft("m-ben") });
    const id = sent.body.id;
    expect(new Date(sent.body.deliverAfter).getTime() - Date.now()).toBeGreaterThan(47 * 60 * 60 * 1000);

    as("m-ben");
    expect((await call(handlers, "GET /api/journal/feedback/received")).body).toEqual([]);
    await backdate(id);
    const received = await call(handlers, "GET /api/journal/feedback/received");
    expect(received.body).toHaveLength(1);
    expect(Object.keys(received.body[0]).sort()).toEqual(["deliveredAt", "id", "message", "response"]);
    const wire = JSON.stringify(received.body);
    expect(wire).not.toContain("m-ana");
    expect(wire).not.toContain("Ana");
    expect(wire.toLowerCase()).not.toContain("author");
    // The four parts stay the author's: the recipient reads the approved words only.
    expect(wire).not.toContain("worried");

    const thanks = await call(handlers, "POST /api/journal/feedback/:id/respond", {
      params: { id },
      body: { response: "thanks" },
    });
    expect(thanks.body.response).toBe("thanks");
    expect(JSON.stringify(thanks.body)).not.toContain("m-ana");
    // Only the recipient answers it.
    as("m-ana");
    const notMine = await call(handlers, "POST /api/journal/feedback/:id/respond", {
      params: { id },
      body: { response: "not-useful" },
    });
    expect(notMine.status).toBe(404);

    // The leaving export carries the same three facts and nothing else.
    const exported = await exportMemberJournal(pool, "m-ben");
    expect(exported.feedbackReceived).toEqual([
      { message: draft("m-ben").message, deliveredAt: received.body[0].deliveredAt, response: "thanks" },
    ]);
    expect(JSON.stringify(exported)).not.toContain("m-ana");
  });

  it("lets the author withdraw before the batch and not after, and nobody else at all", async () => {
    for (const who of ["m-ben", "m-cai"]) {
      as(who);
      await call(handlers, "PUT /api/journal/feedback/prefs", { body: { open: true, style: "gentle" } });
    }
    as("m-ana");
    const early = await call(handlers, "POST /api/journal/feedback", { body: draft("m-ben") });
    const late = await call(handlers, "POST /api/journal/feedback", { body: draft("m-cai") });

    as("m-ben");
    const stranger = await call(handlers, "POST /api/journal/feedback/:id/withdraw", { params: { id: early.body.id } });
    expect(stranger.status).toBe(404);

    as("m-ana");
    const withdrawn = await call(handlers, "POST /api/journal/feedback/:id/withdraw", { params: { id: early.body.id } });
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body.status).toBe("withdrawn");

    await backdate(late.body.id);
    const tooLate = await call(handlers, "POST /api/journal/feedback/:id/withdraw", { params: { id: late.body.id } });
    expect(tooLate.status).toBe(409);
    as("m-cai");
    expect((await call(handlers, "GET /api/journal/feedback/received")).body).toHaveLength(1);
    as("m-ben");
    expect((await call(handlers, "GET /api/journal/feedback/received")).body).toEqual([]);
  });

  // ── The guide ────────────────────────────────────────────────────────────

  it("grounds the guide in the member's own entries, never another member's, and records the spend", async () => {
    await call(handlers, "POST /api/journal/entries", { body: entry("c-own", "my own garden note") });
    as("m-ben");
    await call(handlers, "POST /api/journal/entries", { body: entry("c-ben", "bens private worry") });
    as("m-ana");
    const bodies = stubProvider({ reply: "That sounds steady.", nextQuestion: "What helped?", reflection: "You kept a rhythm." });
    const out = await call(handlers, "POST /api/journal/guide", {
      body: {
        practice: "evening",
        depth: "light",
        localHour: 23,
        answers: [{ questionKey: "went-well", prompt: "What went well today?", text: "the bread" }],
        messages: [{ role: "user", content: "I answered emails until late." }],
      },
    });
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ reply: "That sounds steady.", nextQuestion: "What helped?", reflection: "You kept a rhythm." });
    const asked = JSON.stringify(bodies[0]);
    expect(asked).toContain("my own garden note");
    expect(asked).toContain("Mend the long bench");
    expect(asked).toContain("writing late");
    expect(asked).not.toContain("bens private worry");
    expect(bodies[0].tools, "the journal guide is offered no tools").toBeUndefined();
    const usage = await q("SELECT `mode`, `user_id`, `path` FROM `assistant_usage`");
    expect(usage).toEqual([{ mode: "journal", user_id: "m-ana", path: "prefetch" }]);
  });

  it("shapes feedback only toward somebody who said yes, and saves nothing", async () => {
    const bodies = stubProvider({ message: "When the kitchen was left open, I worried. Could we close it together?" });
    const refused = await call(handlers, "POST /api/journal/feedback/shape", { body: draft("m-ben") });
    expect(refused.status).toBe(409);
    expect(bodies).toHaveLength(0);
    as("m-ben");
    await call(handlers, "PUT /api/journal/feedback/prefs", { body: { open: true, style: "direct", note: "short please" } });
    as("m-ana");
    const shaped = await call(handlers, "POST /api/journal/feedback/shape", { body: draft("m-ben") });
    expect(shaped.status).toBe(200);
    expect(shaped.body.message).toContain("kitchen");
    expect(bodies[0].system).toContain("straight to the point");
    expect(JSON.stringify(bodies[0])).toContain("short please");
    expect(await q("SELECT COUNT(*) AS n FROM `journal_feedback`")).toEqual([{ n: 0 }]);
  });

  // ── Leaving ──────────────────────────────────────────────────────────────

  it("exports markdown notes with frontmatter, and forgets every row on erasure", async () => {
    await call(handlers, "POST /api/journal/entries", {
      body: {
        ...entry("c-d", "We open the kitchen on Sundays."),
        practice: "debrief",
        answers: [{ questionKey: "decided", prompt: "What got decided?", text: "We open the kitchen on Sundays." }],
        meta: { call: "Weekly call", seats: ["kitchen"], portable: true },
        reflection: "Sundays, because people asked.",
      },
    });
    const md = await call(handlers, "GET /api/journal/export.md");
    expect(md.headers["content-type"]).toContain("text/markdown");
    expect(md.text).toMatch(/^---\ndate: \d{4}-\d{2}-\d{2}\npractice: debrief\ndepth: light\ncall: "Weekly call"\n/);
    expect(md.text).toContain("confirmed_by_author: true");
    expect(md.text).toContain("tags: [journal, debrief]");
    expect(md.text).toContain("## What got decided?\n\nWe open the kitchen on Sundays.");
    expect(md.text).toContain("## Reflection\n\nSundays, because people asked.");

    await call(handlers, "POST /api/journal/entries", { body: pulse("c-p", { load: 3 }) });
    await call(handlers, "PUT /api/journal/feedback/prefs", { body: { open: true, style: "gentle" } });
    as("m-ben");
    await call(handlers, "PUT /api/journal/feedback/prefs", { body: { open: true, style: "gentle" } });
    await call(handlers, "POST /api/journal/feedback", { body: draft("m-ana") });
    as("m-ana");
    await call(handlers, "POST /api/journal/feedback", { body: draft("m-ben") });

    const named = async () =>
      (await q(
        "SELECT (SELECT COUNT(*) FROM `journal_entries` WHERE `user_id` = 'm-ana') AS e, " +
          "(SELECT COUNT(*) FROM `journal_pulse` WHERE `user_id` = 'm-ana') AS p, " +
          "(SELECT COUNT(*) FROM `journal_feedback_prefs` WHERE `user_id` = 'm-ana') AS f, " +
          "(SELECT COUNT(*) FROM `journal_feedback` WHERE `author_id` = 'm-ana' OR `recipient_id` = 'm-ana') AS b",
      ))[0];
    expect(await named()).toEqual({ e: 2, p: 1, f: 1, b: 2 });
    expect(await forgetMemberJournal(pool, "m-ana")).toBe(6);
    expect(await named()).toEqual({ e: 0, p: 0, f: 0, b: 0 });
    // Ben keeps his own yes.
    expect(await q("SELECT `user_id` FROM `journal_feedback_prefs`")).toEqual([{ user_id: "m-ben" }]);
  });
});
