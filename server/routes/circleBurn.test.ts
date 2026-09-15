/**
 * GET /api/resources/burn ANSWERS AT ALL.
 *
 * This route had no test of its own. Its lib is covered by
 * `server/lib/circleBurn.test.ts` and its shape by `shared/circleBurn.test.ts`,
 * and both of those hand the clock mode IN as a parameter, so neither could
 * see what the handler does to get one.
 *
 * WHAT IT DID. `stringVar("cycle.mode")` sat inside the handler.
 * `shared/cycleClock.ts` names `cycle.mode` in `CYCLE_SETTING_READERS` as the
 * key the rhythm dial publishes, and `shared/gameVariables.ts` does not
 * declare it on this tree. `variable()` throws on a key it does not know, on
 * purpose, so a typo cannot read as a zero. So every request to this route
 * threw `Unknown game variable: cycle.mode` before it read anything, and
 * `client/src/components/power/ResourcesPanel.tsx` fetches it on mount.
 *
 * The lane that adds the dial makes the key exist and this route starts
 * reading the village's answer. Until then it takes the clock's own default,
 * and this file is what stops the throw coming back unseen.
 *
 * `register` runs against a fake Express that records handlers by path, the
 * shape `server/routes/needs.test.ts` uses, so what runs is the real handler.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { loadTokenRegistry } from "../lib/ledger";
import { loadVariables } from "../lib/variables";
import { upsertBudget } from "../lib/resources";
import { register } from "./circleBurn";

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn("[circleBurn.routes.test] TEST_DATABASE_URL not set. The burn route is UNCHECKED here.");
}

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

let db: TestDb;
let pool: mysql.Pool;
let handler: Handler;

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

async function call(query: Record<string, string>) {
  const { res, out } = makeRes();
  await handler({ query }, res);
  return out;
}

describe.skipIf(!configured)("GET /api/resources/burn", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the S5 scratch-schema harness pool, the ledger.test.ts shape
    await loadVariables(pool);
    await loadTokenRegistry(pool);
    const handlers = new Map<string, Handler>();
    const app: any = { get: (p: string, h: Handler) => handlers.set(p, h) };
    register(app, {
      getPool: () => pool,
      authedUser: async () => ({ id: "member-1" }) as any,
      circlesRepo: { all: () => [{ id: "kitchen", name: "The Kitchen" }] },
      seasonState: () => ({ seasons: [{ id: "rooting-2026", startsOn: "2026-06-01", endsOn: "2026-12-01" }], timezone: "UTC" }),
    } as any);
    handler = handlers.get("/api/resources/burn")!;
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("answers a signed-in member instead of throwing on a dial that does not exist", async () => {
    const out = await call({});
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ readings: expect.any(Array) });
    expect(out.body.clock).toBeTruthy();
  });

  it("reads a real envelope back out of the database", async () => {
    await upsertBudget(
      pool,
      { circleId: "kitchen", seasonId: "rooting-2026", amountMinor: 10_000, unit: "token:credits" },
      "admin-1",
    );
    const out = await call({ at: "2026-07-01T00:00:00.000Z" });
    expect(out.status).toBe(200);
    const kitchen = out.body.readings.find((r: any) => r.circleId === "kitchen");
    expect(kitchen.kind).toBe("metered");
    expect(kitchen.season.capMinor).toBe(10_000);
    expect(kitchen.sentence).toContain("The Kitchen");
  });

  it("still refuses an instant it cannot parse", async () => {
    const out = await call({ at: "the day after" });
    expect(out.status).toBe(400);
  });
});
