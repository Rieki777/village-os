/**
 * The completion route: what it refuses, and what it says while it refuses.
 *
 * `register` is called against a fake Express that records handlers by method
 * and path, the shape `server/routes/needs.test.ts` and
 * `server/routes/land.test.ts` use, so what runs is the real registration and
 * the real handler body. The pool is a scratch schema, so `listBudgets`, the
 * ballot lookup and the burn read all hit real SQL.
 *
 * What is under test, in the order the questions were asked:
 *   1. a stranger gets nothing, and a bad query earns a sentence saying which
 *      part was bad;
 *   2. asking for the circle-scoped roll is refused WITH THE REASON there is
 *      no such roll, and never with a bare 400;
 *   3. the reading refuses when nothing records what the circle took on, and
 *      the refusal names the record before it names the vote;
 *   4. what the reading cannot see rides the payload on every branch, and so
 *      does the fact that this build has nowhere to write a commitment;
 *   5. a circle with a real envelope and a circle with none produce different
 *      spend components, so an absence is never rendered as a zero;
 *   6. nothing in the payload can be read as an authorisation or an amount.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { loadTokenRegistry } from "../lib/ledger";
import { loadVariables } from "../lib/variables";
import { upsertBudget } from "../lib/resources";
import { BLIND_SPOT } from "../../shared/circleBonusGate";
import { NO_COMMITMENT_STORE, register } from "./circleBonusGate";

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn("[circleBonusGate.routes.test] TEST_DATABASE_URL not set. The route is UNCHECKED here.");
}

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

/** A fake Express that keeps the handlers `register` hands it. */
function collect(): { app: any; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  const record = (method: string) => (p: string, handler: Handler) => {
    handlers.set(`${method} ${p}`, handler);
  };
  return {
    app: { get: record("GET"), post: record("POST"), put: record("PUT"), delete: record("DELETE") },
    handlers,
  };
}

/** Captures what a handler answered. */
function makeRes() {
  const out: { status: number; body: any } = { status: 200, body: undefined };
  const res: any = {
    status(code: number) {
      out.status = code;
      return res;
    },
    json(body: unknown) {
      out.body = body;
      return res;
    },
  };
  return { res, out };
}

const CIRCLES = [
  { id: "kitchen", name: "The Kitchen" },
  { id: "quiet", name: "The Quiet Room" },
];

const SEASONS = { seasons: [{ id: "rooting-2026", startsOn: "2026-06-01", endsOn: "2026-12-01" }], timezone: "UTC" };

let db: TestDb;
let pool: mysql.Pool;
let handlers: Map<string, Handler>;
let signedIn = true;

async function call(query: Record<string, string>) {
  const handler = handlers.get("GET /api/resources/completion");
  if (!handler) throw new Error("the route did not register");
  const { res, out } = makeRes();
  await handler({ query }, res);
  return out;
}

describe.skipIf(!configured)("GET /api/resources/completion", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the S5 scratch-schema harness pool, the ledger.test.ts shape
    await loadVariables(pool);
    await loadTokenRegistry(pool);
    const { app, handlers: h } = collect();
    handlers = h;
    register(app, {
      getPool: () => pool,
      authedUser: async () => (signedIn ? ({ id: "member-1" } as any) : null),
      circlesRepo: { all: () => CIRCLES },
      seasonState: () => SEASONS,
    } as any);
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("serves a stranger nothing", async () => {
    signedIn = false;
    const out = await call({ circleId: "kitchen", periodId: "rooting-2026" });
    signedIn = true;
    expect(out.status).toBe(401);
  });

  it("says which part of the query was missing", async () => {
    expect((await call({ periodId: "rooting-2026" })).status).toBe(400);
    expect((await call({ circleId: "kitchen" })).body.error).toContain("periodId");
    const junk = await call({ circleId: "kitchen", periodId: "rooting-2026", at: "the day after" });
    expect(junk.status).toBe(400);
    expect(junk.body.error).toContain("ISO instant");
  });

  it("refuses a circle-scoped roll with the reason there is none", async () => {
    const out = await call({ circleId: "kitchen", periodId: "rooting-2026", electorate: "circle" });
    expect(out.status).toBe(400);
    expect(out.body.error).toContain("no membership of a circle to build a roll from");
    expect(out.body.ruling).toContain("has not been decided");
  });

  it("refuses an electorate it does not recognise, and still says who decides", async () => {
    const out = await call({ circleId: "kitchen", periodId: "rooting-2026", electorate: "founders" });
    expect(out.status).toBe(400);
    expect(out.body.ruling).toContain("has not been decided");
  });

  it("names the missing record before the missing vote", async () => {
    const out = await call({ circleId: "kitchen", periodId: "rooting-2026" });
    expect(out.status).toBe(200);
    expect(out.body.commitment.state).toBe("none");
    expect(out.body.vote.state).toBe("never_asked");
    expect(out.body.blocking[0]).toContain("Nothing records what this circle took on");
    expect(out.body.sentences.commitment).toContain("The Kitchen");
  });

  it("carries what it cannot see, and what this build has nowhere to store", async () => {
    const out = await call({ circleId: "kitchen", periodId: "rooting-2026" });
    expect(out.body.blindSpot).toBe(BLIND_SPOT);
    expect(out.body.noCommitmentStore).toBe(NO_COMMITMENT_STORE);
    expect(out.body.blindSpot).toContain("care, mediation or hosting");
  });

  it("tells a circle with an envelope apart from one with none", async () => {
    await upsertBudget(
      pool,
      { circleId: "kitchen", seasonId: "rooting-2026", amountMinor: 10_000, unit: "token:credits" },
      "admin-1",
    );
    const withOne = await call({ circleId: "kitchen", periodId: "rooting-2026", at: "2026-07-01T00:00:00.000Z" });
    const without = await call({ circleId: "quiet", periodId: "rooting-2026", at: "2026-07-01T00:00:00.000Z" });

    expect(withOne.body.spend.state).toBe("under_cap");
    expect(withOne.body.spend.spentMinor).toBe(0);
    expect(without.body.spend.state).toBe("ungoverned");
    expect(without.body.spend.spentMinor).toBeNull();
    expect(without.body.sentences.spend).toContain("The Quiet Room");
    expect(withOne.body.sentences.spend).not.toBe(without.body.sentences.spend);
  });

  it("hands back nothing that can be read as an authorisation or an amount", async () => {
    const out = await call({ circleId: "kitchen", periodId: "rooting-2026" });
    expect(JSON.stringify(out.body)).not.toMatch(/"(eligible|payout|bonusMinor|award|score)"/);
    expect(Object.keys(out.body)).not.toContain("eligible");
    expect(out.body.blocking.length).toBeGreaterThan(0);
  });
});
