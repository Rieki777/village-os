/**
 * WHO A MEMBER TALKS TO, as routes (Rye, 2026-10-24): a visitor is offered the
 * village guide only; a member's choice is saved in their own preferences
 * beside the rest and read back on every ask; a choice that cannot be honoured
 * falls back with a sentence saying so; and a stranger cannot save one.
 *
 * The second block runs against a real scratch schema, through the real users
 * repository, because the promise is "remembered", and only a row read back
 * proves that.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { usersRepo } from "../repos/users";
import { wireAssistant } from "../lib/assistant";
import { GUIDE_WORDS } from "@shared/guideChoice";
import { guideStateFor, register } from "./guideChoice";

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

function collect() {
  const handlers = new Map<string, Handler>();
  const record = (method: string) => (p: string, handler: Handler) => handlers.set(`${method} ${p}`, handler);
  return { app: { get: record("GET"), put: record("PUT") } as any, handlers };
}

async function call(handlers: Map<string, Handler>, key: string, req: any = {}) {
  const out: { status: number; body: any } = { status: 200, body: undefined };
  const res: any = {
    status(code: number) { out.status = code; return res; },
    json(body: unknown) { out.body = body; return res; },
  };
  const handler = handlers.get(key);
  if (!handler) throw new Error(`no handler registered for ${key}`);
  await handler({ params: {}, body: {}, query: {}, ...req }, res);
  return out;
}

const villageKeyed = (on: boolean) => wireAssistant({ villageKey: () => (on ? "test-village-key" : ""), rateLimited: async () => false });

afterEach(() => villageKeyed(false));

describe("the guide doors, without a database", () => {
  it("offers a visitor the village guide only, under the name the village gave it", () => {
    villageKeyed(true);
    const s = guideStateFor(null, "saberra", "Maia");
    expect(s.options.map((o) => o.id)).toEqual(["village"]);
    expect(s.options[0].name).toBe("Maia");
    expect(s.choice).toBeNull();
    expect(s.answering).toBe("village");
  });

  it("words an unnamed village guide for its reader: the village guide, or your village guide to a founder or admin", () => {
    villageKeyed(true);
    expect(guideStateFor({ role: "member" }, null, "  ").options[0]).toMatchObject({ name: "the village guide", named: false });
    expect(guideStateFor(null, null, "").options[0]).toMatchObject({ name: "the village guide", named: false });
    expect(guideStateFor({ role: "founder" }, null, "").options[0]).toMatchObject({ name: "your village guide", named: false });
    expect(guideStateFor({ role: "admin" }, null, null).options[0]).toMatchObject({ name: "your village guide", named: false });
    expect(guideStateFor({ role: "member" }, null, "Maia").options[0]).toMatchObject({ name: "Maia", named: true });
  });

  it("raises an unnamed guide's name to a capital only where it opens a sentence", () => {
    villageKeyed(true);
    const s = guideStateFor({ role: "member" }, "saberra", "");
    expect(s.note).toBe("Sera can't answer right now, so the village guide is answering.");
    expect(GUIDE_WORDS.answering(s.options[0].name)).toBe("The village guide is answering.");
    expect(GUIDE_WORDS.switchTo(s.options[0].name)).toBe("Talk to the village guide");
  });

  it("offers a member both guides, and the outside agent cannot answer while its module is off", () => {
    villageKeyed(true);
    const s = guideStateFor({ role: "member" }, "saberra", "Maia");
    expect(s.options.map((o) => [o.id, o.available])).toEqual([["village", true], ["saberra", false]]);
    expect(s.answering).toBe("village");
    expect(s.note).toBe(GUIDE_WORDS.fellBack("Sera", "Maia"));
    expect(s.canChoose).toBe(false);
  });

  it("answers with nobody when the village has no assistant key and the agent is unreachable", () => {
    expect(guideStateFor({ role: "member" }, null, "Maia").answering).toBeNull();
  });

  it("refuses a stranger's save, a guide that does not exist, and a member over the hour's limit", async () => {
    const stranger = collect();
    register(stranger.app, { authedUser: async () => null, members: {} as any, overLimit: async () => false, villageGuideName: () => "Maia" });
    expect((await call(stranger.handlers, "PUT /api/guide", { body: { guide: "village" } })).status).toBe(401);

    const member = collect();
    register(member.app, { authedUser: async () => ({ id: "u1", email: "u1@example.test" }), members: {} as any, overLimit: async () => false, villageGuideName: () => "Maia" });
    expect((await call(member.handlers, "PUT /api/guide", { body: { guide: "Sera" } })).status).toBe(400);

    const busy = collect();
    register(busy.app, { authedUser: async () => ({ id: "u1", email: "u1@example.test" }), members: {} as any, overLimit: async () => true, villageGuideName: () => "Maia" });
    expect((await call(busy.handlers, "PUT /api/guide", { body: { guide: "village" } })).status).toBe(429);
  });
});

describe.skipIf(!testDbConfigured())("the choice is remembered", () => {
  let db: TestDb;
  let pool: mysql.Pool;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("saves the member's choice in their preferences, keeps the rest, and reads it back", async () => {
    villageKeyed(true);
    const members = usersRepo(pool);
    await members.add({ id: "guide-member-1", name: "Wren Example", email: "wren@example.test", prefs: { notify: { digest: "weekly" } } });
    const { app, handlers } = collect();
    register(app, {
      authedUser: async () => members.byId("guide-member-1"),
      members,
      overLimit: async () => false,
      villageGuideName: () => "Maia",
    });

    const saved = await call(handlers, "PUT /api/guide", { body: { guide: "saberra" } });
    expect(saved.status).toBe(200);
    expect(saved.body.choice).toBe("saberra");

    const row = await members.byId("guide-member-1");
    expect(row?.prefs?.guide).toBe("saberra");
    expect(row?.prefs?.notify).toEqual({ digest: "weekly" });

    const read = await call(handlers, "GET /api/guide");
    expect(read.body.choice).toBe("saberra");
    // The agent cannot answer here (its module is off), so the village guide does, and says so.
    expect(read.body.answering).toBe("village");
    expect(read.body.note).toBe(GUIDE_WORDS.fellBack("Sera", "Maia"));

    await call(handlers, "PUT /api/guide", { body: { guide: "village" } });
    const back = await call(handlers, "GET /api/guide");
    expect(back.body).toMatchObject({ choice: "village", answering: "village", note: null });
  });
});
