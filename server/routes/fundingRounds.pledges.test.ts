/**
 * FUNDING ROUNDS, BACKING PLEDGES (S3b, plan §18 and R19).
 *
 * Against a real scratch schema. Any member may back a quest at any stage
 * with a pledge, shown openly with their name. A pledge can be withdrawn
 * until choosing closes, and the withdrawal stays visible. When choosing
 * closes, the standing pledges on the ballot turn FIRM and lower what the pot
 * must cover: the count uses ask minus firm pledges, and the earmark is that
 * remainder. A quest its backers cover whole is "backer-funded" and goes
 * ahead without the count (the plan's suggested answer to Q-B6). Pledges on
 * an idea that was not funded, or never reached the ballot, go back to the
 * backer. A pledge made in harvest on a funded quest is firm at once and
 * lowers its earmark.
 *
 * No money moves here: collecting a pledge waits on Rye's Q-B1, and equity on
 * completion waits on the economics lane's issueInvestment.
 *
 * Every person here is invented.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { loadModuleSettings, setModuleLifecycle } from "../lib/modules";
import { exportMemberFundingRounds, forgetMemberFundingRounds } from "../lib/fundingRounds";
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

describe.skipIf(!configured)("funding rounds: backing pledges", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let whoami: string | null = null;
  let handlers: Map<string, Handler>;
  const as = (id: string | null) => { whoami = id; };
  const q = async (sql: string, params: unknown[] = []) => (await pool.query<any[]>(sql, params))[0]; // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  const people = Array.from({ length: 10 }, (_v, i) => ({ id: `m-${i}`, name: `Member${i} Fern` }));
  const quests: any[] = [];
  let roundId = "";
  let shed = ""; // asks 600,000; m-6 backs 100,000
  let seeds = ""; // asks 600,000; m-5 backs it whole
  let bench = ""; // never shaped, so never on the ballot; m-7 backs 50,000
  let firstPledge = "";

  const putRoundIn = async (stage: "grow" | "choose" | "harvest") => {
    const d = { grow: [-3, -2, 1, 2], choose: [-3, -2, -1, 1], harvest: [-4, -3, -2, -1] }[stage];
    await q("UPDATE funding_rounds SET seed_at = ?, grow_at = ?, choose_at = ?, harvest_at = ? WHERE id = ?", [at(d[0]), at(d[1]), at(d[2]), at(d[3]), roundId]);
  };
  const back = (who: string, ideaId: string, amountMinor: unknown) => {
    as(who);
    return call(handlers, "POST /api/funding-rounds/ideas/:id/pledges", { params: { id: ideaId }, body: { amountMinor } });
  };
  const view = async () => (await call(handlers, "GET /api/funding-rounds/rounds/:id", { params: { id: roundId } })).body;

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
      questsRepo: { add: async (quest: any) => { quests.push(quest); }, all: async () => quests },
      electorate: async () => people.map((p) => ({ userId: p.id, weight: 1 })),
    } as any);
    handlers = c.handlers;

    as("m-0");
    const pot = await call(handlers, "POST /api/funding-rounds/pots", { body: { name: "Village pot", unitCode: "CRC" } });
    await q("INSERT INTO funding_pot_receipts (id, pot_id, amount_minor, note, recorded_by) VALUES ('rcpt-1', ?, 1000000, 'dues', 'm-0')", [pot.body.pot.id]);
    const round = await call(handlers, "POST /api/funding-rounds/pots/:id/rounds", { params: { id: pot.body.pot.id }, body: { title: "Dry season", seedAt: at(-1).toISOString() } });
    roundId = round.body.round.id;
    const share = async (who: string, title: string) => {
      as(who);
      return (await call(handlers, "POST /api/funding-rounds/rounds/:id/ideas", { params: { id: roundId }, body: { title, what: `${title} for all` } })).body.idea.id as string;
    };
    shed = await share("m-1", "Tool shed");
    seeds = await share("m-2", "Seed bank");
    bench = await share("m-3", "River bench");
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("takes a pledge from any member in seed, and shows it openly with their name", async () => {
    expect((await back("m-5", seeds, 0)).status).toBe(400);
    expect((await back("m-5", seeds, "lots")).status).toBe(400);
    const out = await back("m-5", seeds, 600000);
    expect(out.status).toBe(201);
    expect(out.body.pledge).toMatchObject({ amountMinor: 600000, status: "pledged", stageAtPledge: "seed" });
    expect(out.body.pledge.id).toMatch(/^pledge-[0-9a-f]{20}$/);
    firstPledge = out.body.pledge.id;
    expect((await back("m-7", bench, 50000)).status).toBe(201);
    as("m-4");
    const seen = (await view()).ideas.find((i: any) => i.id === seeds);
    expect(seen.backing).toMatchObject({ pledgedMinor: 600000, backers: 1, firmMinor: 0, withdrawnMinor: 0, mine: null });
    expect(seen.backing.pledges).toEqual([{ id: firstPledge, name: "Member5", amountMinor: 600000, status: "pledged" }]);
    as("m-5");
    expect((await view()).ideas.find((i: any) => i.id === seeds).backing.mine).toMatchObject({ id: firstPledge, status: "pledged" });
  });

  it("lets only the backer withdraw, keeps the withdrawal visible, and takes a new pledge in grow", async () => {
    await putRoundIn("grow");
    const extra = await back("m-6", shed, 250000);
    as("m-1");
    expect((await call(handlers, "DELETE /api/funding-rounds/pledges/:id", { params: { id: extra.body.pledge.id } })).status).toBe(403);
    as("m-6");
    const gone = await call(handlers, "DELETE /api/funding-rounds/pledges/:id", { params: { id: extra.body.pledge.id } });
    expect(gone.status).toBe(200);
    expect(gone.body.pledge.status).toBe("withdrawn");
    expect((await back("m-6", shed, 100000)).status).toBe(201);
    const s = (await view()).ideas.find((i: any) => i.id === shed);
    expect(s.backing).toMatchObject({ pledgedMinor: 100000, backers: 1, withdrawnMinor: 250000 });
    expect(s.backing.pledges.map((p: any) => p.status).sort()).toEqual(["pledged", "withdrawn"]);
  });

  it("shapes two quests, and everyone ticks the shed in choose", async () => {
    as("m-1");
    await call(handlers, "PATCH /api/funding-rounds/ideas/:id", { params: { id: shed }, body: { deliverable: "A roofed shed", askMinor: 600000 } });
    as("m-2");
    await call(handlers, "PATCH /api/funding-rounds/ideas/:id", { params: { id: seeds }, body: { deliverable: "A seed shelf", askMinor: 600000 } });
    await putRoundIn("choose");
    // A pledge made while choosing can still be withdrawn until it closes.
    const late = await back("m-8", shed, 10000);
    as("m-8");
    expect((await call(handlers, "DELETE /api/funding-rounds/pledges/:id", { params: { id: late.body.pledge.id } })).status).toBe(200);
    for (const p of people) {
      as(p.id);
      expect((await call(handlers, "PUT /api/funding-rounds/rounds/:id/marks", { params: { id: roundId }, body: { ideaIds: [shed] } })).status).toBe(200);
    }
  });

  it("at harvest turns standing pledges firm and counts only what the pot must cover", async () => {
    await putRoundIn("harvest");
    as("m-4");
    const v = await view();
    const o = v.outcome;
    // The shed costs the pot 600,000 - 100,000; the seed bank is backer-funded and skips the count.
    expect(o.backerFunded).toEqual([seeds]);
    expect(o.power.steps.find((s: any) => s.option === shed).cost).toBe(500000);
    expect(o.power.funded).toEqual([shed]);
    const s = v.ideas.find((i: any) => i.id === shed);
    const b = v.ideas.find((i: any) => i.id === seeds);
    expect([s.status, b.status]).toEqual(["funded", "funded"]);
    expect(s.backing).toMatchObject({ firmMinor: 100000, pledgedMinor: 100000 });

    const pledges = await q("SELECT idea_id, status, firm_at FROM funding_pledges WHERE status <> 'withdrawn' ORDER BY idea_id");
    const byIdea = Object.fromEntries(pledges.map((p: any) => [p.idea_id, p]));
    expect(byIdea[shed].status).toBe("firm");
    expect(byIdea[shed].firm_at).toBeTruthy();
    expect(byIdea[seeds].status).toBe("firm");
    // The bench never reached the ballot, so its pledge goes back to its backer.
    expect(byIdea[bench].status).toBe("released_to_backer");

    // The pot holds only its own part: 500,000 for the shed, nothing for the seed bank.
    const earmarks = await q("SELECT idea_id, amount_minor FROM funding_earmarks WHERE round_id = ?", [roundId]);
    expect(earmarks).toEqual([{ idea_id: shed, amount_minor: 500000 }]);
    expect(v.pot).toMatchObject({ earmarkedMinor: 500000, freeMinor: 500000 });
    // Both become quests, priced at their whole ask.
    expect(quests.map((x) => [x.title, x.cashMinor]).sort()).toEqual([["Seed bank", 600000], ["Tool shed", 600000]]);
  });

  it("refuses to withdraw a firm pledge, and a pledge in harvest is firm at once and lowers the earmark", async () => {
    as("m-5");
    expect((await call(handlers, "DELETE /api/funding-rounds/pledges/:id", { params: { id: firstPledge } })).status).toBe(409);
    const now = await back("m-9", shed, 200000);
    expect(now.status).toBe(201);
    expect(now.body.pledge.status).toBe("firm");
    const [e] = await q("SELECT amount_minor FROM funding_earmarks WHERE idea_id = ?", [shed]);
    expect(e.amount_minor).toBe(300000);
    // A pledge can only lower the pot's part to nothing.
    await back("m-9", shed, 900000);
    const [e2] = await q("SELECT amount_minor FROM funding_earmarks WHERE idea_id = ?", [shed]);
    expect(e2.amount_minor).toBe(0);
    // Nobody backs a quest the round did not fund, or the bench that never reached the ballot.
    expect((await back("m-9", bench, 1000)).status).toBe(409);
  });

  it("never unmasks an anonymous author who backs their own idea", async () => {
    as("m-0");
    const pots = (await call(handlers, "GET /api/funding-rounds")).body.pots;
    const r = await call(handlers, "POST /api/funding-rounds/pots/:id/rounds", { params: { id: pots[0].id }, body: { title: "Quiet ideas", seedAt: at(-1).toISOString() } });
    const quiet = r.body.round.id as string;
    as("m-4");
    const idea = await call(handlers, "POST /api/funding-rounds/rounds/:id/ideas", { params: { id: quiet }, body: { title: "Owl boxes", what: "Boxes for barn owls", shownAs: "anonymous" } });
    expect((await back("m-4", idea.body.idea.id, 20000)).status).toBe(201);
    expect((await back("m-8", idea.body.idea.id, 5000)).status).toBe(201);
    as("m-1");
    const seen = await call(handlers, "GET /api/funding-rounds/rounds/:id", { params: { id: quiet } });
    const owl = seen.body.ideas[0];
    expect(owl.backing.pledges.map((p: any) => p.name).sort()).toEqual(["Member8", "the proposer"]);
    expect(JSON.stringify(seen.body)).not.toContain("Member4");
  });

  it("exports a member's pledges, and erasure keeps a firm pledge without the name", async () => {
    const out: any = await exportMemberFundingRounds(pool, "m-6");
    expect(out.pledges.map((p: any) => [p.amountMinor, p.status]).sort()).toEqual([[100000, "firm"], [250000, "withdrawn"]]);
    await forgetMemberFundingRounds(pool, "m-6");
    expect(await q("SELECT * FROM funding_pledges WHERE backer_user_id = 'm-6'")).toEqual([]);
    // The firm promise stays on the record, de-attributed; the withdrawn one is gone.
    const kept = await q("SELECT amount_minor, status FROM funding_pledges WHERE backer_user_id = 'erased'");
    expect(kept).toEqual([{ amount_minor: 100000, status: "firm" }]);
    as("m-4");
    const s = (await view()).ideas.find((i: any) => i.id === shed);
    expect(s.backing.pledges.find((p: any) => p.amountMinor === 100000).name).toBe("a member");
  });
});
