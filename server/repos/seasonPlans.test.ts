/**
 * SAVING A SEASON PLAN WHILE ANOTHER SAVE RUNS (red team D6).
 *
 * The first save of a member's plan reads MAX(version) FOR UPDATE over an
 * empty range, which takes a gap lock; two first saves at once each hold one
 * and then both insert into it, and one of them dies as a deadlock (1213), or
 * on MariaDB as 1020. A page that saves as a member types does exactly that.
 * Every save must land, each as its own version.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { insertPlanVersion, planVersions } from "./seasonPlans";

const configured = testDbConfigured();
if (!configured) console.warn("[seasonPlans repo] TEST_DATABASE_URL not set - DB cases SKIPPED. A skip is not a pass.");

describe.skipIf(!configured)("saving a season plan", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 8 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
  });
  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  const plan = (aim: string) => ({ aim, servesGoal: null, commitments: {}, handingBack: [] }) as any;

  it("lands six first saves made at once, each as its own version", async () => {
    const saves = await Promise.allSettled([1, 2, 3, 4, 5, 6].map((i) => insertPlanVersion(pool, "u-race", "s-now", plan(`Aim ${i}`))));
    const failed = saves.filter((r) => r.status === "rejected").map((r) => String((r as PromiseRejectedResult).reason?.message ?? r));
    expect(failed).toEqual([]);
    const versions = (await planVersions(pool, "u-race", "s-now")).map((p) => p.version);
    expect(versions).toEqual([1, 2, 3, 4, 5, 6]);
    // Only the newest stands.
    expect((await planVersions(pool, "u-race", "s-now")).filter((p) => !p.supersededAt)).toHaveLength(1);
  });
});
