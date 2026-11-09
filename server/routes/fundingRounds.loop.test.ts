/**
 * FUNDING ROUNDS, THE LOOP (S3): grow, choose and harvest.
 *
 * Against a real scratch schema. A proposer shapes their idea in grow; members
 * tick in choose, and nobody sees anyone else's ticks until it closes; at
 * harvest both counts run once, the deciding count's quests get an earmark on
 * the pot and become quests on the board, and the disagreement between the
 * counts is kept in the round's record.
 *
 * The fixture makes the two counts disagree on purpose. One member holds
 * nearly all the counted Voice and ticks the tool shed; nine members with one
 * Voice each tick the seed bank. The pot holds 1,000,000 and each costs
 * 600,000, so only one fits: Voice funds the shed, the people fund the seed
 * bank. The cap is lifted for this pot so the arithmetic stays readable.
 *
 * Every person here is invented.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { loadModuleSettings, setModuleLifecycle } from "../lib/modules";
import { countBothWays } from "../../shared/equalShares";
import { register } from "./fundingRounds";

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

function collect() {
  const handlers = new Map<string, Handler>();
  const record = (method: string) => (p: string, handler: Handler) => handlers.set(`${method} ${p}`, handler);
  return {
    app: { get: record("GET"), post: record("POST"), put: record("PUT"), patch: record("PATCH"), delete: record("DELETE"), use: () => undefined } as any,
    handlers,
  };
}

const call = async (handlers: Map<string, Handler>, key: string, req: any = {}) => {
  const handler = handlers.get(key);
  if (!handler) throw new Error(`no handler registered for ${key}`);
  const out: { status: number; body: any } = { status: 200, body: undefined };
  const res: any = {
    status(code: number) { out.status = code; return res; },
    json(body: unknown) { out.body = body; return res; },
  };
  await handler({ params: {}, body: {}, query: {}, ...req }, res);
  return out;
};

const DAY = 86_400_000;
const at = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY);

const configured = testDbConfigured();

describe.skipIf(!configured)("funding rounds: grow, choose and harvest", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let whoami: string | null = null;
  let handlers: Map<string, Handler>;
  const as = (id: string | null) => { whoami = id; };
  const q = async (sql: string, params: unknown[] = []) => (await pool.query<any[]>(sql, params))[0]; // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  const people = Array.from({ length: 10 }, (_v, i) => ({ id: `m-${i}`, name: `Member${i} Fern` }));
  const quests: any[] = [];
  // m-0 holds nearly all the counted Voice; everyone else holds one.
  const voice = new Map(people.map((p, i) => [p.id, i === 0 ? 1000 : 1]));
  let potId = "";
  let roundId = "";
  let shed = "";
  let seeds = "";
  let lights = "";

  /** Move the round's dates so it sits in `stage` now. */
  const putRoundIn = async (stage: "grow" | "choose" | "harvest") => {
    const d = { grow: [-3, -2, 1, 2], choose: [-3, -2, -1, 1], harvest: [-4, -3, -2, -1] }[stage];
    await q("UPDATE funding_rounds SET seed_at = ?, grow_at = ?, choose_at = ?, harvest_at = ? WHERE id = ?", [at(d[0]), at(d[1]), at(d[2]), at(d[3]), roundId]);
  };

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    await loadModuleSettings(pool);
    await setModuleLifecycle("funding-rounds", "members", null, { sharedPasswordPosture: () => false });
    const c = collect();
    register(c.app, {
      authedUser: async () => (whoami ? { id: whoami } : null),
      getPool: () => pool,
      overLimit: async () => false,
      guardCapability: async (_req: any, res: any) => {
        if (whoami === "m-0") return true;
        res.status(403).json({ error: "not_yours" });
        return false;
      },
      mayAct: async () => ({ ok: whoami === "m-0" }),
      members: { all: async () => people, count: async () => people.length },
      // Saving a quest takes a moment, so two racing reads really do overlap.
      questsRepo: { add: async (quest: any) => { await new Promise((r) => setTimeout(r, 50)); quests.push(quest); }, all: async () => quests },
      electorate: async () => people.map((p) => ({ userId: p.id, weight: voice.get(p.id) ?? 0 })),
    } as any);
    handlers = c.handlers;

    as("m-0");
    const pot = await call(handlers, "POST /api/funding-rounds/pots", { body: { name: "Village pot", unitCode: "CRC" } });
    potId = pot.body.pot.id;
    await q("UPDATE funding_pots SET weight_cap_pct = 100 WHERE id = ?", [potId]);
    await q("INSERT INTO funding_pot_receipts (id, pot_id, amount_minor, note, recorded_by) VALUES ('rcpt-1', ?, 1000000, 'season dues', 'm-0')", [potId]);
    const round = await call(handlers, "POST /api/funding-rounds/pots/:id/rounds", { params: { id: potId }, body: { title: "Dry season", seedAt: at(-1).toISOString() } });
    roundId = round.body.round.id;
    const share = async (who: string, title: string) => {
      as(who);
      const out = await call(handlers, "POST /api/funding-rounds/rounds/:id/ideas", { params: { id: roundId }, body: { title, what: `${title}, for everyone` } });
      return out.body.idea.id as string;
    };
    shed = await share("m-0", "Tool shed");
    seeds = await share("m-1", "Seed bank");
    lights = await share("m-2", "Path lights");
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("lets only the author shape an idea, and only before choosing opens", async () => {
    await putRoundIn("grow");
    const shape = { deliverable: "A roofed shed with racks for the shared tools", askMinor: 600000 };
    as("m-1");
    expect((await call(handlers, "PATCH /api/funding-rounds/ideas/:id", { params: { id: shed }, body: shape })).status).toBe(403);
    as("m-0");
    const out = await call(handlers, "PATCH /api/funding-rounds/ideas/:id", { params: { id: shed }, body: shape });
    expect(out.status).toBe(200);
    expect(out.body.idea).toMatchObject({ status: "grown", askMinor: 600000, deliverable: shape.deliverable });
    as("m-1");
    const half = await call(handlers, "PATCH /api/funding-rounds/ideas/:id", { params: { id: seeds }, body: { deliverable: "A seed shelf" } });
    expect(half.body.idea.status).toBe("seed");
    expect((await call(handlers, "PATCH /api/funding-rounds/ideas/:id", { params: { id: seeds }, body: { askMinor: 600000 } })).body.idea.status).toBe("grown");
    expect((await call(handlers, "PATCH /api/funding-rounds/ideas/:id", { params: { id: seeds }, body: { askMinor: -5 } })).status).toBe(400);
  });

  it("lets the author withdraw an idea, which then stays off the ballot", async () => {
    as("m-2");
    const out = await call(handlers, "POST /api/funding-rounds/ideas/:id/withdraw", { params: { id: lights } });
    expect(out.status).toBe(200);
    expect(out.body.idea.status).toBe("withdrawn");
  });

  it("takes ticks only in choose, only on the ballot, and keeps them private until it closes", async () => {
    as("m-3");
    expect((await call(handlers, "PUT /api/funding-rounds/rounds/:id/marks", { params: { id: roundId }, body: { ideaIds: [seeds] } })).status).toBe(409);
    await putRoundIn("choose");
    expect((await call(handlers, "PUT /api/funding-rounds/rounds/:id/marks", { params: { id: roundId }, body: { ideaIds: [lights] } })).status).toBe(400);

    as("m-0");
    expect((await call(handlers, "PATCH /api/funding-rounds/ideas/:id", { params: { id: shed }, body: { askMinor: 1 } })).status).toBe(409);
    expect((await call(handlers, "PUT /api/funding-rounds/rounds/:id/marks", { params: { id: roundId }, body: { ideaIds: [shed] } })).body.myMarks).toEqual([shed]);
    for (let i = 1; i < 10; i++) {
      as(`m-${i}`);
      expect((await call(handlers, "PUT /api/funding-rounds/rounds/:id/marks", { params: { id: roundId }, body: { ideaIds: [seeds] } })).status).toBe(200);
    }
    // Changing your mind replaces your ticks.
    as("m-9");
    await call(handlers, "PUT /api/funding-rounds/rounds/:id/marks", { params: { id: roundId }, body: { ideaIds: [seeds, shed] } });
    expect((await call(handlers, "PUT /api/funding-rounds/rounds/:id/marks", { params: { id: roundId }, body: { ideaIds: [seeds] } })).body.myMarks).toEqual([seeds]);

    as("m-4");
    const view = await call(handlers, "GET /api/funding-rounds/rounds/:id", { params: { id: roundId } });
    expect(view.body.round.stage).toBe("choose");
    expect(view.body.myMarks).toEqual([seeds]);
    expect(view.body.ballot.map((i: any) => i.id).sort()).toEqual([seeds, shed].sort());
    expect(view.body.outcome).toBeNull();
    expect(JSON.stringify(view.body)).not.toMatch(/marks?Count|markedBy/);
  });

  it("at harvest runs both counts once, funds the deciding count, and keeps the disagreement", async () => {
    await putRoundIn("harvest");
    as("m-5");
    const view = await call(handlers, "GET /api/funding-rounds/rounds/:id", { params: { id: roundId } });
    const o = view.body.outcome;
    expect(o).toMatchObject({ quorumMet: true, decider: "power", availableMinor: 1000000, markers: 10, electorate: 10 });

    // The wiring, checked against the pure count on the same ballot.
    const marks = [{ voter: "m-0", option: shed }, ...people.slice(1).map((p) => ({ voter: p.id, option: seeds }))];
    const both = countBothWays({ pot: 1000000, voice, options: [{ id: shed, cost: 600000 }, { id: seeds, cost: 600000 }], marks, seed: o.seed, capPct: 100 });
    expect(o.power.funded).toEqual(both.power.funded);
    expect(o.people.funded).toEqual(both.people.funded);
    expect(o.power.funded).toEqual([shed]);
    expect(o.people.funded).toEqual([seeds]);
    expect(o.divergence).toEqual([
      { ideaId: shed, fundedBy: "power", costMinor: 600000 },
      { ideaId: seeds, fundedBy: "people", costMinor: 600000 },
    ]);

    // Ticks are shown with names once choosing has closed.
    const shown = view.body.ideas.find((i: any) => i.id === seeds);
    expect(shown.markedBy).toHaveLength(9);
    expect(shown.markedBy).toContain("Member1");
    expect(view.body.ideas.find((i: any) => i.id === shed).status).toBe("funded");
    expect(shown.status).toBe("not_funded");

    // One earmark, held, for the funded quest; the pot shows it.
    const earmarks = await q("SELECT * FROM funding_earmarks WHERE round_id = ?", [roundId]);
    expect(earmarks).toHaveLength(1);
    expect(earmarks[0]).toMatchObject({ idea_id: shed, amount_minor: 600000, status: "held" });
    expect(view.body.pot).toMatchObject({ balanceMinor: 1000000, earmarkedMinor: 600000, freeMinor: 400000 });

    // The funded idea is a quest on the board, priced as asked.
    expect(quests).toHaveLength(1);
    expect(quests[0]).toMatchObject({ title: "Tool shed", valueMinor: 600000, valueCurrency: "CRC", cashMinor: 600000, cashCurrency: "CRC", status: "Open" });
    expect(earmarks[0].quest_id).toBe(quests[0].id);
  });

  it("never counts twice: a second read finds the same outcome and no new earmark", async () => {
    as("m-6");
    const again = await call(handlers, "GET /api/funding-rounds/rounds/:id", { params: { id: roundId } });
    expect(again.body.outcome.power.funded).toEqual([shed]);
    expect(await q("SELECT * FROM funding_earmarks WHERE round_id = ?", [roundId])).toHaveLength(1);
    expect(quests).toHaveLength(1);
    expect((await call(handlers, "PUT /api/funding-rounds/rounds/:id/marks", { params: { id: roundId }, body: { ideaIds: [shed] } })).status).toBe(409);
  });

  it("funds nothing when too few members took part, and the pot keeps its money", async () => {
    as("m-0");
    const round = await call(handlers, "POST /api/funding-rounds/pots/:id/rounds", { params: { id: potId }, body: { title: "Quiet round", seedAt: at(-1).toISOString() } });
    const quiet = round.body.round.id as string;
    const idea = await call(handlers, "POST /api/funding-rounds/rounds/:id/ideas", { params: { id: quiet }, body: { title: "Bench", what: "A bench by the river" } });
    await q("UPDATE funding_round_ideas SET deliverable = 'A bench', ask_minor = 100000, status = 'grown' WHERE id = ?", [idea.body.idea.id]);
    await q("UPDATE funding_rounds SET seed_at = ?, grow_at = ?, choose_at = ?, harvest_at = ? WHERE id = ?", [at(-3), at(-2), at(-1), at(1), quiet]);
    await call(handlers, "PUT /api/funding-rounds/rounds/:id/marks", { params: { id: quiet }, body: { ideaIds: [idea.body.idea.id] } });
    await q("UPDATE funding_rounds SET harvest_at = ? WHERE id = ?", [at(-0.5), quiet]);
    const view = await call(handlers, "GET /api/funding-rounds/rounds/:id", { params: { id: quiet } });
    expect(view.body.outcome).toMatchObject({ quorumMet: false, markers: 1, electorate: 10 });
    expect(view.body.outcome.power.funded).toEqual([]);
    expect(await q("SELECT * FROM funding_earmarks WHERE round_id = ?", [quiet])).toHaveLength(0);
    // This round offers only what is free after the first round's earmark.
    expect(view.body.outcome.availableMinor).toBe(400000);
  });

  it("counts once when two members open a fresh harvest at the same moment", async () => {
    as("m-0");
    const round = await call(handlers, "POST /api/funding-rounds/pots/:id/rounds", { params: { id: potId }, body: { title: "Busy round", seedAt: at(-1).toISOString() } });
    const busy = round.body.round.id as string;
    const idea = await call(handlers, "POST /api/funding-rounds/rounds/:id/ideas", { params: { id: busy }, body: { title: "Rain barrels", what: "Barrels under every roof" } });
    const ideaId = idea.body.idea.id as string;
    await q("UPDATE funding_round_ideas SET deliverable = 'Six barrels', ask_minor = 100000, status = 'grown' WHERE id = ?", [ideaId]);
    await q("UPDATE funding_rounds SET seed_at = ?, grow_at = ?, choose_at = ?, harvest_at = ? WHERE id = ?", [at(-3), at(-2), at(-1), at(1), busy]);
    for (const p of people) {
      as(p.id);
      await call(handlers, "PUT /api/funding-rounds/rounds/:id/marks", { params: { id: busy }, body: { ideaIds: [ideaId] } });
    }
    await q("UPDATE funding_rounds SET harvest_at = ? WHERE id = ?", [at(-0.5), busy]);
    const before = quests.length;
    as("m-7");
    const [a, b] = await Promise.all([
      call(handlers, "GET /api/funding-rounds/rounds/:id", { params: { id: busy } }),
      call(handlers, "GET /api/funding-rounds/rounds/:id", { params: { id: busy } }),
    ]);
    expect(a.body.outcome?.power.funded ?? b.body.outcome?.power.funded).toEqual([ideaId]);
    expect(await q("SELECT * FROM funding_earmarks WHERE round_id = ?", [busy])).toHaveLength(1);
    // The quest is made once too, though the two reads may race on it.
    const again = await call(handlers, "GET /api/funding-rounds/rounds/:id", { params: { id: busy } });
    expect(again.body.ideas[0].questId).toBeTruthy();
    expect(quests.length - before).toBe(1);
  });
});
