/**
 * FUNDING ROUNDS ROUTES (S2): pots, rounds and the seed stage.
 *
 * The first block needs no database: every door answers 401 to a stranger,
 * and the steward doors ask the one gate for pot.steward. The second block
 * runs against a real scratch schema: a round takes ideas only in seed, an
 * anonymous idea never shows its author, the allowance holds, the village
 * must be big enough for the anonymous tick, each idea opens a forum thread,
 * the interaction record writes private rows for an anonymous author, and
 * erasure leaves the round's record de-attributed.
 *
 * Every person here is invented.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { loadModuleSettings, setModuleLifecycle } from "../lib/modules";
import { exportMemberFundingRounds, forgetMemberFundingRounds, fundingRoundsOpenState } from "../lib/fundingRounds";
import { register } from "./fundingRounds";

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

const ROUTES = [
  "GET /api/funding-rounds",
  "GET /api/funding-rounds/rounds/:id",
  "POST /api/funding-rounds/rounds/:id/ideas",
  "POST /api/funding-rounds/pots",
  "POST /api/funding-rounds/pots/:id/rounds",
  "PATCH /api/funding-rounds/rounds/:id/dates",
  "PATCH /api/funding-rounds/ideas/:id",
  "POST /api/funding-rounds/ideas/:id/withdraw",
  "PUT /api/funding-rounds/rounds/:id/marks",
  "POST /api/funding-rounds/ideas/:id/pledges",
  "DELETE /api/funding-rounds/pledges/:id",
];
const STEWARD_ROUTES = ["POST /api/funding-rounds/pots", "POST /api/funding-rounds/pots/:id/rounds", "PATCH /api/funding-rounds/rounds/:id/dates"];

function collect() {
  const handlers = new Map<string, Handler>();
  const mounts: string[] = [];
  const record = (method: string) => (p: string, handler: Handler) => handlers.set(`${method} ${p}`, handler);
  return {
    app: { get: record("GET"), post: record("POST"), put: record("PUT"), patch: record("PATCH"), delete: record("DELETE"), use: (p: string) => mounts.push(p) } as any,
    handlers,
    mounts,
  };
}

function makeRes() {
  const out: { status: number; body: any } = { status: 200, body: undefined };
  const res: any = {
    status(code: number) { out.status = code; return res; },
    json(body: unknown) { out.body = body; return res; },
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

interface Fake { id: string; name: string }

function deps(pool: any, who: () => string | null, opts: { stewards: Set<string>; people: () => Fake[]; asked?: string[] }) {
  return {
    authedUser: async () => (who() ? { id: who() } : null),
    getPool: () => pool,
    overLimit: async () => false,
    guardCapability: async (_req: any, res: any, cap: string) => {
      opts.asked?.push(cap);
      if (who() && opts.stewards.has(who() as string)) return true;
      res.status(403).json({ error: "not_yours" });
      return false;
    },
    mayAct: async () => ({ ok: Boolean(who() && opts.stewards.has(who() as string)) }),
    members: {
      all: async () => opts.people(),
      count: async () => opts.people().length,
    },
  } as any;
}

describe("funding rounds doors, no database", () => {
  it("registers every door behind the module", () => {
    const c = collect();
    register(c.app, deps(null, () => null, { stewards: new Set(), people: () => [] }));
    expect([...c.handlers.keys()].sort()).toEqual([...ROUTES].sort());
    expect(c.mounts).toContain("/api/funding-rounds");
  });

  it("answers 401 to a stranger at every door", async () => {
    const c = collect();
    register(c.app, deps(null, () => null, { stewards: new Set(), people: () => [] }));
    for (const key of ROUTES) expect((await call(c.handlers, key)).status, key).toBe(401);
  });

  it("asks the one gate for pot.steward at every steward door", async () => {
    const asked: string[] = [];
    const c = collect();
    register(c.app, deps(null, () => "m-someone", { stewards: new Set(), people: () => [], asked }));
    for (const key of STEWARD_ROUTES) expect((await call(c.handlers, key, { params: { id: "x" } })).status, key).toBe(403);
    expect(asked).toEqual(["pot.steward", "pot.steward", "pot.steward"]);
  });
});

const configured = testDbConfigured();

describe.skipIf(!configured)("funding rounds against a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let whoami: string | null = null;
  let handlers: Map<string, Handler>;
  let people: Fake[] = [];
  const as = (id: string | null) => { whoami = id; };
  const q = async (sql: string, params: unknown[] = []) => (await pool.query<any[]>(sql, params))[0]; // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  const ten: Fake[] = Array.from({ length: 10 }, (_v, i) => ({ id: `m-${i}`, name: `Member${i} Fern` }));
  let potId = "";
  let roundId = "";

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    await loadModuleSettings(pool);
    await setModuleLifecycle("funding-rounds", "members", null, { sharedPasswordPosture: () => false });
    await setModuleLifecycle("forum", "members", null, { sharedPasswordPosture: () => false });
    people = ten;
    const c = collect();
    register(c.app, deps(pool, () => whoami, { stewards: new Set(["m-0"]), people: () => people }));
    handlers = c.handlers;
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("lets the pot holder open a pot in any unit, and refuses a malformed currency", async () => {
    as("m-0");
    expect((await call(handlers, "POST /api/funding-rounds/pots", { body: { name: "Village pot", unitCode: "colones" } })).status).toBe(400);
    const made = await call(handlers, "POST /api/funding-rounds/pots", { body: { name: "Village pot", unitCode: "CRC", clock: "seasonal" } });
    expect(made.status).toBe(201);
    expect(made.body.pot).toMatchObject({ unit: "CRC", unitKind: "currency", clock: "seasonal", decider: "power", balanceMinor: 0, freeMinor: 0 });
    potId = made.body.pot.id;
    const token = await call(handlers, "POST /api/funding-rounds/pots", { body: { name: "Credits pot", unitKind: "token", unitCode: "credits" } });
    expect(token.body.pot).toMatchObject({ unit: "credits", unitKind: "token" });
  });

  it("tells the page who may hold the pot, and nobody else", async () => {
    as("m-0");
    expect((await call(handlers, "GET /api/funding-rounds")).body.canSteward).toBe(true);
    as("m-1");
    expect((await call(handlers, "GET /api/funding-rounds")).body.canSteward).toBe(false);
  });

  it("opens a seed-only round: with no grow date it stays in seed", async () => {
    as("m-0");
    const r = await call(handlers, "POST /api/funding-rounds/pots/:id/rounds", { params: { id: potId }, body: { title: "Next season", seedAt: new Date(Date.now() - 60_000).toISOString() } });
    expect(r.status).toBe(201);
    expect(r.body.round).toMatchObject({ stage: "seed", acceptsIdeas: true, growAt: null, stageEndsAt: null, anonymousOffered: true });
    roundId = r.body.round.id;
  });

  it("refuses dates that run backwards", async () => {
    as("m-0");
    const soon = Date.now() + 86_400_000;
    const bad = await call(handlers, "PATCH /api/funding-rounds/rounds/:id/dates", {
      params: { id: roundId },
      body: { growAt: new Date(soon * 1 + 3 * 86_400_000).toISOString(), chooseAt: new Date(soon).toISOString() },
    });
    expect(bad.status).toBe(400);
  });

  it("takes a named idea, opens its forum thread, and records the act", async () => {
    as("m-1");
    const out = await call(handlers, "POST /api/funding-rounds/rounds/:id/ideas", {
      params: { id: roundId },
      body: { title: "Seed bank", what: "A shelf of local seeds anyone can borrow", roughCostMinor: 3000000 },
    });
    expect(out.status).toBe(201);
    expect(out.body.idea).toMatchObject({ title: "Seed bank", byline: { kind: "named", text: "Member1" }, mine: true, status: "seed" });
    const [thread] = await q("SELECT * FROM forum_threads WHERE id = ?", [out.body.idea.threadId]);
    expect(thread.author_id).toBe("m-1");
    expect(thread.title).toBe("Idea: Seed bank");
    expect(String(thread.body)).toContain("Rough cost: CRC");
    const [ev] = await q("SELECT * FROM interaction_events WHERE subject_ref = ?", [out.body.idea.id]);
    expect(ev).toMatchObject({ actor_user_id: "m-1", kind: "idea.seeded", visibility: "members" });
  });

  it("never shows an anonymous idea's author: not in the view, not on its thread", async () => {
    as("m-2");
    const out = await call(handlers, "POST /api/funding-rounds/rounds/:id/ideas", {
      params: { id: roundId },
      body: { title: "Night path lights", what: "Solar lights on the path to the river", shownAs: "anonymous" },
    });
    expect(out.status).toBe(201);
    expect(out.body.idea.byline).toEqual({ kind: "anonymous", text: "a member" });
    const [thread] = await q("SELECT * FROM forum_threads WHERE id = ?", [out.body.idea.threadId]);
    expect(thread.author_id).toBe("m-0");
    expect(String(thread.body)).toContain("chose not to give their name");
    expect(String(thread.body)).not.toContain("Member2");
    const [ev] = await q("SELECT * FROM interaction_events WHERE subject_ref = ?", [out.body.idea.id]);
    expect(ev.visibility).toBe("private");

    as("m-3");
    const seen = await call(handlers, "GET /api/funding-rounds/rounds/:id", { params: { id: roundId } });
    const anon = seen.body.ideas.find((i: any) => i.title === "Night path lights");
    expect(anon.byline).toEqual({ kind: "anonymous", text: "a member" });
    expect(anon.mine).toBe(false);
    expect(JSON.stringify(seen.body)).not.toContain("m-2");
    as("m-2");
    const own = await call(handlers, "GET /api/funding-rounds/rounds/:id", { params: { id: roundId } });
    expect(own.body.ideas.find((i: any) => i.title === "Night path lights").mine).toBe(true);
  });

  it("holds each member to the round's allowance", async () => {
    as("m-4");
    const body = (t: string) => ({ params: { id: roundId }, body: { title: t, what: "Something useful" } });
    expect((await call(handlers, "POST /api/funding-rounds/rounds/:id/ideas", body("One"))).status).toBe(201);
    expect((await call(handlers, "POST /api/funding-rounds/rounds/:id/ideas", body("Two"))).status).toBe(201);
    const third = await call(handlers, "POST /api/funding-rounds/rounds/:id/ideas", body("Three"));
    expect(third.status).toBe(409);
    expect(third.body.error).toContain("2 ideas");
  });

  it("refuses the anonymous tick in a village too small for it to hold", async () => {
    people = ten.slice(0, 5);
    try {
      as("m-1");
      const out = await call(handlers, "POST /api/funding-rounds/rounds/:id/ideas", {
        params: { id: roundId },
        body: { title: "Quiet one", what: "Anything", shownAs: "anonymous" },
      });
      expect(out.status).toBe(400);
      const view = await call(handlers, "GET /api/funding-rounds/rounds/:id", { params: { id: roundId } });
      expect(view.body.round.anonymousOffered).toBe(false);
    } finally {
      people = ten;
    }
  });

  it("stops taking ideas once the round moves to grow", async () => {
    as("m-0");
    const r = await call(handlers, "POST /api/funding-rounds/pots/:id/rounds", {
      params: { id: potId },
      body: { title: "Past round", seedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(), growAt: new Date(Date.now() - 86_400_000).toISOString() },
    });
    // A grow date in the past is accepted at opening only through the round's own history; here it means grow.
    expect(r.body.round.stage).toBe("grow");
    as("m-5");
    const out = await call(handlers, "POST /api/funding-rounds/rounds/:id/ideas", { params: { id: r.body.round.id }, body: { title: "Late", what: "Too late" } });
    expect(out.status).toBe(409);
    // A round past seed holds the module on.
    expect((await fundingRoundsOpenState(pool)).count).toBe(1);
  });

  it("exports a member's own ideas, anonymous ones too", async () => {
    const out: any = await exportMemberFundingRounds(pool, "m-2");
    expect(out.ideas.map((i: any) => i.title)).toEqual(["Night path lights"]);
    expect(out.interactions).toHaveLength(1);
  });

  it("erases a member: seed ideas and private rows go, nothing names them", async () => {
    await forgetMemberFundingRounds(pool, "m-2");
    expect(await q("SELECT * FROM funding_round_ideas WHERE author_id = 'm-2'")).toEqual([]);
    expect(await q("SELECT * FROM interaction_events WHERE actor_user_id = 'm-2'")).toEqual([]);
    expect(await q("SELECT * FROM funding_round_ideas WHERE title = 'Night path lights'")).toEqual([]);
    await forgetMemberFundingRounds(pool, "m-1");
    const [ev] = await q("SELECT * FROM interaction_events WHERE kind = 'idea.seeded' AND actor_user_id IS NULL");
    expect(ev).toBeTruthy();
  });
});
