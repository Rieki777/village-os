/**
 * ONE MEMBER'S SHARE OF THE POOL, AND NOBODY ELSE'S.
 *
 * `distributionsForMember` exists because the member data export had no read
 * against `gratitude_distributions` at all, so what each cycle credited a
 * person was missing from the file whose button says everything the village
 * holds about them.
 *
 * The obvious alternative was `DistributionsRepo.all()` plus a filter, and it
 * is the reason this file is here rather than a comment being the reason. That
 * read returns every row for every member in the village, so filtering it in
 * TypeScript would put the whole village's settlement history in the memory of
 * the request that builds one person's download, one spread operator away from
 * shipping. So the WHERE clause is the guarantee, and the guarantee is asserted
 * against a real schema rather than described.
 *
 * No TEST_DATABASE_URL and the suite skips (harness rule).
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { distributionsForMember, gratitudeDistributionsRepo } from "./gratitude";

const configured = testDbConfigured();

describe.skipIf(!configured)("a member's own distributions", () => {
  let db: TestDb;
  let pool: mysql.Pool;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    const repo = gratitudeDistributionsRepo(pool);
    await repo.add({
      id: "gd-mine-1", cycleId: "cyc-1", userId: "mine", received: 12, distinctSenders: 3,
      credited: 400, poolToken: "gratitude",
    } as any);
    await repo.add({
      id: "gd-mine-2", cycleId: "cyc-2", userId: "mine", received: 4, distinctSenders: 1,
      credited: 90, poolToken: "gratitude",
    } as any);
    await repo.add({
      id: "gd-theirs-1", cycleId: "cyc-1", userId: "theirs", received: 99, distinctSenders: 9,
      credited: 5000, poolToken: "gratitude",
    } as any);
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop?.();
  });

  it("answers with every cycle they were credited in, oldest first", async () => {
    const mine = await distributionsForMember(pool, "mine");
    expect(mine.map((d) => d.id)).toEqual(["gd-mine-1", "gd-mine-2"]);
    expect(mine[0].credited).toBe(400);
    expect(mine[0].distinctSenders).toBe(3);
  });

  it("never carries another member's settlement", async () => {
    const mine = await distributionsForMember(pool, "mine");
    // The assertion is on the whole payload and not on a field, because the
    // harm is a row travelling at all.
    expect(JSON.stringify(mine)).not.toContain("theirs");
    expect(JSON.stringify(mine)).not.toContain("5000");
  });

  it("answers with an empty list for a member who was never credited", async () => {
    // The export spreads this into a document. An empty array reads as "no
    // cycles credited you"; a missing key reads as "we did not answer".
    expect(await distributionsForMember(pool, "never-here")).toEqual([]);
  });
});
